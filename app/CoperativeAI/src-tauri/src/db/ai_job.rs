//! Work submitted to the AI and not yet finished.
//!
//! **In the database, not in memory.** A job you submitted and then closed the
//! app on must not vanish silently — the rule this project settled the
//! expensive way, when a whole session's writes turned out never to have
//! reached disk. A queue held in a `Vec` behind a mutex would lose everything
//! on exit and leave no trace that it had.
//!
//! It also makes the answer to "what is it doing?" a question about a table
//! rather than about a running task, which is the difference between a UI that
//! can show a queue and one that can only show a spinner.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

/// `queued` — waiting for a slot.
/// `running` — a request is in flight.
/// `done` — finished and wrote something.
/// `blocked` — the AI declined, or the budget refused it. Not a failure.
/// `failed` — it broke.
pub const STATES: &[&str] = &["queued", "running", "done", "blocked", "failed"];

#[derive(Debug, Clone, PartialEq)]
pub struct AiJob {
    pub id: i64,
    pub work_item_id: i64,
    /// The same purpose string the ledger uses, so a job can be lined up
    /// against what it cost.
    pub purpose: String,
    pub state: String,
    /// What happened, in the words the user should read.
    pub message: String,
    pub submitted_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
}

const SELECT: &str = "SELECT id, workItemId, purpose, state, message, submittedAt, startedAt, finishedAt FROM ai_jobs";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workItemId INTEGER NOT NULL,
            purpose TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'queued',
            message TEXT NOT NULL DEFAULT '',
            submittedAt INTEGER NOT NULL,
            startedAt INTEGER,
            finishedAt INTEGER
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Puts a work item in the queue.
///
/// Refuses a second job for the same item while one is outstanding: submitting
/// twice is a double-click, not a request to pay for the same schemas twice.
pub async fn submit(conn: &Connection, work_item_id: i64, purpose: &str) -> Result<i64> {
    if crate::db::work_item::find_by_id(conn, work_item_id)
        .await?
        .is_none()
    {
        return Err(DbError::Validation(format!(
            "no work item with id {work_item_id}"
        )));
    }
    let outstanding = list_for_item(conn, work_item_id)
        .await?
        .into_iter()
        .any(|j| j.state == "queued" || j.state == "running");
    if outstanding {
        return Err(DbError::Validation(
            "that work item is already waiting for the AI — let it finish first".into(),
        ));
    }

    conn.execute(
        "INSERT INTO ai_jobs (workItemId, purpose, state, submittedAt) VALUES (?1, ?2, 'queued', ?3)",
        (work_item_id, purpose, now_millis()),
    )
    .await?;
    last_insert_id(conn).await
}

/// The oldest job waiting, if any. Oldest first so a queue is a queue.
pub async fn next_queued(conn: &Connection) -> Result<Option<AiJob>> {
    let mut rows = conn
        .query(
            &format!("{SELECT} WHERE state = 'queued' ORDER BY submittedAt, id LIMIT 1"),
            (),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_job(row)?)),
        None => Ok(None),
    }
}

pub async fn mark_running(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE ai_jobs SET state = 'running', startedAt = ?1 WHERE id = ?2",
        (now_millis(), id),
    )
    .await?;
    Ok(())
}

pub async fn finish(conn: &Connection, id: i64, state: &str, message: &str) -> Result<()> {
    if !STATES.contains(&state) {
        return Err(DbError::Validation(format!(
            "state must be one of {STATES:?}, got '{state}'"
        )));
    }
    conn.execute(
        "UPDATE ai_jobs SET state = ?1, message = ?2, finishedAt = ?3 WHERE id = ?4",
        (state, message, now_millis(), id),
    )
    .await?;
    Ok(())
}

/// Clears jobs left `running` when the app stopped.
///
/// Called once at startup. A process that is gone is not still working, and a
/// row that says `running` forever is worse than one that admits it was
/// interrupted — it blocks the item from ever being submitted again.
pub async fn fail_interrupted(conn: &Connection) -> Result<i64> {
    let stuck: Vec<i64> = {
        let mut rows = conn
            .query("SELECT id FROM ai_jobs WHERE state = 'running'", ())
            .await?;
        let mut ids = Vec::new();
        while let Some(row) = rows.next().await? {
            ids.push(row.get(0)?);
        }
        ids
    };
    for id in &stuck {
        finish(
            conn,
            *id,
            "failed",
            "the app closed while this was running — submit it again",
        )
        .await?;
    }
    Ok(stuck.len() as i64)
}

pub async fn list_for_product(conn: &Connection, product_id: i64) -> Result<Vec<AiJob>> {
    let mut rows = conn
        .query(
            &format!(
                "{SELECT} WHERE workItemId IN (SELECT id FROM work_items WHERE productId = ?1) \
                 ORDER BY submittedAt DESC, id DESC LIMIT 100"
            ),
            (product_id,),
        )
        .await?;
    let mut jobs = Vec::new();
    while let Some(row) = rows.next().await? {
        jobs.push(row_to_job(row)?);
    }
    Ok(jobs)
}

