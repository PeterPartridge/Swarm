//! A Solution's AI policy — an **override** of its Product's, present only
//! where somebody has deliberately said this repository differs.
//!
//! **Absent is not "denied", it is "not overridden".** A Solution with no row
//! here falls through to its Product, which is the common case: most Products
//! want one answer for all their repositories. A row exists because somebody
//! decided this one is different — usually more restrictive, which is why the
//! override is total rather than per-flag. See `db::ai_permission` for the walk.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

pub use crate::db::work_item_policy::EFFORT_TIERS;

#[derive(Debug, Clone, PartialEq)]
pub struct SolutionPolicy {
    pub id: i64,
    pub solution_id: i64,
    pub allow_read: bool,
    pub allow_edit: bool,
    pub allow_generate_tests: bool,
    pub provider_id: Option<i64>,
    pub effort_tier: String,
    pub updated_at: i64,
}

const SELECT: &str = "SELECT id, solutionId, allowRead, allowEdit, allowGenerateTests, providerId, effortTier, updatedAt FROM solution_policies";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS solution_policies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            solutionId INTEGER NOT NULL UNIQUE,
            allowRead INTEGER NOT NULL DEFAULT 0,
            allowEdit INTEGER NOT NULL DEFAULT 0,
            allowGenerateTests INTEGER NOT NULL DEFAULT 0,
            providerId INTEGER,
            effortTier TEXT NOT NULL DEFAULT 'low',
            updatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn set_policy(
    conn: &Connection,
    solution_id: i64,
    allow_read: bool,
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
    if crate::db::solution::find_by_id(conn, solution_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no Solution with id {solution_id}"
        )));
    }
    conn.execute(
        "DELETE FROM solution_policies WHERE solutionId = ?1",
        (solution_id,),
    )
    .await?;
    conn.execute(
        "INSERT INTO solution_policies (solutionId, allowRead, allowEdit, allowGenerateTests,
            providerId, effortTier, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        (
            solution_id,
            allow_read as i64,
            allow_edit as i64,
            allow_generate_tests as i64,
            provider_id,
            effort_tier,
            now_millis(),
        ),
    )
    .await?;
    last_insert_id(conn).await?;
    Ok(())
}

/// Removes the override, so this Solution follows its Product again.
pub async fn clear(conn: &Connection, solution_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM solution_policies WHERE solutionId = ?1",
        (solution_id,),
    )
    .await?;
    Ok(())
}

pub async fn for_solution(conn: &Connection, solution_id: i64) -> Result<Option<SolutionPolicy>> {
    let mut rows = conn
        .query(&format!("{SELECT} WHERE solutionId = ?1"), (solution_id,))
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(SolutionPolicy {
            id: row.get(0)?,
            solution_id: row.get(1)?,
            allow_read: row.get::<i64>(2)? != 0,
            allow_edit: row.get::<i64>(3)? != 0,
            allow_generate_tests: row.get::<i64>(4)? != 0,
            provider_id: row.get(5)?,
            effort_tier: row.get(6)?,
            updated_at: row.get(7)?,
        })),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;
    use crate::db::solution;

    #[tokio::test]
    async fn an_override_is_set_and_cleared_back_to_following_the_product() {
        let (conn, product_id) = db_with_product().await;
        let sol = solution::create(&conn, "API", product_id, "api", "{}")
            .await
            .expect("solution");

        // Nothing said: not overridden, which is different from denied.
        assert_eq!(for_solution(&conn, sol).await.expect("q"), None);

        set_policy(&conn, sol, true, false, true, None, "medium")
            .await
            .expect("set");
        let stored = for_solution(&conn, sol).await.expect("q").expect("there");
        assert!(stored.allow_read && stored.allow_generate_tests);
        assert!(!stored.allow_edit);
        assert_eq!(stored.effort_tier, "medium");

        // Replaced, not duplicated.
        set_policy(&conn, sol, false, false, false, None, "low")
            .await
            .expect("replace");
        assert!(!for_solution(&conn, sol).await.expect("q").expect("there").allow_read);

        clear(&conn, sol).await.expect("clear");
        assert_eq!(for_solution(&conn, sol).await.expect("q"), None);
    }

    #[tokio::test]
    async fn an_unknown_solution_or_effort_is_refused() {
        let (conn, product_id) = db_with_product().await;
        let sol = solution::create(&conn, "API", product_id, "api", "{}")
            .await
            .expect("solution");
        assert!(set_policy(&conn, 999, true, false, false, None, "low").await.is_err());
        assert!(set_policy(&conn, sol, true, false, false, None, "enormous").await.is_err());
    }
}
