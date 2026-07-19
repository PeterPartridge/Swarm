//! The `WorkItem` model (round 3) — planning attaches to Products;
//! epic/feature/userStory/task hierarchy governed by the planningHierarchy
//! setting; bug/test attach anywhere. Round 3 adds a Deliverable link and the
//! cost/profit/chargeability fields (visibility gated per Role in the UI).

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
    pub deliverable_id: Option<i64>,
    pub expected_cost: Option<f64>,
    pub estimated_profit: Option<f64>,
    pub chargeable: bool,
    pub customer_cover_pct: Option<f64>,
    /// What could go wrong with this piece of work, in the planner's words.
    /// Free text on purpose — a risk that has to be picked from a dropdown is
    /// a risk nobody writes down.
    pub risk: String,
    /// The Solution this work touches, and so the repository it lands in.
    /// Nullable: plenty of work is not code.
    pub solution_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Assignment / scheduling / commercial fields — replaced wholesale on each
/// save (the frontend sends the item's full current set). All optional so
/// teams that don't assign, schedule, or cost aren't forced to.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WorkItemFields {
    pub assignee_id: Option<i64>,
    pub sprint_id: Option<i64>,
    pub start_date: Option<i64>,
    pub end_date: Option<i64>,
    pub deliverable_id: Option<i64>,
    pub expected_cost: Option<f64>,
    pub estimated_profit: Option<f64>,
    pub chargeable: bool,
    pub customer_cover_pct: Option<f64>,
    pub risk: String,
    pub solution_id: Option<i64>,
}

const SELECT_COLUMNS: &str = "SELECT id, title, itemType, status, description, productId, parentItemId, assigneeId, sprintId, startDate, endDate, deliverableId, expectedCost, estimatedProfit, chargeable, customerCoverPct, risk, solutionId, createdAt, updatedAt";

