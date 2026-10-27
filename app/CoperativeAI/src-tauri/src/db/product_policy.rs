//! The `ProductPolicy` model — the Product-level counterpart of
//! `work_item_policy`, gating AI work that is anchored on a Product rather than
//! on one work item (today: generating the work that achieves a Deliverable).
//!
//! Security-enforcing table, same rule as work-item policies: a Product with no
//! row here, or with the relevant flag false, is closed to that AI use —
//! deny-by-default. It is deliberately coarser than a work-item policy: allowing
//! generation for one Deliverable allows it for every Deliverable of that
//! Product.

use crate::db::{now_millis, DbError, Result};
use turso::Connection;

pub use crate::db::work_item_policy::EFFORT_TIERS;

#[derive(Debug, Clone, PartialEq)]
pub struct ProductPolicy {
    pub id: i64,
    pub product_id: i64,
    /// May the AI read this Product's brief, strategy, and deliverables?
    pub allow_read: bool,
    /// May the AI create planning work items against this Product?
    pub allow_generate: bool,
    /// May the AI change this Product's work — code, plans, schemas?
    ///
    /// **Here since 2026-08-21**, when permission moved up from the work item:
    /// a new item was denied until somebody permitted it individually, and
    /// permission had to be re-granted for every item forever.
    pub allow_edit: bool,
    /// May the AI write tests for this Product's work?
    pub allow_generate_tests: bool,
    pub provider_id: Option<i64>,
    pub effort_tier: String,
    pub updated_at: i64,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS product_policies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            productId INTEGER NOT NULL UNIQUE,
            allowRead INTEGER NOT NULL DEFAULT 0,
            allowGenerate INTEGER NOT NULL DEFAULT 0,
            allowEdit INTEGER NOT NULL DEFAULT 0,
            allowGenerateTests INTEGER NOT NULL DEFAULT 0,
            providerId INTEGER,
            effortTier TEXT NOT NULL DEFAULT 'low',
            updatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    // **Added, never rebuilt.** A policy is somebody's decision about what an
    // AI may do to their work; recreating the table to add a column would
    // silently revoke it. The two new flags default to 0, which is the right
    // answer: a permission nobody has granted is not granted.
    let columns = crate::db::table_columns(conn, "product_policies").await?;
    for (name, ddl) in [
        (
            "allowEdit",
            "ALTER TABLE product_policies ADD COLUMN allowEdit INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "allowGenerateTests",
            "ALTER TABLE product_policies ADD COLUMN allowGenerateTests INTEGER NOT NULL DEFAULT 0",
        ),
    ] {
        if !columns.is_empty() && !columns.iter().any(|c| c == name) {
            conn.execute(ddl, ()).await?;
        }
    }
    Ok(())
}

/// Creates or replaces a Product's AI policy (one policy per Product).
#[allow(clippy::too_many_arguments)]
pub async fn set_policy(
    conn: &Connection,
    product_id: i64,
    allow_read: bool,
    allow_generate: bool,
    allow_edit: bool,
    allow_generate_tests: bool,
    provider_id: Option<i64>,
    effort_tier: &str,
) -> Result<()> {
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
    if let Some(pid) = provider_id {
        if crate::db::ai_provider::find_by_id(conn, pid).await?.is_none() {
            return Err(DbError::Validation(format!("no AI provider with id {pid}")));
        }
    }
    conn.execute(
        "DELETE FROM product_policies WHERE productId = ?1",
        (product_id,),
    )
    .await?;
    conn.execute(
        "INSERT INTO product_policies
            (productId, allowRead, allowGenerate, allowEdit, allowGenerateTests, providerId, effortTier, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        (
            product_id,
            allow_read as i64,
            allow_generate as i64,
            allow_edit as i64,
            allow_generate_tests as i64,
            provider_id,
            effort_tier,
            now_millis(),
        ),
    )
    .await?;
    Ok(())
}

pub async fn for_product(conn: &Connection, product_id: i64) -> Result<Option<ProductPolicy>> {
    let mut rows = conn
        .query(
            "SELECT id, productId, allowRead, allowGenerate, providerId, effortTier, updatedAt, allowEdit, allowGenerateTests
             FROM product_policies WHERE productId = ?1",
            (product_id,),
        )
        .await?;
    match rows.next().await? {
        Some(row) => {
            let allow_read: i64 = row.get(2)?;
            let allow_generate: i64 = row.get(3)?;
            Ok(Some(ProductPolicy {
                id: row.get(0)?,
                product_id: row.get(1)?,
                allow_read: allow_read != 0,
                allow_generate: allow_generate != 0,
                // Read as false on a row written before they existed: a
                // permission nobody has granted is not granted.
                allow_edit: row.get::<i64>(7).unwrap_or(0) != 0,
                allow_generate_tests: row.get::<i64>(8).unwrap_or(0) != 0,
                provider_id: row.get(4)?,
                effort_tier: row.get(5)?,
                updated_at: row.get(6)?,
            }))
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    #[tokio::test]
    async fn a_product_with_no_policy_is_closed() {
        let (conn, product_id) = db_with_product().await;
        assert_eq!(for_product(&conn, product_id).await.expect("get"), None);
    }

    #[tokio::test]
    async fn set_policy_round_trips_and_replaces() {
        let (conn, product_id) = db_with_product().await;
        set_policy(&conn, product_id, true, true, false, false, None, "medium")
            .await
            .expect("set");
        let policy = for_product(&conn, product_id)
            .await
            .expect("get")
            .expect("exists");
        assert!(policy.allow_read && policy.allow_generate);
        assert_eq!(policy.effort_tier, "medium");

        // one policy per product — setting again replaces, never duplicates
        set_policy(&conn, product_id, false, false, false, false, None, "low")
            .await
            .expect("replace");
        let policy = for_product(&conn, product_id)
            .await
            .expect("get")
            .expect("exists");
        assert!(!policy.allow_read && !policy.allow_generate);
    }

    #[tokio::test]
    async fn policy_validates_product_effort_and_provider() {
        let (conn, product_id) = db_with_product().await;
        assert!(set_policy(&conn, 999, true, true, false, false, None, "low").await.is_err());
        assert!(set_policy(&conn, product_id, true, true, false, false, None, "extreme").await.is_err());
        assert!(set_policy(&conn, product_id, true, true, false, false, Some(999), "low").await.is_err());
    }
}
