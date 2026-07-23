//! When a Solution commits itself, and whether it pushes.
//!
//! Off by default, and deliberately so: automatic commits write to somebody's
//! repository without them asking each time, and a feature that does that
//! should be turned on by a person who knows it is on.
//!
//! **Committing and pushing are separate answers.** A local auto-commit is a
//! restore point — a bad one is a `git reset` and nobody else ever saw it.
//! Pushing publishes it: onto the branch other people pull, where undoing it
//! means rewriting history everyone has. Same button, very different blast
//! radius, so it is asked as its own question rather than assumed either way.

use crate::db::{now_millis, DbError, Result};
use turso::Connection;

/// `off` — nothing automatic.
/// `onSave` — commit each time a file is saved in the editor.
/// `interval` — commit on a timer.
pub const MODES: &[&str] = &["off", "onSave", "interval"];

#[derive(Debug, Clone, PartialEq)]
pub struct CommitPolicy {
    pub solution_id: i64,
    pub mode: String,
    /// Whether each automatic commit is also pushed.
    pub push: bool,
    /// Minutes between commits in `interval` mode.
    pub interval_minutes: i64,
}

impl CommitPolicy {
    /// What a Solution nobody has configured does: nothing.
    pub fn off(solution_id: i64) -> Self {
        CommitPolicy {
            solution_id,
            mode: "off".into(),
            push: false,
            interval_minutes: 5,
        }
    }
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS commit_policies (
            solutionId INTEGER PRIMARY KEY,
            mode TEXT NOT NULL DEFAULT 'off',
            push INTEGER NOT NULL DEFAULT 0,
            intervalMinutes INTEGER NOT NULL DEFAULT 5,
            updatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

pub async fn get(conn: &Connection, solution_id: i64) -> Result<CommitPolicy> {
    let mut rows = conn
        .query(
            "SELECT solutionId, mode, push, intervalMinutes FROM commit_policies WHERE solutionId = ?1",
            (solution_id,),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(CommitPolicy {
            solution_id: row.get(0)?,
            mode: row.get(1)?,
            push: row.get::<i64>(2)? != 0,
            interval_minutes: row.get(3)?,
        }),
        None => Ok(CommitPolicy::off(solution_id)),
    }
}

pub async fn set(
    conn: &Connection,
    solution_id: i64,
    mode: &str,
    push: bool,
    interval_minutes: i64,
) -> Result<()> {
    if !MODES.contains(&mode) {
        return Err(DbError::Validation(format!(
            "mode must be one of {MODES:?}, got '{mode}'"
        )));
    }
    // A one-minute timer commits mid-keystroke and buries the useful history;
    // an hour is not a restore point. Both ends are refused rather than
    // silently clamped, so the number someone typed is the number they get.
    if mode == "interval" && !(2..=60).contains(&interval_minutes) {
        return Err(DbError::Validation(
            "the timer must be between 2 and 60 minutes — anything faster commits mid-thought, \
             anything slower is not a restore point"
                .into(),
        ));
    }
    if crate::db::solution::find_by_id(conn, solution_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no Solution with id {solution_id}"
        )));
    }
    conn.execute(
        "INSERT INTO commit_policies (solutionId, mode, push, intervalMinutes, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(solutionId) DO UPDATE SET
           mode = ?2, push = ?3, intervalMinutes = ?4, updatedAt = ?5",
        (
            solution_id,
            mode,
            push as i64,
            interval_minutes,
            now_millis(),
        ),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    async fn fixture() -> (Connection, i64) {
        let (conn, product_id) = db_with_product().await;
        let id = crate::db::solution::create(&conn, "Shop API", product_id, "api", "{}")
            .await
            .expect("solution");
        (conn, id)
    }

    /// A Solution nobody has configured must do nothing. Automatic commits
    /// write to someone's repository without asking each time, so they are
    /// turned on by a person who knows they are on.
    #[tokio::test]
    async fn a_solution_nobody_configured_commits_nothing() {
        let (conn, id) = fixture().await;
        let policy = get(&conn, id).await.expect("get");
        assert_eq!(policy.mode, "off");
        assert!(!policy.push);
    }

    /// Committing and pushing are separate answers: a local commit is a restore
    /// point, a pushed one is on the branch everyone pulls.
    #[tokio::test]
    async fn committing_and_pushing_are_chosen_separately() {
        let (conn, id) = fixture().await;

        set(&conn, id, "onSave", false, 5).await.expect("local only");
        let local = get(&conn, id).await.expect("get");
        assert_eq!(local.mode, "onSave");
        assert!(!local.push, "committing must not imply publishing");

        set(&conn, id, "onSave", true, 5).await.expect("and push");
        assert!(get(&conn, id).await.expect("get").push);
    }

    #[tokio::test]
    async fn the_timer_is_kept_to_something_useful() {
        let (conn, id) = fixture().await;
        set(&conn, id, "interval", false, 5).await.expect("five minutes");
        assert_eq!(get(&conn, id).await.expect("get").interval_minutes, 5);

        assert!(set(&conn, id, "interval", false, 1).await.is_err(), "too fast");
        assert!(set(&conn, id, "interval", false, 120).await.is_err(), "too slow");
        // the bound only applies to the mode that uses it
        set(&conn, id, "off", false, 1).await.expect("off ignores the timer");
    }

    #[tokio::test]
    async fn the_mode_and_the_solution_are_validated() {
        let (conn, id) = fixture().await;
        assert!(set(&conn, id, "whenever", false, 5).await.is_err());
        assert!(set(&conn, 9999, "onSave", false, 5).await.is_err());
    }

    #[tokio::test]
    async fn changing_the_policy_replaces_it_rather_than_adding_a_second() {
        let (conn, id) = fixture().await;
        set(&conn, id, "onSave", true, 5).await.expect("first");
        set(&conn, id, "interval", false, 10).await.expect("second");

        let policy = get(&conn, id).await.expect("get");
        assert_eq!(policy.mode, "interval");
        assert!(!policy.push);
        assert_eq!(policy.interval_minutes, 10);
    }
}
