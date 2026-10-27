//! What the app did, in order, so "nothing happened" can be answered.
//!
//! **Because a press that does nothing leaves no trace anywhere else.** The
//! ledger records calls that reached a provider; the queue records jobs that
//! were submitted. A press that was refused before either — a disabled button,
//! a gate that said no, a command that returned an error the screen then lost —
//! wrote nothing at all, and the only honest answer to "why did Execute do
//! nothing?" was to guess.
//!
//! **Both sides write to it.** The screen logs what was pressed and what came
//! back; the commands log what they decided. Read together they say where a
//! press stopped, which is the one thing neither half can say alone.
//!
//! Capped rather than kept forever: this is a trail for the last thing that
//! went wrong, not an audit. What must survive is in the ledger and the queue.

use crate::db::{now_millis, Result};
use turso::Connection;

/// How many entries are kept. Enough to cover a session's worth of pressing,
/// small enough that reading it is not a chore.
const KEEP: i64 = 500;

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub id: i64,
    pub at: i64,
    /// Where it happened — "execute", "startRun", "permission". Free text on
    /// purpose: a fixed list would need editing every time something new is
    /// worth logging, which is exactly when nobody wants to edit an enum.
    pub area: String,
    /// One line, in the words somebody reading the log needs.
    pub message: String,
    /// Anything longer — an error, a payload — or empty.
    pub detail: String,
}

const SELECT: &str = "SELECT id, at, area, message, detail FROM app_log";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            at INTEGER NOT NULL,
            area TEXT NOT NULL,
            message TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT ''
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Writes one line. Never fails a caller: a log that can break the thing it is
/// logging is worse than no log, so the error is swallowed by `note` below.
pub async fn record(conn: &Connection, area: &str, message: &str, detail: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO app_log (at, area, message, detail) VALUES (?1, ?2, ?3, ?4)",
        (now_millis(), area, message, detail),
    )
    .await?;
    // Trimmed here rather than on a timer: the write is the only moment the
    // table grows, and a sweep nobody triggers is a sweep that never runs.
    conn.execute(
        "DELETE FROM app_log WHERE id <= (SELECT MAX(id) FROM app_log) - ?1",
        (KEEP,),
    )
    .await?;
    Ok(())
}

/// `record`, for the callers that must not care whether it worked.
pub async fn note(conn: &Connection, area: &str, message: &str, detail: &str) {
    let _ = record(conn, area, message, detail).await;
}

/// The most recent entries, newest first.
pub async fn recent(conn: &Connection, limit: i64) -> Result<Vec<Entry>> {
    let mut rows = conn
        .query(
            &format!("{SELECT} ORDER BY id DESC LIMIT ?1"),
            (limit.clamp(1, KEEP),),
        )
        .await?;
    let mut entries = Vec::new();
    while let Some(row) = rows.next().await? {
        entries.push(Entry {
            id: row.get(0)?,
            at: row.get(1)?,
            area: row.get(2)?,
            message: row.get(3)?,
            detail: row.get(4)?,
        });
    }
    Ok(entries)
}

pub async fn clear(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM app_log", ()).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    #[tokio::test]
    async fn what_was_written_comes_back_newest_first() {
        let (conn, _) = db_with_product().await;
        note(&conn, "execute", "pressed", "").await;
        note(&conn, "startRun", "refused", "not a git repository").await;

        let entries = recent(&conn, 10).await.expect("read");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].message, "refused", "newest first");
        assert_eq!(entries[0].detail, "not a git repository");
        assert_eq!(entries[1].area, "execute");
    }

    /// A trail for the last thing that went wrong, not an audit — so it has a
    /// ceiling, and the ceiling is enforced where the table grows.
    #[tokio::test]
    async fn the_log_does_not_grow_without_end() {
        let (conn, _) = db_with_product().await;
        for i in 0..(KEEP + 20) {
            note(&conn, "test", &format!("line {i}"), "").await;
        }
        let entries = recent(&conn, KEEP).await.expect("read");
        assert_eq!(entries.len() as i64, KEEP);
        assert_eq!(entries[0].message, format!("line {}", KEEP + 19));
    }

    #[tokio::test]
    async fn it_can_be_emptied() {
        let (conn, _) = db_with_product().await;
        note(&conn, "execute", "pressed", "").await;
        clear(&conn).await.expect("clear");
        assert!(recent(&conn, 10).await.expect("read").is_empty());
    }
}
