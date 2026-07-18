//! The `AiUsage` model — the ledger. One row per AI call, written whether the
//! call succeeded, failed, or was blocked before it left, so the record
//! explains its own gaps.
//!
//! **Money is stored in micropence** (millionths of a penny), never a float.
//! That unit is not arbitrary: prices are quoted per million tokens, so
//! `tokens × pence_per_million_tokens` lands exactly on micropence with no
//! division and no rounding. Whole pence would truncate a 1.3p call to 1p and
//! the error would compound across a budget period.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

/// What an AI call was for. Used to group spend and, later, to calibrate
/// estimates against calls of the same kind.
pub const PURPOSES: &[&str] = &[
    "storyGeneration",
    "deliverablePlanning",
    "solutionStrategy",
    "recommendation",
    "connectionTest",
];

/// How the call ended.
///
/// `blocked` means the router or a policy stopped it **before any content
/// moved** — it costs nothing but is recorded, because "no spend" and "no
/// attempt" are different facts.
///
/// `declined` is not the same thing: the model ran, was paid for, and chose to
/// return a question instead of work. It counts as spend, and conflating the
/// two would let a run of declines quietly understate the bill.
pub const OUTCOMES: &[&str] = &["ok", "error", "refusal", "blocked", "declined"];

#[derive(Debug, Clone, PartialEq)]
pub struct AiUsage {
    pub id: i64,
    pub product_id: Option<i64>,
    pub work_item_id: Option<i64>,
    pub provider_id: Option<i64>,
    pub model: String,
    pub purpose: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub cost_micropence: i64,
    pub latency_ms: i64,
    pub outcome: String,
    pub created_at: i64,
}

/// What a call consumed, before it is priced.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct TokenCounts {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
}

/// Total spend over a window, for budget checks.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Spend {
    pub tokens: i64,
    pub micropence: i64,
    pub calls: i64,
}

const SELECT: &str = "SELECT id, productId, workItemId, providerId, model, purpose, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costMicropence, latencyMs, outcome, createdAt FROM ai_usage";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            productId INTEGER,
            workItemId INTEGER,
            providerId INTEGER,
            model TEXT NOT NULL DEFAULT '',
            purpose TEXT NOT NULL,
            inputTokens INTEGER NOT NULL DEFAULT 0,
            outputTokens INTEGER NOT NULL DEFAULT 0,
            cacheReadTokens INTEGER NOT NULL DEFAULT 0,
            cacheWriteTokens INTEGER NOT NULL DEFAULT 0,
            costMicropence INTEGER NOT NULL DEFAULT 0,
            latencyMs INTEGER NOT NULL DEFAULT 0,
            outcome TEXT NOT NULL DEFAULT 'ok',
            createdAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Records one call. Never fails the caller's work for a bad `purpose` —
/// validation is here so a typo is caught in tests, but the AI paths pass
/// constants.
#[allow(clippy::too_many_arguments)]
pub async fn record(
    conn: &Connection,
    product_id: Option<i64>,
    work_item_id: Option<i64>,
    provider_id: Option<i64>,
    model: &str,
    purpose: &str,
    tokens: TokenCounts,
    cost_micropence: i64,
    latency_ms: i64,
    outcome: &str,
) -> Result<i64> {
    if !PURPOSES.contains(&purpose) {
        return Err(DbError::Validation(format!(
            "purpose must be one of {PURPOSES:?}, got '{purpose}'"
        )));
    }
    if !OUTCOMES.contains(&outcome) {
        return Err(DbError::Validation(format!(
            "outcome must be one of {OUTCOMES:?}, got '{outcome}'"
        )));
    }
    conn.execute(
        "INSERT INTO ai_usage (productId, workItemId, providerId, model, purpose,
            inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
            costMicropence, latencyMs, outcome, createdAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        (
            product_id,
            work_item_id,
            provider_id,
            model,
            purpose,
            tokens.input_tokens,
            tokens.output_tokens,
            tokens.cache_read_tokens,
            tokens.cache_write_tokens,
            cost_micropence,
            latency_ms,
            outcome,
            now_millis(),
        ),
    )
    .await?;
    last_insert_id(conn).await
}

/// Spend for a Product since a timestamp. Blocked calls are excluded from the
/// totals — they cost nothing, and counting them would push a budget over its
/// own threshold on the strength of calls that never happened.
pub async fn spend_for_product(
    conn: &Connection,
    product_id: i64,
    since_millis: i64,
) -> Result<Spend> {
    let mut rows = conn
        .query(
            "SELECT COALESCE(SUM(inputTokens + outputTokens), 0),
                    COALESCE(SUM(costMicropence), 0),
                    COUNT(*)
             FROM ai_usage
             WHERE productId = ?1 AND createdAt >= ?2 AND outcome != 'blocked'",
            (product_id, since_millis),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Spend {
            tokens: row.get(0)?,
            micropence: row.get(1)?,
            calls: row.get(2)?,
        }),
        None => Ok(Spend::default()),
    }
}

