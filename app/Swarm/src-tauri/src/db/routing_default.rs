//! Which provider and effort an area's AI work uses when nobody has said
//! otherwise on the individual piece of work.
//!
//! **Separate from permission on purpose.** Whether the AI may touch something
//! is governance — a Product's policy, overridden per Solution. *Which model
//! runs it and how hard* is a working decision, and the two belong to different
//! people: Admin permits, and the people doing the work choose how it is done.
//!
//! **Separate per area** because Develop and QA are not the same job. Planning a
//! cross-file change and writing one unit test do not deserve the same model, so
//! QA can set its own without arguing with Develop about the default.
//!
//! Absent means nothing said, and the caller says so rather than guessing — a
//! guessed model is a guessed bill.
//!
//! **Two slots per area: Main and Secondary.** Main is what does the work.
//! Secondary is optional and exists for the two jobs Main cannot do for itself
//! — peer-reviewing a change, and carrying on when Main runs out of budget. A
//! fresh install has no Secondary anywhere, and nothing here invents one.
//!
//! **Product is an area here now.** It used to be excluded, because its
//! planning was gated *and* routed by the Product policy. That left two places
//! holding a provider, where the behaviour depended on which code path ran
//! first — the kind of thing nobody notices until they change a setting and
//! nothing happens. The line is now drawn where it belongs: **a policy decides
//! whether the AI may act at all; this decides which AI acts.**

use crate::db::{now_millis, DbError, Result};
use turso::Connection;

pub use crate::db::work_item_policy::EFFORT_TIERS;

/// The areas that do AI work of their own.
///
/// `test` rather than `qa` because that is what the column has always held and
/// a rename would be a migration for a word. The page says QA.
pub const AREAS: &[&str] = &["product", "develop", "test"];

/// Which of the two providers for an area.
///
/// **`main` is not a default that gets filled in.** A row is absent until
/// somebody sets it, for either slot, and absent means absent.
pub const SLOTS: &[&str] = &["main", "secondary"];

#[derive(Debug, Clone, PartialEq)]
pub struct RoutingDefault {
    pub product_id: i64,
    pub area: String,
    pub slot: String,
    pub provider_id: Option<i64>,
    pub effort_tier: String,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS routing_defaults (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            productId INTEGER NOT NULL,
            area TEXT NOT NULL,
            slot TEXT NOT NULL DEFAULT 'main',
            providerId INTEGER,
            effortTier TEXT NOT NULL DEFAULT 'low',
            updatedAt INTEGER NOT NULL,
            UNIQUE(productId, area, slot)
        )",
        (),
    )
    .await?;

    // **Added, never rebuilt.** These rows are somebody's decision about which
    // model spends their money; recreating the table to widen the key would
    // throw them away. Existing rows predate slots and are all Main, which is
    // what the column default says — so an upgrade keeps every choice already
    // made and simply gains an empty Secondary.
    //
    // The UNIQUE key cannot be widened by ALTER, so it is not: the old
    // `UNIQUE(productId, area)` stays on an upgraded database, which means an
    // upgraded install can hold one row per area rather than two. `set_default`
    // therefore does its own delete-by-key rather than relying on the
    // constraint, and the index below adds the wider uniqueness where the
    // constraint cannot.
    let columns = crate::db::table_columns(conn, "routing_defaults").await?;
    if !columns.is_empty() && !columns.iter().any(|c| c == "slot") {
        conn.execute(
            "ALTER TABLE routing_defaults ADD COLUMN slot TEXT NOT NULL DEFAULT 'main'",
            (),
        )
        .await?;
        // The old constraint would refuse the second slot outright, so it has
        // to go. Dropping a UNIQUE that came from CREATE TABLE is not possible
        // in place, so the rows are copied into a table with the right key —
        // done only on an upgrade, and only after the rows exist to copy.
        conn.execute(
            "CREATE TABLE IF NOT EXISTS routing_defaults_next (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                productId INTEGER NOT NULL,
                area TEXT NOT NULL,
                slot TEXT NOT NULL DEFAULT 'main',
                providerId INTEGER,
                effortTier TEXT NOT NULL DEFAULT 'low',
                updatedAt INTEGER NOT NULL,
                UNIQUE(productId, area, slot)
            )",
            (),
        )
        .await?;
        conn.execute(
            "INSERT INTO routing_defaults_next
                (productId, area, slot, providerId, effortTier, updatedAt)
             SELECT productId, area, slot, providerId, effortTier, updatedAt
             FROM routing_defaults",
            (),
        )
        .await?;
        conn.execute("DROP TABLE routing_defaults", ()).await?;
        conn.execute(
            "ALTER TABLE routing_defaults_next RENAME TO routing_defaults",
            (),
        )
        .await?;
    }
    Ok(())
}

