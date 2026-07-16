//! The `WorkItemPolicy` model — see
//! application/claude-only/CoperativeAIdb/WorkItemPolicy-model.md.
//!
//! Security-enforcing table: a work item with no row here (or with a flag set
//! to false) is closed to that AI use — deny-by-default. Every AI call must
//! consult this table through the shared gate before sending anything.

use crate::db::{now_millis, DbError, Result};
use turso::Connection;

pub const EFFORT_TIERS: &[&str] = &["low", "medium", "high"];

#[derive(Debug, Clone, PartialEq)]
pub struct WorkItemPolicy {
    pub id: i64,
    pub work_item_id: i64,
    pub allow_read: bool,
    pub allow_edit: bool,
    pub allow_generate_tests: bool,
    pub provider_id: Option<i64>,
    pub effort_tier: String,
    pub updated_at: i64,
}

/// What an AI call wants to do with a work item.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AiUse {
    Read,
    Edit,
    GenerateTests,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS work_item_policies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workItemId INTEGER NOT NULL UNIQUE,
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

/// Creates or replaces a work item's policy (one policy per item).
#[allow(clippy::too_many_arguments)]
pub async fn set_policy(
    conn: &Connection,
    work_item_id: i64,
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
    if crate::db::work_item::find_by_id(conn, work_item_id)
        .await?
        .is_none()
    {
        return Err(DbError::Validation(format!(
            "no work item with id {work_item_id}"
        )));
    }
    if let Some(pid) = provider_id {
        if crate::db::ai_provider::find_by_id(conn, pid).await?.is_none() {
            return Err(DbError::Validation(format!("no AI provider with id {pid}")));
        }
    }
    conn.execute(
        "DELETE FROM work_item_policies WHERE workItemId = ?1",
        (work_item_id,),
    )
    .await?;
    conn.execute(
        "INSERT INTO work_item_policies
            (workItemId, allowRead, allowEdit, allowGenerateTests, providerId, effortTier, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        (
            work_item_id,
            allow_read as i64,
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

pub async fn get_for_item(
    conn: &Connection,
    work_item_id: i64,
) -> Result<Option<WorkItemPolicy>> {
    let mut rows = conn
        .query(
            "SELECT id, workItemId, allowRead, allowEdit, allowGenerateTests, providerId, effortTier, updatedAt
             FROM work_item_policies WHERE workItemId = ?1",
            (work_item_id,),
        )
        .await?;
    match rows.next().await? {
        Some(row) => {
            let allow_read: i64 = row.get(2)?;
            let allow_edit: i64 = row.get(3)?;
            let allow_generate_tests: i64 = row.get(4)?;
            Ok(Some(WorkItemPolicy {
                id: row.get(0)?,
                work_item_id: row.get(1)?,
                allow_read: allow_read != 0,
                allow_edit: allow_edit != 0,
                allow_generate_tests: allow_generate_tests != 0,
                provider_id: row.get(5)?,
                effort_tier: row.get(6)?,
                updated_at: row.get(7)?,
            }))
        }
        None => Ok(None),
    }
}

/// The single gate every AI feature must call before touching a provider.
/// No policy row → denied. Flag false → denied. Wrong provider → denied.
pub async fn is_allowed(
    conn: &Connection,
    work_item_id: i64,
    ai_use: AiUse,
    provider_id: i64,
) -> Result<bool> {
    let Some(policy) = get_for_item(conn, work_item_id).await? else {
        return Ok(false);
    };
    if policy.provider_id != Some(provider_id) {
        return Ok(false);
    }
    Ok(match ai_use {
        AiUse::Read => policy.allow_read,
        // Editing or generating tests implies reading the item.
        AiUse::Edit => policy.allow_read && policy.allow_edit,
        AiUse::GenerateTests => policy.allow_read && policy.allow_generate_tests,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ai_provider;
    use crate::db::work_item::{self, tests::db_with_repo};

    async fn db_with_item_and_provider() -> (Connection, i64, i64) {
        let (conn, repo_id) = db_with_repo().await;
        let item_id = work_item::create(&conn, "Login", "feature", repo_id, None, None)
            .await
            .expect("create item");
        let provider_id = ai_provider::add(
            &conn,
            "Claude",
            "https://api.anthropic.com",
            &["claude-sonnet-5"],
            "coperativeai/claude",
        )
        .await
        .expect("add provider");
        (conn, item_id, provider_id)
    }

    #[tokio::test]
    async fn no_policy_means_every_ai_use_is_denied() {
        let (conn, item_id, provider_id) = db_with_item_and_provider().await;
        for ai_use in [AiUse::Read, AiUse::Edit, AiUse::GenerateTests] {
            assert!(
                !is_allowed(&conn, item_id, ai_use, provider_id)
                    .await
                    .expect("gate"),
                "{ai_use:?} must be denied with no policy row"
            );
        }
    }

    #[tokio::test]
    async fn deny_read_blocks_everything() {
        let (conn, item_id, provider_id) = db_with_item_and_provider().await;
        set_policy(&conn, item_id, false, true, true, Some(provider_id), "medium")
            .await
            .expect("set policy");
        for ai_use in [AiUse::Read, AiUse::Edit, AiUse::GenerateTests] {
            assert!(
                !is_allowed(&conn, item_id, ai_use, provider_id)
                    .await
                    .expect("gate"),
                "{ai_use:?} must be denied when allowRead is false"
            );
        }
    }

    #[tokio::test]
    async fn only_the_policys_named_provider_is_usable() {
        let (conn, item_id, provider_id) = db_with_item_and_provider().await;
        let other = ai_provider::add(&conn, "Other", "https://other.example", &[], "alias-2")
            .await
            .expect("add other");
        set_policy(&conn, item_id, true, false, false, Some(provider_id), "low")
            .await
            .expect("set policy");
        assert!(is_allowed(&conn, item_id, AiUse::Read, provider_id)
            .await
            .expect("gate"));
        assert!(!is_allowed(&conn, item_id, AiUse::Read, other)
            .await
            .expect("gate"));
    }

    #[tokio::test]
    async fn one_policy_per_item_and_changes_apply_immediately() {
        let (conn, item_id, provider_id) = db_with_item_and_provider().await;
        set_policy(&conn, item_id, true, true, false, Some(provider_id), "high")
            .await
            .expect("first policy");
        set_policy(&conn, item_id, true, false, false, Some(provider_id), "low")
            .await
            .expect("replace policy");
        let policy = get_for_item(&conn, item_id)
            .await
            .expect("get")
            .expect("exists");
        assert!(!policy.allow_edit, "the replacement policy applies");
        assert!(!is_allowed(&conn, item_id, AiUse::Edit, provider_id)
            .await
            .expect("gate"));
    }

    #[tokio::test]
    async fn deleting_a_provider_nulls_referencing_policies() {
        let (conn, item_id, provider_id) = db_with_item_and_provider().await;
        set_policy(&conn, item_id, true, false, false, Some(provider_id), "low")
            .await
            .expect("set policy");
        ai_provider::remove(&conn, provider_id).await.expect("remove");
        let policy = get_for_item(&conn, item_id)
            .await
            .expect("get")
            .expect("policy survives");
        assert_eq!(policy.provider_id, None);
        assert!(!is_allowed(&conn, item_id, AiUse::Read, provider_id)
            .await
            .expect("gate"));
    }

    #[tokio::test]
    async fn policy_is_deleted_with_its_work_item() {
        let (conn, item_id, provider_id) = db_with_item_and_provider().await;
        set_policy(&conn, item_id, true, false, false, Some(provider_id), "low")
            .await
            .expect("set policy");
        work_item::delete(&conn, item_id).await.expect("delete item");
        assert!(get_for_item(&conn, item_id).await.expect("get").is_none());
    }

    #[tokio::test]
    async fn invalid_effort_tier_is_rejected() {
        let (conn, item_id, provider_id) = db_with_item_and_provider().await;
        let result =
            set_policy(&conn, item_id, true, false, false, Some(provider_id), "maximum").await;
        assert!(matches!(result, Err(DbError::Validation(_))));
    }
}