pub async fn list_for_product(conn: &Connection, product_id: i64, limit: i64) -> Result<Vec<AiUsage>> {
    let mut rows = conn
        .query(
            &format!("{SELECT} WHERE productId = ?1 ORDER BY id DESC LIMIT ?2"),
            (product_id, limit),
        )
        .await?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().await? {
        items.push(row_to_usage(row)?);
    }
    Ok(items)
}

fn row_to_usage(row: turso::Row) -> Result<AiUsage> {
    Ok(AiUsage {
        id: row.get(0)?,
        product_id: row.get(1)?,
        work_item_id: row.get(2)?,
        provider_id: row.get(3)?,
        model: row.get(4)?,
        purpose: row.get(5)?,
        input_tokens: row.get(6)?,
        output_tokens: row.get(7)?,
        cache_read_tokens: row.get(8)?,
        cache_write_tokens: row.get(9)?,
        cost_micropence: row.get(10)?,
        latency_ms: row.get(11)?,
        outcome: row.get(12)?,
        created_at: row.get(13)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    fn tokens(input: i64, output: i64) -> TokenCounts {
        TokenCounts {
            input_tokens: input,
            output_tokens: output,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn a_recorded_call_is_listed_with_its_counts() {
        let (conn, product_id) = db_with_product().await;
        record(
            &conn,
            Some(product_id),
            None,
            Some(1),
            "claude-haiku-4-5",
            "storyGeneration",
            TokenCounts {
                input_tokens: 1000,
                output_tokens: 500,
                cache_read_tokens: 800,
                cache_write_tokens: 0,
            },
            1_300_000,
            2400,
            "ok",
        )
        .await
        .expect("record");

        let list = list_for_product(&conn, product_id, 10).await.expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].input_tokens, 1000);
        assert_eq!(list[0].cache_read_tokens, 800);
        assert_eq!(list[0].cost_micropence, 1_300_000);
        assert_eq!(list[0].outcome, "ok");
    }

    #[tokio::test]
    async fn purpose_and_outcome_are_validated() {
        let (conn, product_id) = db_with_product().await;
        assert!(record(&conn, Some(product_id), None, None, "m", "guessing", tokens(1, 1), 0, 0, "ok")
            .await
            .is_err());
        assert!(record(&conn, Some(product_id), None, None, "m", "storyGeneration", tokens(1, 1), 0, 0, "exploded")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn spend_sums_tokens_and_cost_for_a_product() {
        let (conn, product_id) = db_with_product().await;
        for _ in 0..3 {
            record(&conn, Some(product_id), None, None, "m", "storyGeneration", tokens(1000, 200), 500_000, 10, "ok")
                .await
                .expect("record");
        }
        let spend = spend_for_product(&conn, product_id, 0).await.expect("spend");
        assert_eq!(spend.calls, 3);
        assert_eq!(spend.tokens, 3 * 1200);
        assert_eq!(spend.micropence, 1_500_000);
    }

    /// A blocked call never reached a provider, so it must not consume budget —
    /// otherwise refusing to spend would itself push the budget over.
    #[tokio::test]
    async fn blocked_calls_are_recorded_but_do_not_count_as_spend() {
        let (conn, product_id) = db_with_product().await;
        record(&conn, Some(product_id), None, None, "m", "storyGeneration", tokens(0, 0), 0, 0, "blocked")
            .await
            .expect("record");
        record(&conn, Some(product_id), None, None, "m", "storyGeneration", tokens(100, 50), 900_000, 5, "ok")
            .await
            .expect("record");

        let spend = spend_for_product(&conn, product_id, 0).await.expect("spend");
        assert_eq!(spend.calls, 1, "only the call that happened counts");
        assert_eq!(spend.micropence, 900_000);
        assert_eq!(list_for_product(&conn, product_id, 10).await.expect("list").len(), 2);
    }

    #[tokio::test]
    async fn spend_ignores_calls_before_the_window() {
        let (conn, product_id) = db_with_product().await;
        record(&conn, Some(product_id), None, None, "m", "storyGeneration", tokens(100, 100), 700_000, 5, "ok")
            .await
            .expect("record");
        // a window starting in the future excludes everything recorded so far
        let spend = spend_for_product(&conn, product_id, now_millis() + 60_000)
            .await
            .expect("spend");
        assert_eq!(spend.calls, 0);
        assert_eq!(spend.micropence, 0);
    }

    #[tokio::test]
    async fn spend_is_zero_for_a_product_with_no_calls() {
        let (conn, product_id) = db_with_product().await;
        let spend = spend_for_product(&conn, product_id, 0).await.expect("spend");
        assert_eq!(spend, Spend::default());
    }
}