pub async fn create_table(conn: &Connection) -> Result<()> {
    // Migration: drop & recreate if the table predates round 3 (legacy
    // repositoryId column, or missing the round-3 commercial columns).
    // Pre-release only — standing debt to replace with data-preserving migrations.
    let mut columns: Vec<String> = Vec::new();
    {
        let mut rows = conn
            .query("SELECT name FROM pragma_table_info('work_items')", ())
            .await?;
        while let Some(row) = rows.next().await? {
            columns.push(row.get(0)?);
        }
    }
    let has_table = !columns.is_empty();
    let stale = columns.iter().any(|c| c == "repositoryId")
        || (has_table && !columns.iter().any(|c| c == "expectedCost"));
    if has_table && stale {
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
            deliverableId INTEGER,
            expectedCost REAL,
            estimatedProfit REAL,
            chargeable INTEGER NOT NULL DEFAULT 0,
            customerCoverPct REAL,
            risk TEXT NOT NULL DEFAULT '',
            solutionId INTEGER,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;

    // `risk` and `solutionId` are added to an existing table rather than
    // triggering another drop. Work items are a team's actual plan — the one
    // thing in this database nobody could reconstruct — so they get the
    // data-preserving path even though the columns above do not.
    for (name, ddl) in [
        ("risk", "ALTER TABLE work_items ADD COLUMN risk TEXT NOT NULL DEFAULT ''"),
        ("solutionId", "ALTER TABLE work_items ADD COLUMN solutionId INTEGER"),
    ] {
        if has_table && !stale && !columns.iter().any(|c| c == name) {
            conn.execute(ddl, ()).await?;
        }
    }
    Ok(())
}

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
        return Err(DbError::Validation(format!("no Product with id {product_id}")));
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
            return Err(DbError::Validation(format!("no parent work item with id {parent}")));
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
        "INSERT INTO work_items (title, itemType, status, description, productId, parentItemId, chargeable, createdAt, updatedAt)
         VALUES (?1, ?2, 'planned', ?3, ?4, ?5, 0, ?6, ?7)",
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

/// Updates assignment, scheduling, and commercial fields together.
pub async fn update_item(conn: &Connection, id: i64, fields: WorkItemFields) -> Result<()> {
    let Some(item) = find_by_id(conn, id).await? else {
        return Err(DbError::Validation(format!("no work item with id {id}")));
    };
    if let Some(assignee) = fields.assignee_id {
        if crate::db::team_member::find_by_id(conn, assignee).await?.is_none() {
            return Err(DbError::Validation(format!("no team member with id {assignee}")));
        }
    }
    if let Some(sprint) = fields.sprint_id {
        let Some(sprint_row) = crate::db::sprint::find_by_id(conn, sprint).await? else {
            return Err(DbError::Validation(format!("no sprint with id {sprint}")));
        };
        if sprint_row.product_id != item.product_id {
            return Err(DbError::Validation(
                "a work item can only be scheduled into a sprint of its own Product".into(),
            ));
        }
    }
    if let Some(deliverable) = fields.deliverable_id {
        let Some(d) = crate::db::deliverable::find_by_id(conn, deliverable).await? else {
            return Err(DbError::Validation(format!("no deliverable with id {deliverable}")));
        };
        if d.product_id != item.product_id {
            return Err(DbError::Validation(
                "a work item can only belong to a deliverable of its own Product".into(),
            ));
        }
    }
    if let (Some(start), Some(end)) = (fields.start_date, fields.end_date) {
        if end < start {
            return Err(DbError::Validation(
                "a work item's target date can't be before its start date".into(),
            ));
        }
    }
    if let Some(pct) = fields.customer_cover_pct {
        if !(0.0..=100.0).contains(&pct) {
            return Err(DbError::Validation(
                "the customer-cover percentage must be between 0 and 100".into(),
            ));
        }
    }
    if let Some(solution_id) = fields.solution_id {
        match crate::db::solution::find_by_id(conn, solution_id).await? {
            // Work lands in a repository through a Solution, and a Solution
            // belongs to a Product — so pointing at another Product's Solution
            // would put the work somewhere its plan does not reach.
            Some(solution) if solution.product_id != item.product_id => {
                return Err(DbError::Validation(
                    "a work item can only be linked to a Solution of its own Product".into(),
                ));
            }
            None => {
                return Err(DbError::Validation(format!(
                    "no Solution with id {solution_id}"
                )));
            }
            _ => {}
        }
    }
    conn.execute(
        "UPDATE work_items SET assigneeId=?1, sprintId=?2, startDate=?3, endDate=?4, deliverableId=?5, expectedCost=?6, estimatedProfit=?7, chargeable=?8, customerCoverPct=?9, risk=?10, solutionId=?11, updatedAt=?12 WHERE id=?13",
        (
            fields.assignee_id, fields.sprint_id, fields.start_date, fields.end_date,
            fields.deliverable_id, fields.expected_cost, fields.estimated_profit,
            fields.chargeable as i64, fields.customer_cover_pct,
            fields.risk.as_str(), fields.solution_id, now_millis(), id,
        ),
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
        .query(&format!("{SELECT_COLUMNS} FROM work_items WHERE id = ?1"), (id,))
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_item(row)?)),
        None => Ok(None),
    }
}

/// Deletes a work item with the rows that belong to it (policy + feature design).
pub async fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM work_item_policies WHERE workItemId = ?1", (id,)).await?;
    conn.execute("DELETE FROM feature_designs WHERE workItemId = ?1", (id,)).await?;
    // A link to a deleted item is not a dependency, it is a dangling row.
    crate::db::work_item_link::remove_for_item(conn, id).await?;
    // QA's test cases survive the work item; they are only unlinked.
    conn.execute("UPDATE test_cases SET workItemId = NULL WHERE workItemId = ?1", (id,)).await?;
    conn.execute("DELETE FROM work_items WHERE id = ?1", (id,)).await?;
    Ok(())
}

