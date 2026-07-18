//! The `AiFeedback` model — where the AI says what it cannot do.
//!
//! The README names this as the framework's answer to AI "burning tokens
//! creating, then recreating, the same work": rather than guessing at a vague
//! work item and producing something nobody asked for, the model may decline
//! and say what it needs. That answer lands here, against the work item, where
//! a person can answer it — and the answer then travels back into the next
//! prompt for that item.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

/// `cantImplement` — the model will not attempt it as specified.
/// `needsInformation` — it could, given a specific answer.
/// `suggestion` — it proceeded, but flagged something.
pub const KINDS: &[&str] = &["cantImplement", "needsInformation", "suggestion"];

#[derive(Debug, Clone, PartialEq)]
pub struct AiFeedback {
    pub id: i64,
    pub work_item_id: i64,
    pub kind: String,
    pub message: String,
    /// What would unblock it — the actionable half.
    pub what_is_needed: String,
    pub ai_usage_id: Option<i64>,
    pub resolved: bool,
    pub resolved_note: String,
    pub created_at: i64,
}

const SELECT: &str = "SELECT id, workItemId, kind, message, whatIsNeeded, aiUsageId, resolved, resolvedNote, createdAt FROM ai_feedback";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workItemId INTEGER NOT NULL,
            kind TEXT NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            whatIsNeeded TEXT NOT NULL DEFAULT '',
            aiUsageId INTEGER,
            resolved INTEGER NOT NULL DEFAULT 0,
            resolvedNote TEXT NOT NULL DEFAULT '',
            createdAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

pub async fn record(
    conn: &Connection,
    work_item_id: i64,
    kind: &str,
    message: &str,
    what_is_needed: &str,
    ai_usage_id: Option<i64>,
) -> Result<i64> {
    if !KINDS.contains(&kind) {
        return Err(DbError::Validation(format!(
            "kind must be one of {KINDS:?}, got '{kind}'"
        )));
    }
    if message.trim().is_empty() {
        return Err(DbError::Validation(
            "AI feedback needs a message saying what the problem is".into(),
        ));
    }
    conn.execute(
        "INSERT INTO ai_feedback (workItemId, kind, message, whatIsNeeded, aiUsageId, resolved, resolvedNote, createdAt)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, '', ?6)",
        (work_item_id, kind, message, what_is_needed, ai_usage_id, now_millis()),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn list_for_item(conn: &Connection, work_item_id: i64) -> Result<Vec<AiFeedback>> {
    query(conn, &format!("{SELECT} WHERE workItemId = ?1 ORDER BY id DESC"), work_item_id).await
}

/// Open feedback only — what still needs a person's answer.
pub async fn list_open_for_item(conn: &Connection, work_item_id: i64) -> Result<Vec<AiFeedback>> {
    query(
        conn,
        &format!("{SELECT} WHERE workItemId = ?1 AND resolved = 0 ORDER BY id DESC"),
        work_item_id,
    )
    .await
}

/// Answers a piece of feedback. The note is the clarification that will be sent
/// with the next prompt for this item, which is the whole point of capturing it.
pub async fn resolve(conn: &Connection, id: i64, note: &str) -> Result<()> {
    if note.trim().is_empty() {
        return Err(DbError::Validation(
            "answer the AI's question before resolving it — the answer is what unblocks the work"
                .into(),
        ));
    }
    let exists = { list_by_id(conn, id).await?.is_some() };
    if !exists {
        return Err(DbError::Validation(format!("no AI feedback with id {id}")));
    }
    conn.execute(
        "UPDATE ai_feedback SET resolved = 1, resolvedNote = ?1 WHERE id = ?2",
        (note, id),
    )
    .await?;
    Ok(())
}

pub async fn list_by_id(conn: &Connection, id: i64) -> Result<Option<AiFeedback>> {
    let mut rows = conn.query(&format!("{SELECT} WHERE id = ?1"), (id,)).await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_feedback(row)?)),
        None => Ok(None),
    }
}

/// The clarifications a person has already given for an item, newest last, for
/// inclusion in the next prompt.
pub async fn clarifications_for_item(conn: &Connection, work_item_id: i64) -> Result<Vec<String>> {
    let items = query(
        conn,
        &format!("{SELECT} WHERE workItemId = ?1 AND resolved = 1 ORDER BY id"),
        work_item_id,
    )
    .await?;
    Ok(items.into_iter().map(|f| f.resolved_note).collect())
}

