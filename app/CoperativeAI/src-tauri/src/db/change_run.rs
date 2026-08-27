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
    /// This run's own checkout, so two agents on one Solution never share a
    /// folder. Empty until the run is started.
    pub worktree_path: String,
    /// The terminal it is running in, so its output can be found again.
    pub terminal_id: String,
    pub created_at: i64,
    pub updated_at: i64,
}

const SELECT: &str = "SELECT id, workItemId, solutionId, state, briefPath, findings, filesChanged, worktreePath, terminalId, createdAt, updatedAt FROM change_runs";

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
            worktreePath TEXT NOT NULL DEFAULT '',
            terminalId TEXT NOT NULL DEFAULT '',
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    // Added rather than recreated around: a run is a record of what an agent
    // was asked to do and what came back, which nobody could reconstruct.
    let columns = crate::db::table_columns(conn, "change_runs").await?;
    let has_table = !columns.is_empty();
    for (name, ddl) in [
        (
            "worktreePath",
            "ALTER TABLE change_runs ADD COLUMN worktreePath TEXT NOT NULL DEFAULT ''",
        ),
        (
            "terminalId",
            "ALTER TABLE change_runs ADD COLUMN terminalId TEXT NOT NULL DEFAULT ''",
        ),
    ] {
        if has_table && !columns.iter().any(|c| c == name) {
            conn.execute(ddl, ()).await?;
        }
    }
    Ok(())
}

/// Records where this run's own checkout is, and which terminal it runs in.
pub async fn set_workspace(
    conn: &Connection,
    id: i64,
    worktree_path: &str,
    terminal_id: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE change_runs SET worktreePath = ?1, terminalId = ?2, updatedAt = ?3 WHERE id = ?4",
        (worktree_path, terminal_id, crate::db::now_millis(), id),
    )
    .await?;
    Ok(())
}

