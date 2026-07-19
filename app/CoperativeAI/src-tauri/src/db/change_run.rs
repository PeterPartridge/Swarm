//! The `ChangeRun` model — one handover of a work item to a coding agent.
//!
//! **There is no cost column, deliberately.** Claude Code is billed against its
//! own subscription; this app's ledger meters the API calls it makes itself. A
//! `cost` field here would be filled with either a guess or a zero, and both
//! would be read as fact. What the app genuinely knows is what it handed over,
//! when, and what the review made of what came back — so that is what is stored.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

/// `prepared` — the brief was written; nothing has run yet.
/// `reviewed` — changes came back and were checked against the rules.
/// `kept` / `discarded` — what the developer decided, recorded by them.
pub const RUN_STATES: &[&str] = &["prepared", "reviewed", "kept", "discarded"];

#[derive(Debug, Clone, PartialEq)]
pub struct ChangeRun {
    pub id: i64,
    pub work_item_id: i64,
    pub solution_id: i64,
    pub state: String,
    /// Where the brief was written, relative to the working copy.
    pub brief_path: String,
    /// Findings from the review, as JSON. Empty until reviewed.
    pub findings: String,
    pub files_changed: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

const SELECT: &str = "SELECT id, workItemId, solutionId, state, briefPath, findings, filesChanged, createdAt, updatedAt FROM change_runs";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS change_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workItemId INTEGER NOT NULL,
            solutionId INTEGER NOT NULL,
            state TEXT NOT NULL DEFAULT 'prepared',
            briefPath TEXT NOT NULL DEFAULT '',
            findings TEXT NOT NULL DEFAULT '[]',
            filesChanged INTEGER NOT NULL DEFAULT 0,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Records that a work item was prepared for an agent.
pub async fn prepare(
    conn: &Connection,
    work_item_id: i64,
    solution_id: i64,
    brief_path: &str,
) -> Result<i64> {
    let Some(item) = crate::db::work_item::find_by_id(conn, work_item_id).await? else {
        return Err(DbError::Validation(format!(
            "no work item with id {work_item_id}"
        )));
    };
    match crate::db::solution::find_by_id(conn, solution_id).await? {
        Some(solution) if solution.product_id != item.product_id => {
            return Err(DbError::Validation(
                "a work item can only be handed over into a Solution of its own Product".into(),
            ));
        }
        None => {
            return Err(DbError::Validation(format!(
                "no Solution with id {solution_id}"
            )));
        }
        _ => {}
    }
    let now = now_millis();
    conn.execute(
        "INSERT INTO change_runs (workItemId, solutionId, state, briefPath, findings, filesChanged, createdAt, updatedAt)
         VALUES (?1, ?2, 'prepared', ?3, '[]', 0, ?4, ?5)",
        (work_item_id, solution_id, brief_path, now, now),
    )
    .await?;
    last_insert_id(conn).await
}

/// Records what the review found. Kept separate from `prepare` because a run
/// may be reviewed several times as work continues.
pub async fn record_review(
    conn: &Connection,
    id: i64,
    findings_json: &str,
    files_changed: i64,
) -> Result<()> {
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no change run with id {id}")));
    }
    serde_json::from_str::<serde_json::Value>(findings_json)
        .map_err(|e| DbError::Validation(format!("findings must be JSON: {e}")))?;
    conn.execute(
        "UPDATE change_runs SET state = 'reviewed', findings = ?1, filesChanged = ?2, updatedAt = ?3 WHERE id = ?4",
        (findings_json, files_changed, now_millis(), id),
    )
    .await?;
    Ok(())
}

/// What the developer decided. The app does not decide this — it cannot see
/// whether the change was actually committed, so it records what it is told.
pub async fn settle(conn: &Connection, id: i64, state: &str) -> Result<()> {
    if !matches!(state, "kept" | "discarded") {
        return Err(DbError::Validation(
            "a run is settled as either kept or discarded".into(),
        ));
    }
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no change run with id {id}")));
    }
    conn.execute(
        "UPDATE change_runs SET state = ?1, updatedAt = ?2 WHERE id = ?3",
        (state, now_millis(), id),
    )
    .await?;
    Ok(())
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<ChangeRun>> {
    let mut rows = conn.query(&format!("{SELECT} WHERE id = ?1"), (id,)).await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_run(row)?)),
        None => Ok(None),
    }
}

