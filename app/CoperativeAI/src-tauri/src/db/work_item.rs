//! The `WorkItem` model — see
//! application/claude-only/CoperativeAIdb/WorkItem-model.md (round 2:
//! planning attaches to Products; epic/feature/userStory/task hierarchy
//! governed by the planningHierarchy setting; bug/test attach anywhere).

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

pub const ITEM_TYPES: &[&str] = &["epic", "feature", "userStory", "task", "bug", "test"];
pub const STATUSES: &[&str] = &["planned", "designing", "building", "testing", "done"];

#[derive(Debug, Clone, PartialEq)]
pub struct WorkItem {
    pub id: i64,
    pub title: String,
    pub item_type: String,
    pub status: String,
    pub description: Option<String>,
    pub product_id: i64,
    pub parent_item_id: Option<i64>,
    pub assignee_id: Option<i64>,
    pub sprint_id: Option<i64>,
    pub start_date: Option<i64>,
    pub end_date: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    // Round-2 migration: the round-1 table attached items to repositories.
    // Pre-release data, so a legacy table is dropped and recreated.
    let mut legacy = false;
    {
        let mut rows = conn
            .query("SELECT name FROM pragma_table_info('work_items')", ())
            .await?;
        while let Some(row) = rows.next().await? {
            let column: String = row.get(0)?;
            if column == "repositoryId" {
                legacy = true;
            }
        }
        // The read statement must be fully dropped before schema writes, or
        // turso 0.6 panics ("invalid transaction state for SetCookie").
    }
    if legacy {
        conn.execute("DROP TABLE work_items", ()).await?;
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS work_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            itemType TEXT NOT NULL DEFAULT 'feature',
            status TEXT NOT NULL DEFAULT 'planned',
            description TEXT,
            productId INTEGER NOT NULL,
            parentItemId INTEGER,
            assigneeId INTEGER,
            sprintId INTEGER,
            startDate INTEGER,
            endDate INTEGER,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Creates a work item. Referential and hierarchy rules are enforced here:
/// the product (and parent/same-product) must exist, the type must be in the
/// active planning hierarchy (or bug/test), and a hierarchy child must sit
/// deeper in the hierarchy than its parent.
pub async fn create(
    conn: &Connection,
    title: &str,
    item_type: &str,
    product_id: i64,
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
    if crate::db::product::find_by_id(conn, product_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no Product with id {product_id}"
        )));
    }

    let hierarchy = crate::db::system_setting::get_planning_hierarchy(conn).await?;
    let is_hierarchy_type = hierarchy.iter().any(|t| t == item_type);
    let is_any_level_type = item_type == "bug" || item_type == "test";
    if !is_hierarchy_type && !is_any_level_type {
        return Err(DbError::Validation(format!(
            "'{item_type}' is not part of the active planning hierarchy {hierarchy:?} (bug/test are always allowed)"
        )));
    }

    if let Some(parent) = parent_item_id {
        let Some(parent_item) = find_by_id(conn, parent).await? else {
            return Err(DbError::Validation(format!(
                "no parent work item with id {parent}"
            )));
        };
        if parent_item.product_id != product_id {
            return Err(DbError::Validation(
                "a sub-item must belong to the same Product as its parent".into(),
            ));
        }
        if is_hierarchy_type {
            let parent_level = hierarchy.iter().position(|t| *t == parent_item.item_type);
            let child_level = hierarchy.iter().position(|t| *t == item_type);
            match (parent_level, child_level) {
                (Some(p), Some(c)) if c > p => {}
                _ => {
                    return Err(DbError::Validation(format!(
                        "a '{item_type}' can't sit under a '{}' — sub-items must be deeper in the planning hierarchy {hierarchy:?}",
                        parent_item.item_type
                    )));
                }
            }
        }
    }

    let now = now_millis();
    conn.execute(
        "INSERT INTO work_items (title, itemType, status, description, productId, parentItemId, createdAt, updatedAt)
         VALUES (?1, ?2, 'planned', ?3, ?4, ?5, ?6, ?7)",
        (title, item_type, description, product_id, parent_item_id, now, now),
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

/// Updates assignment and scheduling (assignee, sprint, optional dates) —
/// all nullable so teams that don't assign or schedule aren't forced to.
pub async fn update_item(
    conn: &Connection,
    id: i64,
    assignee_id: Option<i64>,
    sprint_id: Option<i64>,
    start_date: Option<i64>,
    end_date: Option<i64>,
) -> Result<()> {
    let Some(item) = find_by_id(conn, id).await? else {
        return Err(DbError::Validation(format!("no work item with id {id}")));
    };
    if let Some(assignee) = assignee_id {
        if crate::db::team_member::find_by_id(conn, assignee).await?.is_none() {
            return Err(DbError::Validation(format!(
                "no team member with id {assignee}"
            )));
        }
    }
    if let Some(sprint) = sprint_id {
        let Some(sprint_row) = crate::db::sprint::find_by_id(conn, sprint).await? else {
            return Err(DbError::Validation(format!("no sprint with id {sprint}")));
        };
        if sprint_row.product_id != item.product_id {
            return Err(DbError::Validation(
                "a work item can only be scheduled into a sprint of its own Product".into(),
            ));
        }
    }
    if let (Some(start), Some(end)) = (start_date, end_date) {
        if end < start {
            return Err(DbError::Validation(
                "a work item's target date can't be before its start date".into(),
            ));
        }
    }
    conn.execute(
        "UPDATE work_items SET assigneeId = ?1, sprintId = ?2, startDate = ?3, endDate = ?4, updatedAt = ?5 WHERE id = ?6",
        (assignee_id, sprint_id, start_date, end_date, now_millis(), id),
    )
    .await?;
    Ok(())
}

pub async fn list_by_product(conn: &Connection, product_id: i64) -> Result<Vec<WorkItem>> {
    let mut rows = conn
        .query(
            &format!("{SELECT_COLUMNS} FROM work_items WHERE productId = ?1 ORDER BY id"),
            (product_id,),
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
            &format!("{SELECT_COLUMNS} FROM work_items WHERE id = ?1"),
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

const SELECT_COLUMNS: &str = "SELECT id, title, itemType, status, description, productId, parentItemId, assigneeId, sprintId, startDate, endDate, createdAt, updatedAt";

fn row_to_item(row: turso::Row) -> Result<WorkItem> {
    Ok(WorkItem {
        id: row.get(0)?,
        title: row.get(1)?,
        item_type: row.get(2)?,
        status: row.get(3)?,
        description: row.get(4)?,
        product_id: row.get(5)?,
        parent_item_id: row.get(6)?,
        assignee_id: row.get(7)?,
        sprint_id: row.get(8)?,
        start_date: row.get(9)?,
        end_date: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;
    use crate::db::{connect, system_setting};

    #[tokio::test]
    async fn create_requires_title_valid_type_and_product() {
        let (conn, product_id) = db_with_product().await;
        assert!(create(&conn, " ", "feature", product_id, None, None).await.is_err());
        assert!(create(&conn, "X", "milestone", product_id, None, None).await.is_err());
        assert!(create(&conn, "X", "feature", 999, None, None).await.is_err());
        assert!(create(&conn, "X", "feature", product_id, None, None).await.is_ok());
    }

    #[tokio::test]
    async fn hierarchy_children_must_sit_deeper_than_their_parent() {
        let (conn, product_id) = db_with_product().await;
        let epic = create(&conn, "Epic", "epic", product_id, None, None)
            .await
            .expect("epic");
        let feature = create(&conn, "Feature", "feature", product_id, Some(epic), None)
            .await
            .expect("feature under epic");
        create(&conn, "Story", "userStory", product_id, Some(feature), None)
            .await
            .expect("story under feature");
        create(&conn, "Task", "task", product_id, Some(epic), None)
            .await
            .expect("skipping levels downward is allowed");

        // Upward or same-level nesting is not.
        assert!(create(&conn, "Epic 2", "epic", product_id, Some(feature), None)
            .await
            .is_err());
        assert!(create(&conn, "Feature 2", "feature", product_id, Some(feature), None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn bugs_and_tests_attach_at_any_level() {
        let (conn, product_id) = db_with_product().await;
        let epic = create(&conn, "Epic", "epic", product_id, None, None)
            .await
            .expect("epic");
        create(&conn, "Bug", "bug", product_id, Some(epic), None)
            .await
            .expect("bug under epic");
        create(&conn, "Top-level test", "test", product_id, None, None)
            .await
            .expect("test at top level");
    }

    #[tokio::test]
    async fn types_outside_the_active_hierarchy_are_rejected() {
        let (conn, product_id) = db_with_product().await;
        let preset: Vec<String> = ["feature", "task"].iter().map(|s| s.to_string()).collect();
        system_setting::set_planning_hierarchy(&conn, &preset)
            .await
            .expect("set preset");

        assert!(create(&conn, "Epic", "epic", product_id, None, None).await.is_err());
        assert!(create(&conn, "Story", "userStory", product_id, None, None).await.is_err());
        create(&conn, "Feature", "feature", product_id, None, None)
            .await
            .expect("feature allowed");
        create(&conn, "Bug", "bug", product_id, None, None)
            .await
            .expect("bug always allowed");
    }

    #[tokio::test]
    async fn sub_items_stay_within_their_products() {
        let (conn, product_id) = db_with_product().await;
        let other = crate::db::product::create(&conn, "Other", "{}")
            .await
            .expect("other product");
        let epic = create(&conn, "Epic", "epic", product_id, None, None)
            .await
            .expect("epic");
        assert!(create(&conn, "Feature", "feature", other, Some(epic), None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn scheduling_validates_dates_and_cross_product_sprints() {
        let (conn, product_id) = db_with_product().await;
        let item = create(&conn, "Feature", "feature", product_id, None, None)
            .await
            .expect("item");
        assert!(update_item(&conn, item, None, None, Some(200), Some(100))
            .await
            .is_err());
        update_item(&conn, item, None, None, Some(100), Some(200))
            .await
            .expect("valid dates");

        let other = crate::db::product::create(&conn, "Other", "{}")
            .await
            .expect("other product");
        let foreign_sprint = crate::db::sprint::create(&conn, other, "S1", None, None)
            .await
            .expect("foreign sprint");
        assert!(update_item(&conn, item, None, Some(foreign_sprint), None, None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn legacy_repository_table_is_dropped_and_recreated() {
        let conn = connect(":memory:").await.expect("open in-memory db");
        conn.execute(
            "CREATE TABLE work_items (id INTEGER PRIMARY KEY, title TEXT, repositoryId INTEGER)",
            (),
        )
        .await
        .expect("create legacy table");

        create_table(&conn).await.expect("migrate");

        let mut rows = conn
            .query("SELECT name FROM pragma_table_info('work_items')", ())
            .await
            .expect("table info");
        let mut columns: Vec<String> = Vec::new();
        while let Some(row) = rows.next().await.expect("next") {
            columns.push(row.get(0).expect("name"));
        }
        assert!(columns.contains(&"productId".to_string()));
        assert!(!columns.contains(&"repositoryId".to_string()));
    }

    #[tokio::test]
    async fn delete_removes_the_item() {
        let (conn, product_id) = db_with_product().await;
        let id = create(&conn, "Feature", "feature", product_id, None, None)
            .await
            .expect("create");
        delete(&conn, id).await.expect("delete");
        assert!(find_by_id(&conn, id).await.expect("find").is_none());
    }
}
