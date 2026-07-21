//! The `WorkItemPlan` model — what one work item requires of one Solution.
//!
//! A work item that touches an API and the web app in front of it needs two
//! different sets of changes, two branches, and two sets of tests. So the plan
//! is per (work item, Solution) rather than per work item: one row for each
//! repository the work lands in.
//!
//! The written half (changes, tests, branch) is the team's. The schema half
//! (`api_schema`, `page_schema`, `files_to_change`) is what the AI produces
//! from it, and is what the handover brief carries to whoever writes the code.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct WorkItemPlan {
    pub id: i64,
    pub work_item_id: i64,
    pub solution_id: i64,
    /// What has to change in this Solution, in the team's own words.
    pub changes_required: String,
    /// What must be proved, before anything is generated to prove it.
    pub unit_tests: String,
    pub branch_name: String,
    /// The branch this one is cut from — a detail that is obvious to whoever
    /// set it up and a guess to everyone else.
    pub clone_from: String,
    /// JSON array of file paths: UI mockups and screenshots.
    pub mockups: String,
    /// AI-generated, from everything above.
    pub api_schema: String,
    pub page_schema: String,
    pub files_to_change: String,
    pub created_at: i64,
    pub updated_at: i64,
}

const SELECT: &str = "SELECT id, workItemId, solutionId, changesRequired, unitTests, branchName, cloneFrom, mockups, apiSchema, pageSchema, filesToChange, createdAt, updatedAt FROM work_item_plans";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS work_item_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workItemId INTEGER NOT NULL,
            solutionId INTEGER NOT NULL,
            changesRequired TEXT NOT NULL DEFAULT '',
            unitTests TEXT NOT NULL DEFAULT '',
            branchName TEXT NOT NULL DEFAULT '',
            cloneFrom TEXT NOT NULL DEFAULT '',
            mockups TEXT NOT NULL DEFAULT '[]',
            apiSchema TEXT NOT NULL DEFAULT '',
            pageSchema TEXT NOT NULL DEFAULT '',
            filesToChange TEXT NOT NULL DEFAULT '',
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL,
            UNIQUE(workItemId, solutionId)
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Attaches a Solution to a work item — the "this work touches that repo"
/// decision, before anything has been written about it.
pub async fn attach(conn: &Connection, work_item_id: i64, solution_id: i64) -> Result<i64> {
    let Some(item) = crate::db::work_item::find_by_id(conn, work_item_id).await? else {
        return Err(DbError::Validation(format!(
            "no work item with id {work_item_id}"
        )));
    };
    match crate::db::solution::find_by_id(conn, solution_id).await? {
        // Work reaches a repository through a Solution of its own Product;
        // another Product's repo is not somewhere this plan can send anyone.
        Some(solution) if solution.product_id != item.product_id => {
            return Err(DbError::Validation(
                "a work item can only affect a Solution of its own Product".into(),
            ));
        }
        None => {
            return Err(DbError::Validation(format!(
                "no Solution with id {solution_id}"
            )));
        }
        _ => {}
    }

    // Scoped so the read is finished before the write — an open statement
    // silently loses the write that follows it.
    let existing: Option<i64> = {
        let mut rows = conn
            .query(
                "SELECT id FROM work_item_plans WHERE workItemId = ?1 AND solutionId = ?2",
                (work_item_id, solution_id),
            )
            .await?;
        match rows.next().await? {
            Some(row) => Some(row.get(0)?),
            None => None,
        }
    };
    if let Some(id) = existing {
        return Ok(id);
    }

    let now = now_millis();
    conn.execute(
        "INSERT INTO work_item_plans (workItemId, solutionId, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, ?4)",
        (work_item_id, solution_id, now, now),
    )
    .await?;
    last_insert_id(conn).await
}