async fn query(conn: &Connection, sql: &str, work_item_id: i64) -> Result<Vec<AiFeedback>> {
    let mut rows = conn.query(sql, (work_item_id,)).await?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().await? {
        items.push(row_to_feedback(row)?);
    }
    Ok(items)
}

fn row_to_feedback(row: turso::Row) -> Result<AiFeedback> {
    let resolved: i64 = row.get(6)?;
    Ok(AiFeedback {
        id: row.get(0)?,
        work_item_id: row.get(1)?,
        kind: row.get(2)?,
        message: row.get(3)?,
        what_is_needed: row.get(4)?,
        ai_usage_id: row.get(5)?,
        resolved: resolved != 0,
        resolved_note: row.get(7)?,
        created_at: row.get(8)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    async fn item(conn: &Connection, product_id: i64) -> i64 {
        crate::db::work_item::create(conn, "Checkout", "feature", product_id, None, None)
            .await
            .expect("item")
    }

    #[tokio::test]
    async fn recorded_feedback_starts_open() {
        let (conn, product_id) = db_with_product().await;
        let item_id = item(&conn, product_id).await;
        record(
            &conn,
            item_id,
            "cantImplement",
            "The payment provider is not named.",
            "Which payment provider should checkout use?",
            None,
        )
        .await
        .expect("record");

        let open = list_open_for_item(&conn, item_id).await.expect("list");
        assert_eq!(open.len(), 1);
        assert!(!open[0].resolved);
        assert_eq!(open[0].what_is_needed, "Which payment provider should checkout use?");
    }

    #[tokio::test]
    async fn kind_and_message_are_validated() {
        let (conn, product_id) = db_with_product().await;
        let item_id = item(&conn, product_id).await;
        assert!(record(&conn, item_id, "shrug", "m", "", None).await.is_err());
        assert!(record(&conn, item_id, "cantImplement", "  ", "", None).await.is_err());
    }

    /// Resolving must carry an answer — a resolved item with nothing to say
    /// would leave the next prompt exactly as uninformed as the last.
    #[tokio::test]
    async fn resolving_requires_an_actual_answer() {
        let (conn, product_id) = db_with_product().await;
        let item_id = item(&conn, product_id).await;
        let id = record(&conn, item_id, "needsInformation", "Which provider?", "", None)
            .await
            .expect("record");

        assert!(resolve(&conn, id, "   ").await.is_err());
        assert!(resolve(&conn, 999, "Stripe").await.is_err());

        resolve(&conn, id, "Use Stripe.").await.expect("resolve");
        assert!(list_open_for_item(&conn, item_id).await.expect("list").is_empty());
        assert_eq!(list_for_item(&conn, item_id).await.expect("list").len(), 1);
    }

    /// The answer must reach the next prompt — that is what stops the AI
    /// asking the same question and burning the same tokens again.
    #[tokio::test]
    async fn answers_become_clarifications_for_the_next_prompt() {
        let (conn, product_id) = db_with_product().await;
        let item_id = item(&conn, product_id).await;
        let first = record(&conn, item_id, "needsInformation", "Which provider?", "", None)
            .await
            .expect("record");
        let second = record(&conn, item_id, "needsInformation", "Guest checkout?", "", None)
            .await
            .expect("record");

        assert!(clarifications_for_item(&conn, item_id).await.expect("q").is_empty());

        resolve(&conn, first, "Use Stripe.").await.expect("resolve");
        resolve(&conn, second, "Yes, allow guest checkout.").await.expect("resolve");

        let clarifications = clarifications_for_item(&conn, item_id).await.expect("q");
        assert_eq!(clarifications, vec!["Use Stripe.", "Yes, allow guest checkout."]);
    }

    #[tokio::test]
    async fn feedback_is_scoped_to_its_work_item() {
        let (conn, product_id) = db_with_product().await;
        let a = item(&conn, product_id).await;
        let b = crate::db::work_item::create(&conn, "Search", "feature", product_id, None, None)
            .await
            .expect("item");
        record(&conn, a, "cantImplement", "A", "", None).await.expect("record");

        assert_eq!(list_for_item(&conn, a).await.expect("list").len(), 1);
        assert!(list_for_item(&conn, b).await.expect("list").is_empty());
    }
}