pub async fn list_for_item(conn: &Connection, work_item_id: i64) -> Result<Vec<AiJob>> {
    let mut rows = conn
        .query(
            &format!("{SELECT} WHERE workItemId = ?1 ORDER BY submittedAt DESC, id DESC"),
            (work_item_id,),
        )
        .await?;
    let mut jobs = Vec::new();
    while let Some(row) = rows.next().await? {
        jobs.push(row_to_job(row)?);
    }
    Ok(jobs)
}

fn row_to_job(row: turso::Row) -> Result<AiJob> {
    Ok(AiJob {
        id: row.get(0)?,
        work_item_id: row.get(1)?,
        purpose: row.get(2)?,
        state: row.get(3)?,
        message: row.get(4)?,
        submitted_at: row.get(5)?,
        started_at: row.get(6)?,
        finished_at: row.get(7)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    async fn fixture() -> (Connection, i64, i64) {
        let (conn, product_id) = db_with_product().await;
        let a = crate::db::work_item::create(&conn, "Checkout", "feature", product_id, None, None)
            .await
            .expect("item a");
        let b = crate::db::work_item::create(&conn, "Refunds", "feature", product_id, None, None)
            .await
            .expect("item b");
        (conn, a, b)
    }

    /// The queue is a queue: submitted first, run first.
    #[tokio::test]
    async fn jobs_come_back_in_the_order_they_were_submitted() {
        let (conn, a, b) = fixture().await;
        let first = submit(&conn, a, "changePlan").await.expect("a");
        let second = submit(&conn, b, "changePlan").await.expect("b");

        let next = next_queued(&conn).await.expect("next").expect("one waiting");
        assert_eq!(next.id, first);

        mark_running(&conn, first).await.expect("running");
        let next = next_queued(&conn).await.expect("next").expect("still one");
        assert_eq!(next.id, second, "a running job is no longer queued");

        finish(&conn, first, "done", "wrote schemas").await.expect("finish");
        finish(&conn, second, "done", "wrote schemas").await.expect("finish");
        assert!(next_queued(&conn).await.expect("next").is_none());
    }

    /// Submitting twice is a double-click, not a request to pay for the same
    /// schemas twice.
    #[tokio::test]
    async fn one_outstanding_job_per_work_item() {
        let (conn, a, _b) = fixture().await;
        let id = submit(&conn, a, "changePlan").await.expect("first");
        assert!(submit(&conn, a, "changePlan").await.is_err(), "already queued");

        mark_running(&conn, id).await.expect("running");
        assert!(submit(&conn, a, "changePlan").await.is_err(), "already running");

        // Once it is finished, the item can be submitted again — a plan often
        // needs a second pass after the questions are answered.
        finish(&conn, id, "done", "").await.expect("finish");
        submit(&conn, a, "changePlan").await.expect("again");
    }

    /// A row that says `running` forever is worse than one that admits it was
    /// interrupted: it blocks the item from ever being submitted again.
    #[tokio::test]
    async fn a_job_interrupted_by_the_app_closing_is_not_left_running() {
        let (conn, a, b) = fixture().await;
        let running = submit(&conn, a, "changePlan").await.expect("a");
        mark_running(&conn, running).await.expect("running");
        let queued = submit(&conn, b, "changePlan").await.expect("b");

        assert_eq!(fail_interrupted(&conn).await.expect("sweep"), 1);

        let jobs = list_for_item(&conn, a).await.expect("list");
        assert_eq!(jobs[0].state, "failed");
        assert!(jobs[0].message.contains("app closed"), "got: {}", jobs[0].message);
        // and it can be submitted again
        submit(&conn, a, "changePlan").await.expect("resubmit");

        // A queued job is untouched — it never started, so it is still waiting.
        let still = list_for_item(&conn, b).await.expect("list");
        assert_eq!(still[0].state, "queued");
        assert_eq!(still[0].id, queued);
    }

    /// Blocked is not failed. The AI declining to guess, or the budget refusing
    /// to spend, are outcomes worth telling apart from something breaking.
    #[tokio::test]
    async fn blocked_and_failed_are_different_endings() {
        let (conn, a, b) = fixture().await;
        let one = submit(&conn, a, "changePlan").await.expect("a");
        let two = submit(&conn, b, "changePlan").await.expect("b");

        finish(&conn, one, "blocked", "asked which payment provider").await.expect("f");
        finish(&conn, two, "failed", "the provider was unreachable").await.expect("f");

        assert_eq!(list_for_item(&conn, a).await.expect("l")[0].state, "blocked");
        assert_eq!(list_for_item(&conn, b).await.expect("l")[0].state, "failed");
        assert!(finish(&conn, one, "somehow", "").await.is_err(), "unknown state");
    }

    #[tokio::test]
    async fn a_products_jobs_are_listed_newest_first() {
        let (conn, a, b) = fixture().await;
        submit(&conn, a, "changePlan").await.expect("a");
        submit(&conn, b, "changePlan").await.expect("b");

        let jobs = list_for_product(&conn, 1).await.expect("list");
        assert_eq!(jobs.len(), 2);
        assert_eq!(jobs[0].work_item_id, b, "newest first");
    }

    #[tokio::test]
    async fn a_job_needs_a_real_work_item() {
        let (conn, _a, _b) = fixture().await;
        assert!(submit(&conn, 9999, "changePlan").await.is_err());
    }
}