/// The team's half: what changes, what to prove, and where the branch comes
/// from. Replaced wholesale — the form sends its full current state.
pub async fn set_written(
    conn: &Connection,
    id: i64,
    changes_required: &str,
    unit_tests: &str,
    branch_name: &str,
    clone_from: &str,
    mockups_json: &str,
) -> Result<()> {
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no plan with id {id}")));
    }
    serde_json::from_str::<Vec<String>>(mockups_json)
        .map_err(|e| DbError::Validation(format!("mockups must be a JSON array of paths: {e}")))?;
    conn.execute(
        "UPDATE work_item_plans SET changesRequired = ?1, unitTests = ?2, branchName = ?3, cloneFrom = ?4, mockups = ?5, updatedAt = ?6 WHERE id = ?7",
        (changes_required, unit_tests, branch_name, clone_from, mockups_json, now_millis(), id),
    )
    .await?;
    Ok(())
}

/// The AI's half. Kept separate from `set_written` so regenerating schemas
/// never overwrites what a person typed.
pub async fn set_generated(
    conn: &Connection,
    id: i64,
    api_schema: &str,
    page_schema: &str,
    files_to_change: &str,
) -> Result<()> {
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no plan with id {id}")));
    }
    conn.execute(
        "UPDATE work_item_plans SET apiSchema = ?1, pageSchema = ?2, filesToChange = ?3, updatedAt = ?4 WHERE id = ?5",
        (api_schema, page_schema, files_to_change, now_millis(), id),
    )
    .await?;
    Ok(())
}

pub async fn list_for_item(conn: &Connection, work_item_id: i64) -> Result<Vec<WorkItemPlan>> {
    let mut rows = conn
        .query(&format!("{SELECT} WHERE workItemId = ?1 ORDER BY id"), (work_item_id,))
        .await?;
    let mut plans = Vec::new();
    while let Some(row) = rows.next().await? {
        plans.push(row_to_plan(row)?);
    }
    Ok(plans)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<WorkItemPlan>> {
    let mut rows = conn.query(&format!("{SELECT} WHERE id = ?1"), (id,)).await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_plan(row)?)),
        None => Ok(None),
    }
}