pub async fn set_default(
    conn: &Connection,
    product_id: i64,
    area: &str,
    slot: &str,
    provider_id: Option<i64>,
    effort_tier: &str,
) -> Result<()> {
    if !AREAS.contains(&area) {
        return Err(DbError::Validation(format!(
            "area must be one of {AREAS:?}, got '{area}'"
        )));
    }
    if !SLOTS.contains(&slot) {
        return Err(DbError::Validation(format!(
            "slot must be one of {SLOTS:?}, got '{slot}'"
        )));
    }
    if !EFFORT_TIERS.contains(&effort_tier) {
        return Err(DbError::Validation(format!(
            "effortTier must be one of {EFFORT_TIERS:?}, got '{effort_tier}'"
        )));
    }
    if crate::db::product::find_by_id(conn, product_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no Product with id {product_id}"
        )));
    }
    // Keyed on the slot as well, so setting Secondary does not silently
    // replace Main — which is what this delete did before the slot existed.
    conn.execute(
        "DELETE FROM routing_defaults WHERE productId = ?1 AND area = ?2 AND slot = ?3",
        (product_id, area, slot),
    )
    .await?;
    conn.execute(
        "INSERT INTO routing_defaults (productId, area, slot, providerId, effortTier, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (product_id, area, slot, provider_id, effort_tier, now_millis()),
    )
    .await?;
    Ok(())
}

/// Forgets one slot for one area.
///
/// **The way a Secondary is removed, and it has to be possible.** A Secondary
/// that can be set but not unset is one somebody is stuck with — and "no
/// Secondary" is the default state, so it must also be a reachable one.
pub async fn clear(conn: &Connection, product_id: i64, area: &str, slot: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM routing_defaults WHERE productId = ?1 AND area = ?2 AND slot = ?3",
        (product_id, area, slot),
    )
    .await?;
    Ok(())
}

/// One slot for one area, or nothing.
///
/// **`None` means nobody has said, and callers must treat it as that** rather
/// than reaching for another area's answer. Falling back quietly would be the
/// app choosing a provider nobody named, and spending money on it.
pub async fn for_slot(
    conn: &Connection,
    product_id: i64,
    area: &str,
    slot: &str,
) -> Result<Option<RoutingDefault>> {
    let mut rows = conn
        .query(
            "SELECT productId, area, slot, providerId, effortTier FROM routing_defaults
             WHERE productId = ?1 AND area = ?2 AND slot = ?3",
            (product_id, area, slot),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(RoutingDefault {
            product_id: row.get(0)?,
            area: row.get(1)?,
            slot: row.get(2)?,
            provider_id: row.get(3)?,
            effort_tier: row.get(4)?,
        })),
        None => Ok(None),
    }
}

/// The Main provider for an area.
///
/// Named rather than left as `for_slot(.., "main")` at every call site: the
/// slot is a spelling somebody can get wrong, and most callers want Main.
pub async fn for_area(
    conn: &Connection,
    product_id: i64,
    area: &str,
) -> Result<Option<RoutingDefault>> {
    for_slot(conn, product_id, area, "main").await
}