fn row_to_item(row: turso::Row) -> Result<WorkItem> {
    let chargeable: i64 = row.get(14)?;
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
        deliverable_id: row.get(11)?,
        expected_cost: row.get(12)?,
        estimated_profit: row.get(13)?,
        chargeable: chargeable != 0,
        customer_cover_pct: row.get(15)?,
        risk: row.get(16)?,
        solution_id: row.get(17)?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
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
        let epic = create(&conn, "Epic", "epic", product_id, None, None).await.expect("epic");
        let feature = create(&conn, "Feature", "feature", product_id, Some(epic), None).await.expect("feature");
        create(&conn, "Story", "userStory", product_id, Some(feature), None).await.expect("story");
        assert!(create(&conn, "Epic 2", "epic", product_id, Some(feature), None).await.is_err());
    }

    #[tokio::test]
    async fn bugs_and_tests_attach_at_any_level() {
        let (conn, product_id) = db_with_product().await;
        let epic = create(&conn, "Epic", "epic", product_id, None, None).await.expect("epic");
        create(&conn, "Bug", "bug", product_id, Some(epic), None).await.expect("bug");
        create(&conn, "Top test", "test", product_id, None, None).await.expect("test");
    }

    #[tokio::test]
    async fn types_outside_the_active_hierarchy_are_rejected() {
        let (conn, product_id) = db_with_product().await;
        let preset: Vec<String> = ["feature", "task"].iter().map(|s| s.to_string()).collect();
        system_setting::set_planning_hierarchy(&conn, &preset).await.expect("set");
        assert!(create(&conn, "Epic", "epic", product_id, None, None).await.is_err());
        create(&conn, "Feature", "feature", product_id, None, None).await.expect("feature");
        create(&conn, "Bug", "bug", product_id, None, None).await.expect("bug always allowed");
    }

    #[tokio::test]
    async fn commercial_fields_round_trip_and_validate() {
        let (conn, product_id) = db_with_product().await;
        let item = create(&conn, "Feature", "feature", product_id, None, None).await.expect("item");
        // default chargeable = false, costs null
        let fresh = find_by_id(&conn, item).await.expect("q").unwrap();
        assert!(!fresh.chargeable && fresh.expected_cost.is_none());

        update_item(&conn, item, WorkItemFields {
            expected_cost: Some(1000.0),
            estimated_profit: Some(2500.0),
            chargeable: true,
            customer_cover_pct: Some(60.0),
            ..Default::default()
        }).await.expect("update");
        let saved = find_by_id(&conn, item).await.expect("q").unwrap();
        assert_eq!(saved.expected_cost, Some(1000.0));
        assert_eq!(saved.estimated_profit, Some(2500.0));
        assert!(saved.chargeable);
        assert_eq!(saved.customer_cover_pct, Some(60.0));

        // percentage out of range rejected
        assert!(update_item(&conn, item, WorkItemFields { customer_cover_pct: Some(140.0), ..Default::default() }).await.is_err());
    }

    #[tokio::test]
    async fn scheduling_validates_dates_and_cross_product_sprints() {
        let (conn, product_id) = db_with_product().await;
        let item = create(&conn, "Feature", "feature", product_id, None, None).await.expect("item");
        assert!(update_item(&conn, item, WorkItemFields { start_date: Some(200), end_date: Some(100), ..Default::default() }).await.is_err());
        update_item(&conn, item, WorkItemFields { start_date: Some(100), end_date: Some(200), ..Default::default() }).await.expect("valid");

        let other = crate::db::product::create(&conn, "Other", "{}").await.expect("other");
        let foreign = crate::db::sprint::create(&conn, other, "S1", None, None).await.expect("sprint");
        assert!(update_item(&conn, item, WorkItemFields { sprint_id: Some(foreign), ..Default::default() }).await.is_err());
    }

    #[tokio::test]
    async fn deliverable_must_belong_to_the_same_product() {
        let (conn, product_id) = db_with_product().await;
        let item = create(&conn, "Feature", "feature", product_id, None, None).await.expect("item");
        let deliverable = crate::db::deliverable::create(&conn, product_id, "MVP", "").await.expect("deliverable");
        update_item(&conn, item, WorkItemFields { deliverable_id: Some(deliverable), ..Default::default() }).await.expect("link");

        let other = crate::db::product::create(&conn, "Other", "{}").await.expect("other");
        let foreign = crate::db::deliverable::create(&conn, other, "X", "").await.expect("d2");
        assert!(update_item(&conn, item, WorkItemFields { deliverable_id: Some(foreign), ..Default::default() }).await.is_err());
    }

    /// Risk is free text and stays exactly as it was typed. A planner writing
    /// "the payments vendor may not sign off in time" must get that back, not
    /// a category it was squeezed into.
    #[tokio::test]
    async fn risk_is_stored_verbatim_and_clears_when_emptied() {
        let (conn, product_id) = db_with_product().await;
        let item = create(&conn, "Feature", "feature", product_id, None, None).await.expect("item");
        assert_eq!(find_by_id(&conn, item).await.expect("q").unwrap().risk, "");

        let written = "the payments vendor may not sign off in time — £40k at stake";
        update_item(&conn, item, WorkItemFields { risk: written.into(), ..Default::default() })
            .await
            .expect("update");
        assert_eq!(find_by_id(&conn, item).await.expect("q").unwrap().risk, written);

        update_item(&conn, item, WorkItemFields::default()).await.expect("clear");
        assert_eq!(
            find_by_id(&conn, item).await.expect("q").unwrap().risk,
            "",
            "a risk that has passed must be removable"
        );
    }

    #[tokio::test]
    async fn a_solution_must_belong_to_the_same_product() {
        let (conn, product_id) = db_with_product().await;
        let item = create(&conn, "Feature", "feature", product_id, None, None).await.expect("item");
        let own = crate::db::solution::create(&conn, "API", product_id, "api", "{}").await.expect("s");
        update_item(&conn, item, WorkItemFields { solution_id: Some(own), ..Default::default() })
            .await
            .expect("link");
        assert_eq!(find_by_id(&conn, item).await.expect("q").unwrap().solution_id, Some(own));

        let other = crate::db::product::create(&conn, "Other", "{}").await.expect("other");
        let foreign = crate::db::solution::create(&conn, "Theirs", other, "api", "{}").await.expect("s2");
        assert!(update_item(&conn, item, WorkItemFields { solution_id: Some(foreign), ..Default::default() }).await.is_err());
        assert!(update_item(&conn, item, WorkItemFields { solution_id: Some(999), ..Default::default() }).await.is_err());
    }

    /// Work items are a team's actual plan — the one thing in this database
    /// nobody could reconstruct — so these columns are added, never dropped.
    #[tokio::test]
    async fn adding_risk_and_solution_keeps_existing_work_items() {
        let (conn, product_id) = db_with_product().await;
        let item = create(&conn, "Already planned", "feature", product_id, None, None).await.expect("item");
        conn.execute("ALTER TABLE work_items DROP COLUMN risk", ()).await.expect("undo risk");
        conn.execute("ALTER TABLE work_items DROP COLUMN solutionId", ()).await.expect("undo solution");

        create_table(&conn).await.expect("migrate");

        let survivor = find_by_id(&conn, item).await.expect("q").expect("still there");
        assert_eq!(survivor.title, "Already planned");
        assert_eq!(survivor.risk, "");
    }

    #[tokio::test]
    async fn legacy_repository_table_is_dropped_and_recreated() {
        let conn = connect(":memory:").await.expect("db");
        conn.execute("CREATE TABLE work_items (id INTEGER PRIMARY KEY, title TEXT, repositoryId INTEGER)", ()).await.expect("legacy");
        create_table(&conn).await.expect("migrate");
        let mut rows = conn.query("SELECT name FROM pragma_table_info('work_items')", ()).await.expect("info");
        let mut cols = Vec::new();
        while let Some(r) = rows.next().await.expect("next") { cols.push(r.get::<String>(0).expect("n")); }
        assert!(cols.contains(&"productId".to_string()) && cols.contains(&"expectedCost".to_string()));
        assert!(!cols.contains(&"repositoryId".to_string()));
    }

    #[tokio::test]
    async fn delete_removes_the_item() {
        let (conn, product_id) = db_with_product().await;
        let id = create(&conn, "Feature", "feature", product_id, None, None).await.expect("create");
        delete(&conn, id).await.expect("delete");
        assert!(find_by_id(&conn, id).await.expect("q").is_none());
    }
}
