//! The `WorkItem` model — see
//! application/claude-only/CoperativeAIdb/WorkItem-model.md.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

pub const ITEM_TYPES: &[&str] = &["feature", "bug", "test", "spec"];
pub const STATUSES: &[&str] = &["planned", "designing", "building", "testing", "done"];

#[derive(Debug, Clone, PartialEq)]
pub struct WorkItem {
    pub id: i64,
    pub title: String,
    pub item_type: String,
    pub status: String,
    pub description: Option<String>,
    pub repository_id: i64,
    pub parent_item_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS work_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            itemType TEXT NOT NULL DEFAULT 'feature',
            status TEXT NOT NULL DEFAULT 'planned',
            description TEXT,
            repositoryId INTEGER NOT NULL,
            parentItemId INTEGER,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Creates a work item. Referential rules (repository exists, parent exists)
/// are enforced here because the embedded engine doesn't enforce FKs for us.
pub async fn create(
    conn: &Connection,
    title: &str,
    item_type: &str,
    repository_id: i64,
    parent_item_id: Option<i64>,
    description: Option<&str>,
) -> Result<i64> {
    if title.trim().is_empty() {
        return Err(DbError::Validation("a work item needs a title".into()));
    }
    if !ITEM_TYPES.contains(&item_type) {
        return Err(DbError::Validation(format!(
            "itemType must be one of {ITEM_TYPES:?}, got '{item_type}'"
        )));
    }
    require_repository(conn, repository_id).await?;
    if let Some(parent) = parent_item_id {
        if find_by_id(conn, parent).await?.is_none() {
            return Err(DbError::Validation(format!(
                "no parent work item with id {parent}"
            )));
        }
    }
    let now = now_millis();
    conn.execute(
        "INSERT INTO work_items (title, itemType, status, description, repositoryId, parentItemId, createdAt, updatedAt)
         VALUES (?1, ?2, 'planned', ?3, ?4, ?5, ?6, ?7)",
        (title, item_type, description, repository_id, parent_item_id, now, now),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn update_status(conn: &Connection, id: i64, status: &str) -> Result<()> {
    if !STATUSES.contains(&status) {
        return Err(DbError::Validation(format!(
            "status must be one of {STATUSES:?}, got '{status}'"
        )));
    }
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no work item with id {id}")));
    }
    conn.execute(
        "UPDATE work_items SET status = ?1, updatedAt = ?2 WHERE id = ?3",
        (status, now_millis(), id),
    )
    .await?;
    Ok(())
}

pub async fn list_all(conn: &Connection) -> Result<Vec<WorkItem>> {
    let mut rows = conn
        .query(
            "SELECT id, title, itemType, status, description, repositoryId, parentItemId, createdAt, updatedAt
             FROM work_items ORDER BY id",
            (),
        )
        .await?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().await? {
        items.push(row_to_item(row)?);
    }
    Ok(items)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<WorkItem>> {
    let mut rows = conn
        .query(
            "SELECT id, title, itemType, status, description, repositoryId, parentItemId, createdAt, updatedAt
             FROM work_items WHERE id = ?1",
            (id,),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_item(row)?)),
        None => Ok(None),
    }
}

/// Deletes a work item together with the rows that belong to it (its policy
/// and feature design) — the code-enforced equivalent of ON DELETE CASCADE.
pub async fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM work_item_policies WHERE workItemId = ?1",
        (id,),
    )
    .await?;
    conn.execute("DELETE FROM feature_designs WHERE workItemId = ?1", (id,))
        .await?;
    conn.execute("DELETE FROM work_items WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

pub(crate) async fn require_repository(conn: &Connection, repository_id: i64) -> Result<()> {
    if crate::db::repository::find_by_id(conn, repository_id)
        .await?
        .is_none()
    {
        return Err(DbError::Validation(format!(
            "no repository with id {repository_id}"
        )));
    }
    Ok(())
}

fn row_to_item(row: turso::Row) -> Result<WorkItem> {
    Ok(WorkItem {
        id: row.get(0)?,
        title: row.get(1)?,
        item_type: row.get(2)?,
        status: row.get(3)?,
        description: row.get(4)?,
        repository_id: row.get(5)?,
        parent_item_id: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::repository::tests::temp_repo_dir;
    use crate::db::{connect, create_all_tables, repository};

    pub(crate) async fn db_with_repo() -> (Connection, i64) {
        let conn = connect(":memory:").await.expect("open in-memory db");
        create_all_tables(&conn).await.expect("create tables");
        let repo_id = repository::add(&conn, "repo", &temp_repo_dir("workitem"), None, None)
            .await
            .expect("add repo");
        (conn, repo_id)
    }

    #[tokio::test]
    async fn create_requires_title_type_and_repository() {
        let (conn, repo_id) = db_with_repo().await;
        assert!(create(&conn, " ", "feature", repo_id, None, None).await.is_err());
        assert!(create(&conn, "Login", "epic", repo_id, None, None).await.is_err());
        assert!(create(&conn, "Login", "feature", 999, None, None).await.is_err());
        assert!(create(&conn, "Login", "feature", repo_id, None, None).await.is_ok());
    }

    #[tokio::test]
    async fn status_is_restricted_to_the_workflow_list() {
        let (conn, repo_id) = db_with_repo().await;
        let id = create(&conn, "Login", "feature", repo_id, None, None)
            .await
            .expect("create");
        assert!(update_status(&conn, id, "shipped").await.is_err());
        update_status(&conn, id, "building").await.expect("valid status");
        let item = find_by_id(&conn, id).await.expect("find").unwrap();
        assert_eq!(item.status, "building");
    }

    #[tokio::test]
    async fn parent_must_be_an_existing_work_item() {
        let (conn, repo_id) = db_with_repo().await;
        assert!(create(&conn, "Scenario", "test", repo_id, Some(42), None)
            .await
            .is_err());
        let parent = create(&conn, "Feature", "feature", repo_id, None, None)
            .await
            .expect("create parent");
        let child = create(&conn, "Scenario", "test", repo_id, Some(parent), None)
            .await
            .expect("create child");
        let item = find_by_id(&conn, child).await.expect("find").unwrap();
        assert_eq!(item.parent_item_id, Some(parent));
    }

    #[tokio::test]
    async fn updated_at_changes_on_update() {
        let (conn, repo_id) = db_with_repo().await;
        let id = create(&conn, "Login", "feature", repo_id, None, None)
            .await
            .expect("create");
        let before = find_by_id(&conn, id).await.expect("find").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        update_status(&conn, id, "designing").await.expect("update");
        let after = find_by_id(&conn, id).await.expect("find").unwrap();
        assert!(after.updated_at > before.updated_at);
    }

    #[tokio::test]
    async fn delete_removes_the_item() {
        let (conn, repo_id) = db_with_repo().await;
        let id = create(&conn, "Login", "feature", repo_id, None, None)
            .await
            .expect("create");
        delete(&conn, id).await.expect("delete");
        assert!(find_by_id(&conn, id).await.expect("find").is_none());
    }
}