/// The Secondary provider for an area, which is usually absent.
pub async fn secondary_for(
    conn: &Connection,
    product_id: i64,
    area: &str,
) -> Result<Option<RoutingDefault>> {
    for_slot(conn, product_id, area, "secondary").await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ai_provider;
    use crate::db::product::tests::db_with_product;

    /// **Develop and QA are different jobs.** Planning a cross-file change and
    /// writing one unit test do not deserve the same model, so each area holds
    /// its own answer and neither overwrites the other.
    #[tokio::test]
    async fn each_area_keeps_its_own_default() {
        let (conn, product_id) = db_with_product().await;
        let big = ai_provider::add(&conn, "Claude", "https://a.example", &["m"], "a")
            .await
            .expect("provider");
        let small = ai_provider::add(&conn, "Cheap", "https://b.example", &["m"], "b")
            .await
            .expect("provider");

        set_default(&conn, product_id, "develop", "main", Some(big), "high")
            .await
            .expect("develop");
        set_default(&conn, product_id, "test", "main", Some(small), "low")
            .await
            .expect("test");

        let develop = for_area(&conn, product_id, "develop").await.expect("q").expect("set");
        let test = for_area(&conn, product_id, "test").await.expect("q").expect("set");
        assert_eq!((develop.provider_id, develop.effort_tier.as_str()), (Some(big), "high"));
        assert_eq!((test.provider_id, test.effort_tier.as_str()), (Some(small), "low"));
    }

    /// Nothing said is a real answer: the caller falls back to the policy that
    /// permitted the work rather than this module inventing a model.
    #[tokio::test]
    async fn nothing_said_is_none_rather_than_a_guess() {
        let (conn, product_id) = db_with_product().await;
        assert_eq!(for_area(&conn, product_id, "develop").await.expect("q"), None);
    }

    #[tokio::test]
    async fn setting_one_twice_replaces_rather_than_duplicates() {
        let (conn, product_id) = db_with_product().await;
        set_default(&conn, product_id, "develop", "main", None, "low").await.expect("first");
        set_default(&conn, product_id, "develop", "main", None, "high").await.expect("second");
        assert_eq!(
            for_area(&conn, product_id, "develop").await.expect("q").expect("set").effort_tier,
            "high",
        );
    }

    #[tokio::test]
    async fn an_unknown_area_effort_or_product_is_refused() {
        let (conn, product_id) = db_with_product().await;
        assert!(set_default(&conn, product_id, "marketing", "main", None, "low").await.is_err());
        assert!(set_default(&conn, product_id, "develop", "main", None, "colossal").await.is_err());
        assert!(set_default(&conn, 999, "develop", "main", None, "low").await.is_err());
        // A slot nobody has heard of is refused rather than stored and then
        // never read by anything.
        assert!(set_default(&conn, product_id, "develop", "tertiary", None, "low").await.is_err());
    }

    /// **Product is routed here now.** It used to be excluded, which left the
    /// Product policy holding a provider as well — two answers to one question,
    /// where the behaviour depended on which code path ran first.
    #[tokio::test]
    async fn product_is_an_area_like_the_others() {
        let (conn, product_id) = db_with_product().await;
        let p = ai_provider::add(&conn, "Claude", "https://a.example", &["m"], "a")
            .await
            .expect("provider");
        set_default(&conn, product_id, "product", "main", Some(p), "high")
            .await
            .expect("product routes here");
        let got = for_area(&conn, product_id, "product").await.expect("q").expect("set");
        assert_eq!((got.provider_id, got.effort_tier.as_str()), (Some(p), "high"));
    }

    /// **Setting a Secondary must not touch Main.** Before the slot existed
    /// this delete was keyed on the area alone, so the second write replaced
    /// the first — which as a Secondary would mean quietly losing the provider
    /// that does the actual work.
    #[tokio::test]
    async fn a_secondary_sits_beside_main_rather_than_replacing_it() {
        let (conn, product_id) = db_with_product().await;
        let big = ai_provider::add(&conn, "Claude", "https://a.example", &["m"], "a")
            .await
            .expect("provider");
        // An https URL because `add` is the https-only path — a local Ollama is
        // created through `add_of_kind` instead. This test is about slots, not
        // about which URLs a provider may have.
        let small = ai_provider::add(&conn, "Cheap", "https://b.example", &["m"], "b")
            .await
            .expect("provider");

        set_default(&conn, product_id, "develop", "main", Some(big), "high")
            .await
            .expect("main");
        set_default(&conn, product_id, "develop", "secondary", Some(small), "low")
            .await
            .expect("secondary");

        let main = for_area(&conn, product_id, "develop").await.expect("q").expect("main");
        let second = secondary_for(&conn, product_id, "develop")
            .await
            .expect("q")
            .expect("secondary");
        assert_eq!(main.provider_id, Some(big), "main survived the secondary being set");
        assert_eq!(second.provider_id, Some(small));
        assert_eq!(main.slot, "main");
        assert_eq!(second.slot, "secondary");
    }

    /// **No Secondary is the default, and it has to stay reachable.** A fresh
    /// Product has none, and one that was set can be unset — a Secondary that
    /// cannot be removed is one somebody is stuck paying for.
    #[tokio::test]
    async fn a_secondary_is_absent_until_set_and_can_be_removed_again() {
        let (conn, product_id) = db_with_product().await;
        for area in AREAS {
            assert_eq!(
                secondary_for(&conn, product_id, area).await.expect("q"),
                None,
                "{area} should start with no secondary"
            );
        }

        set_default(&conn, product_id, "test", "secondary", None, "low")
            .await
            .expect("set");
        assert!(secondary_for(&conn, product_id, "test").await.expect("q").is_some());

        clear(&conn, product_id, "test", "secondary").await.expect("clear");
        assert_eq!(secondary_for(&conn, product_id, "test").await.expect("q"), None);
    }

    /// **An unset area does not borrow another area's answer.** Falling back
    /// quietly would be the app choosing a provider nobody named, and then
    /// spending money on it.
    #[tokio::test]
    async fn one_area_never_answers_for_another() {
        let (conn, product_id) = db_with_product().await;
        let p = ai_provider::add(&conn, "Claude", "https://a.example", &["m"], "a")
            .await
            .expect("provider");
        set_default(&conn, product_id, "develop", "main", Some(p), "high")
            .await
            .expect("develop");

        assert_eq!(for_area(&conn, product_id, "test").await.expect("q"), None);
        assert_eq!(for_area(&conn, product_id, "product").await.expect("q"), None);
    }

    /// **The migration keeps what was already chosen.** These rows are
    /// somebody's decision about which model spends their money; an upgrade
    /// that dropped them would be the app silently unchoosing a provider.
    /// Written against a table in its pre-slot shape, because that is the only
    /// version of this that could actually be wrong.
    #[tokio::test]
    async fn an_upgrade_keeps_existing_rows_and_calls_them_main() {
        let conn = crate::db::connect(":memory:").await.expect("open");
        crate::db::product::create_table(&conn).await.expect("products");
        let product_id = crate::db::product::create(&conn, "Shop", "{}").await.expect("product");

        // The old shape: no slot column, keyed on (productId, area).
        conn.execute(
            "CREATE TABLE routing_defaults (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                productId INTEGER NOT NULL,
                area TEXT NOT NULL,
                providerId INTEGER,
                effortTier TEXT NOT NULL DEFAULT 'low',
                updatedAt INTEGER NOT NULL,
                UNIQUE(productId, area)
            )",
            (),
        )
        .await
        .expect("old table");
        conn.execute(
            "INSERT INTO routing_defaults (productId, area, providerId, effortTier, updatedAt)
             VALUES (?1, 'develop', 7, 'high', 1)",
            (product_id,),
        )
        .await
        .expect("an existing choice");

        create_table(&conn).await.expect("migrate");

        let kept = for_area(&conn, product_id, "develop").await.expect("q").expect("kept");
        assert_eq!(kept.provider_id, Some(7), "the existing choice survived");
        assert_eq!(kept.effort_tier, "high");
        assert_eq!(kept.slot, "main", "rows from before slots are Main");

        // And the widened key works afterwards: the old UNIQUE would have
        // refused this outright.
        set_default(&conn, product_id, "develop", "secondary", None, "low")
            .await
            .expect("a secondary can now be added");
        assert!(secondary_for(&conn, product_id, "develop").await.expect("q").is_some());
        assert_eq!(
            for_area(&conn, product_id, "develop").await.expect("q").expect("main").provider_id,
            Some(7),
            "and main is still there"
        );
    }
}
