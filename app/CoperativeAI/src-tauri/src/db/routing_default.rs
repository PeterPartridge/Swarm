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
//! Absent means nothing said, and the caller falls back to the permitting
//! policy's own provider and effort rather than guessing — a guessed model is a
//! guessed bill.

use crate::db::{now_millis, DbError, Result};
use turso::Connection;

pub use crate::db::work_item_policy::EFFORT_TIERS;

/// The areas that do AI work of their own. Product's planning is gated and
/// routed by the Product policy itself, so it is not one of these.
pub const AREAS: &[&str] = &["develop", "test"];

#[derive(Debug, Clone, PartialEq)]
pub struct RoutingDefault {
    pub product_id: i64,
    pub area: String,
    pub provider_id: Option<i64>,
    pub effort_tier: String,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS routing_defaults (
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
    .await?;
    Ok(())
}

pub async fn set_default(
    conn: &Connection,
    product_id: i64,
    area: &str,
    provider_id: Option<i64>,
    effort_tier: &str,
) -> Result<()> {
    if !AREAS.contains(&area) {
        return Err(DbError::Validation(format!(
            "area must be one of {AREAS:?}, got '{area}'"
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
    conn.execute(
        "DELETE FROM routing_defaults WHERE productId = ?1 AND area = ?2",
        (product_id, area),
    )
    .await?;
    conn.execute(
        "INSERT INTO routing_defaults (productId, area, providerId, effortTier, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (product_id, area, provider_id, effort_tier, now_millis()),
    )
    .await?;
    Ok(())
}

pub async fn for_area(
    conn: &Connection,
    product_id: i64,
    area: &str,
) -> Result<Option<RoutingDefault>> {
    let mut rows = conn
        .query(
            "SELECT productId, area, providerId, effortTier FROM routing_defaults
             WHERE productId = ?1 AND area = ?2",
            (product_id, area),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(RoutingDefault {
            product_id: row.get(0)?,
            area: row.get(1)?,
            provider_id: row.get(2)?,
            effort_tier: row.get(3)?,
        })),
        None => Ok(None),
    }
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

        set_default(&conn, product_id, "develop", Some(big), "high")
            .await
            .expect("develop");
        set_default(&conn, product_id, "test", Some(small), "low")
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
        set_default(&conn, product_id, "develop", None, "low").await.expect("first");
        set_default(&conn, product_id, "develop", None, "high").await.expect("second");
        assert_eq!(
            for_area(&conn, product_id, "develop").await.expect("q").expect("set").effort_tier,
            "high",
        );
    }

    #[tokio::test]
    async fn an_unknown_area_effort_or_product_is_refused() {
        let (conn, product_id) = db_with_product().await;
        assert!(set_default(&conn, product_id, "marketing", None, "low").await.is_err());
        assert!(set_default(&conn, product_id, "develop", None, "colossal").await.is_err());
        assert!(set_default(&conn, 999, "develop", None, "low").await.is_err());
    }
}