/// Every run in a Product, newest first — the list the runs panel shows.
pub async fn list_for_product(conn: &Connection, product_id: i64) -> Result<Vec<ChangeRun>> {
    let mut rows = conn
        .query(
            &format!(
                "{SELECT} WHERE workItemId IN (SELECT id FROM work_items WHERE productId = ?1) \
                 ORDER BY createdAt DESC, id DESC LIMIT 100"
            ),
            (product_id,),
        )
        .await?;
    let mut runs = Vec::new();
    while let Some(row) = rows.next().await? {
        runs.push(row_to_run(row)?);
    }
    Ok(runs)
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
    // **Idempotent, because preparing happens on every save.** The handover
    // brief is rewritten whenever the work is edited — there is no "prepare"
    // button any more — so a run nobody has started yet is *this* attempt being
    // re-prepared, and inserting again would fill the runs list with one row per
    // edit. A run that has moved past `prepared` has had an agent at it, so the
    // next preparation is a genuinely new attempt and goes beside it.
    //
    // Scoped so the read finishes before the write below.
    let unstarted: Option<i64> = {
        let mut rows = conn
            .query(
                "SELECT id FROM change_runs
                 WHERE workItemId = ?1 AND solutionId = ?2 AND state = 'prepared'
                 ORDER BY id DESC",
                (work_item_id, solution_id),
            )
            .await?;
        match rows.next().await? {
            Some(row) => Some(row.get(0)?),
            None => None,
        }
    };
    let now = now_millis();
    if let Some(id) = unstarted {
        // The brief's path follows the file: a run pointing at a brief that has
        // been superseded is worse than no run at all.
        conn.execute(
            "UPDATE change_runs SET briefPath = ?1, updatedAt = ?2 WHERE id = ?3",
            (brief_path, now, id),
        )
        .await?;
        return Ok(id);
    }
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

/// The newest unsettled run in this Solution — the one a review of the
/// working copy is evidence about. Settled runs are done; a review after
/// settling is a new look at the tree, not new evidence about an old decision.
pub async fn latest_open_for_solution(
    conn: &Connection,
    solution_id: i64,
) -> Result<Option<ChangeRun>> {
    let mut rows = conn
        .query(
            &format!(
                "{SELECT} WHERE solutionId = ?1 AND state IN ('prepared', 'reviewed')
                 ORDER BY id DESC LIMIT 1"
            ),
            (solution_id,),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_run(row)?)),
        None => Ok(None),
    }
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
        worktree_path: row.get(7)?,
        terminal_id: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
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
        // Reviewed first: preparing is idempotent while a run is still
        // `prepared`, because it now happens on every save. A second attempt
        // only exists once an agent has been at the first.
        record_review(&conn, first, "[]", 0).await.expect("reviewed");
        let second = prepare(&conn, item, sol, "two.md").await.expect("b");

        let runs = list_for_item(&conn, item).await.expect("list");
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[0].id, second, "the most recent attempt comes first");
        assert_eq!(runs[1].id, first);
    }

    /// A settled run is done — a later review is a new look at the tree, not
    /// new evidence about an old decision.
    #[tokio::test]
    async fn a_review_attaches_to_the_newest_unsettled_run_only() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;

        assert!(latest_open_for_solution(&conn, sol).await.expect("q").is_none());

        let first = prepare(&conn, item, sol, "one.md").await.expect("a");
        // As above: a second attempt needs the first to have moved on.
        record_review(&conn, first, "[]", 0).await.expect("reviewed");
        let second = prepare(&conn, item, sol, "two.md").await.expect("b");
        assert_eq!(
            latest_open_for_solution(&conn, sol).await.expect("q").unwrap().id,
            second
        );

        settle(&conn, second, "discarded").await.expect("settle");
        assert_eq!(
            latest_open_for_solution(&conn, sol).await.expect("q").unwrap().id,
            first,
            "the settled run stops attracting reviews; the older open one remains"
        );

        settle(&conn, first, "kept").await.expect("settle");
        assert!(latest_open_for_solution(&conn, sol).await.expect("q").is_none());
    }

    #[tokio::test]
    async fn deleting_a_work_item_takes_its_runs_with_it() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;
        prepare(&conn, item, sol, "b.md").await.expect("prepare");

        work_item::delete(&conn, item).await.expect("delete");

        assert!(list_for_item(&conn, item).await.expect("list").is_empty());
    }

    /// **Preparing is now something that happens on every save**, not a button
    /// somebody remembers to press — so it has to be idempotent. A run nobody
    /// has started yet is the same attempt being re-prepared; making a new row
    /// each time would fill the runs list with one entry per keystroke.
    #[tokio::test]
    async fn re_preparing_an_unstarted_run_is_the_same_run() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;

        let first = prepare(&conn, item, sol, "briefs/checkout-1.md").await.expect("prepare");
        let again = prepare(&conn, item, sol, "briefs/checkout-1.md").await.expect("again");

        assert_eq!(again, first, "the same attempt, not a second one");
        assert_eq!(list_for_item(&conn, item).await.expect("list").len(), 1);
    }

    /// Once a run has been reviewed an agent has been at it, so the next
    /// preparation is a genuinely new attempt and must not overwrite the old
    /// one's record.
    #[tokio::test]
    async fn a_run_that_has_moved_on_gets_a_new_attempt_beside_it() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;

        let first = prepare(&conn, item, sol, "briefs/checkout-1.md").await.expect("prepare");
        record_review(&conn, first, "[]", 3).await.expect("reviewed");

        let second = prepare(&conn, item, sol, "briefs/checkout-2.md").await.expect("second");
        assert_ne!(second, first);
        assert_eq!(list_for_item(&conn, item).await.expect("list").len(), 2);
    }

    /// The brief is rewritten as the work is edited, so the row must follow the
    /// file — a run pointing at last week's brief is worse than none.
    #[tokio::test]
    async fn re_preparing_updates_where_the_brief_is() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;

        let id = prepare(&conn, item, sol, "briefs/old.md").await.expect("prepare");
        prepare(&conn, item, sol, "briefs/new.md").await.expect("again");

        let run = find_by_id(&conn, id).await.expect("q").expect("there");
        assert_eq!(run.brief_path, "briefs/new.md");
    }

    #[tokio::test]
    async fn findings_must_be_json() {
        let (conn, product_id) = db_with_product().await;
        let (item, sol) = setup(&conn, product_id).await;
        let id = prepare(&conn, item, sol, "b.md").await.expect("prepare");
        assert!(record_review(&conn, id, "not json", 1).await.is_err());
    }
}