/// Runs for one work item, newest first — the history of trying to build it.
pub async fn list_for_item(conn: &Connection, work_item_id: i64) -> Result<Vec<ChangeRun>> {
    let mut rows = conn
        .query(
            &format!("{SELECT} WHERE workItemId = ?1 ORDER BY id DESC"),
            (work_item_id,),
        )
        .await?;
    let mut runs = Vec::new();
    while let Some(row) = rows.next().await? {
        runs.push(row_to_run(row)?);
    }
    Ok(runs)
}

/// Removes the runs of a deleted work item.
pub async fn remove_for_item(conn: &Connection, work_item_id: i64) -> Result<()> {
    conn.execute("DELETE FROM change_runs WHERE workItemId = ?1", (work_item_id,))
        .await?;
    Ok(())
}

fn row_to_run(row: turso::Row) -> Result<ChangeRun> {
    Ok(ChangeRun {
        id: row.get(0)?,
        work_item_id: row.get(1)?,
        solution_id: row.get(2)?,
        state: row.get(3)?,
        brief_path: row.get(4)?,
        findings: row.get(5)?,
        files_changed: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
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
    async fn a_prepared_run_records_what_was_handed_over() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;

        let id = prepare(&conn, item, sol, ".coperativeai/briefs/add-checkout.md")
            .await
            .expect("prepare");

        let run = find_by_id(&conn, id).await.expect("q").expect("exists");
        assert_eq!(run.state, "prepared");
        assert_eq!(run.brief_path, ".coperativeai/briefs/add-checkout.md");
        assert_eq!(run.files_changed, 0);
    }

    /// A run may be reviewed several times as the work continues, so the
    /// review is recorded separately from the handover.
    #[tokio::test]
    async fn a_review_can_be_recorded_more_than_once() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;
        let id = prepare(&conn, item, sol, "b.md").await.expect("prepare");

        record_review(&conn, id, r#"[{"kind":"noTests"}]"#, 3).await.expect("first");
        record_review(&conn, id, "[]", 5).await.expect("second");

        let run = find_by_id(&conn, id).await.expect("q").unwrap();
        assert_eq!(run.state, "reviewed");
        assert_eq!(run.files_changed, 5);
        assert_eq!(run.findings, "[]");
    }

    /// The app cannot see whether a change was committed, so it records what
    /// it is told rather than inferring.
    #[tokio::test]
    async fn a_run_is_settled_as_kept_or_discarded_and_nothing_else() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;
        let id = prepare(&conn, item, sol, "b.md").await.expect("prepare");

        settle(&conn, id, "kept").await.expect("kept");
        assert_eq!(find_by_id(&conn, id).await.expect("q").unwrap().state, "kept");

        assert!(settle(&conn, id, "probably fine").await.is_err());
        assert!(settle(&conn, 999, "kept").await.is_err());
    }

    #[tokio::test]
    async fn runs_are_validated_against_the_items_own_product() {
        let (conn, product_id) = db_with_product().await;
        let (item, _sol) = setup(&conn, product_id).await;

        let other = crate::db::product::create(&conn, "Other", "{}").await.expect("p2");
        let foreign = solution::create(&conn, "Theirs", other, "api", "{}").await.expect("s2");

        assert!(prepare(&conn, item, foreign, "b.md").await.is_err());
        assert!(prepare(&conn, 999, foreign, "b.md").await.is_err());
    }

    #[tokio::test]
    async fn the_history_of_an_item_reads_newest_first() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;
        let first = prepare(&conn, item, sol, "one.md").await.expect("a");
        let second = prepare(&conn, item, sol, "two.md").await.expect("b");

        let runs = list_for_item(&conn, item).await.expect("list");
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[0].id, second, "the most recent attempt comes first");
        assert_eq!(runs[1].id, first);
    }

    #[tokio::test]
    async fn deleting_a_work_item_takes_its_runs_with_it() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;
        prepare(&conn, item, sol, "b.md").await.expect("prepare");

        work_item::delete(&conn, item).await.expect("delete");

        assert!(list_for_item(&conn, item).await.expect("list").is_empty());
    }

    #[tokio::test]
    async fn findings_must_be_json() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;
        let id = prepare(&conn, item, sol, "b.md").await.expect("prepare");
        assert!(record_review(&conn, id, "not json", 1).await.is_err());
    }
}