/// Detaches a Solution from a work item, losing what was written about it.
pub async fn detach(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM work_item_plans WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

pub async fn remove_for_item(conn: &Connection, work_item_id: i64) -> Result<()> {
    conn.execute("DELETE FROM work_item_plans WHERE workItemId = ?1", (work_item_id,))
        .await?;
    Ok(())
}

/// Fills a branch-naming pattern from the Develop Strategy.
///
/// `{id}`, `{title}` and `{type}` are replaced; anything else is left alone, so
/// a pattern with a typo produces a visibly odd branch name rather than a
/// silently empty one. Pure, so the substitution is testable without a database.
pub fn branch_from_pattern(pattern: &str, item_id: i64, title: &str, item_type: &str) -> String {
    if pattern.trim().is_empty() {
        return String::new();
    }
    pattern
        .replace("{id}", &item_id.to_string())
        .replace("{title}", &crate::emit::safe_stem(title))
        .replace("{type}", item_type)
}

fn row_to_plan(row: turso::Row) -> Result<WorkItemPlan> {
    Ok(WorkItemPlan {
        id: row.get(0)?,
        work_item_id: row.get(1)?,
        solution_id: row.get(2)?,
        changes_required: row.get(3)?,
        unit_tests: row.get(4)?,
        branch_name: row.get(5)?,
        clone_from: row.get(6)?,
        mockups: row.get(7)?,
        api_schema: row.get(8)?,
        page_schema: row.get(9)?,
        files_to_change: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;
    use crate::db::{solution, work_item};

    async fn setup(conn: &Connection, product_id: i64) -> (i64, i64) {
        let item = work_item::create(conn, "Add checkout", "feature", product_id, None, None)
            .await
            .expect("item");
        let sol = solution::create(conn, "API", product_id, "api", "{}").await.expect("solution");
        (item, sol)
    }

    #[tokio::test]
    async fn a_solution_is_attached_once_and_written_up() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;

        let id = attach(&conn, item, sol).await.expect("attach");
        assert_eq!(attach(&conn, item, sol).await.expect("again"), id, "idempotent");

        set_written(
            &conn, id, "Add POST /checkout", "It charges once", "feature/12-checkout", "main",
            r#"["C:/shots/basket.png"]"#,
        )
        .await
        .expect("write");

        let plan = find_by_id(&conn, id).await.expect("q").expect("exists");
        assert_eq!(plan.changes_required, "Add POST /checkout");
        assert_eq!(plan.branch_name, "feature/12-checkout");
        assert_eq!(plan.clone_from, "main");
        assert!(plan.mockups.contains("basket.png"));
    }

    /// Regenerating schemas must never eat what a person typed.
    #[tokio::test]
    async fn the_generated_half_and_the_written_half_do_not_overwrite_each_other() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;
        let id = attach(&conn, item, sol).await.expect("attach");

        set_written(&conn, id, "Add POST /checkout", "charges once", "b", "main", "[]")
            .await
            .expect("write");
        set_generated(&conn, id, "POST /checkout", "Basket page", "src/api/checkout.rs")
            .await
            .expect("generate");

        let plan = find_by_id(&conn, id).await.expect("q").unwrap();
        assert_eq!(plan.changes_required, "Add POST /checkout", "the writing survives");
        assert_eq!(plan.api_schema, "POST /checkout");

        // and writing again leaves the generated half alone
        set_written(&conn, id, "Add POST /checkout and a receipt", "charges once", "b", "main", "[]")
            .await
            .expect("write again");
        assert_eq!(
            find_by_id(&conn, id).await.expect("q").unwrap().api_schema,
            "POST /checkout",
        );
    }

    #[tokio::test]
    async fn a_plan_can_only_name_a_solution_of_the_items_own_product() {
        let (conn, product_id) = db_with_product().await;
        let (item, _sol) = setup(&conn, product_id).await;

        let other = crate::db::product::create(&conn, "Other", "{}").await.expect("p2");
        let foreign = solution::create(&conn, "Theirs", other, "api", "{}").await.expect("s2");

        assert!(attach(&conn, item, foreign).await.is_err());
        assert!(attach(&conn, item, 999).await.is_err());
        assert!(attach(&conn, 999, 1).await.is_err());
    }

    #[tokio::test]
    async fn several_solutions_can_be_affected_by_one_work_item() {
        let (conn, product_id) = db_with_product().await;
        let (item, api) = setup(&conn, product_id).await;
        let web = solution::create(&conn, "Web", product_id, "website", "{}").await.expect("web");

        attach(&conn, item, api).await.expect("api");
        attach(&conn, item, web).await.expect("web");

        assert_eq!(list_for_item(&conn, item).await.expect("list").len(), 2);
    }

    #[tokio::test]
    async fn detaching_and_deleting_clean_up() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;
        let id = attach(&conn, item, sol).await.expect("attach");

        detach(&conn, id).await.expect("detach");
        assert!(list_for_item(&conn, item).await.expect("list").is_empty());

        attach(&conn, item, sol).await.expect("re-attach");
        work_item::delete(&conn, item).await.expect("delete item");
        assert!(list_for_item(&conn, item).await.expect("list").is_empty());
    }

    #[tokio::test]
    async fn mockups_must_be_a_json_array() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;
        let id = attach(&conn, item, sol).await.expect("attach");
        assert!(set_written(&conn, id, "", "", "", "", "not json").await.is_err());
    }

    /// A pattern with a typo should produce a visibly odd branch name, not a
    /// silently empty one.
    #[test]
    fn a_branch_pattern_fills_from_the_work_item() {
        assert_eq!(
            branch_from_pattern("feature/{id}-{title}", 12, "Add checkout!", "feature"),
            "feature/12-add-checkout"
        );
        assert_eq!(
            branch_from_pattern("{type}/{id}", 7, "Whatever", "bug"),
            "bug/7"
        );
        assert_eq!(
            branch_from_pattern("release/{nonsense}", 1, "X", "feature"),
            "release/{nonsense}",
            "an unknown placeholder is left visible rather than blanked"
        );
        assert_eq!(branch_from_pattern("  ", 1, "X", "feature"), "");
    }
}
