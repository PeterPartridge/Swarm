//! The `ModelPrice` model — what each model costs and roughly how fast it is.
//!
//! Prices are held as **pence per million tokens** because that is how vendors
//! quote them, and because `tokens × pence_per_million` gives cost in micropence
//! exactly (see `ai_usage`). The table is user-editable: vendor prices change,
//! and a stale hard-coded price would quietly misreport every budget.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct ModelPrice {
    pub id: i64,
    pub provider_id: i64,
    pub model: String,
    pub input_pence_per_mtok: i64,
    pub output_pence_per_mtok: i64,
    /// Rough throughput, used only for "estimated completion time".
    pub tokens_per_second: i64,
    pub updated_at: i64,
}

const SELECT: &str = "SELECT id, providerId, model, inputPencePerMTok, outputPencePerMTok, tokensPerSecond, updatedAt FROM model_prices";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS model_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            providerId INTEGER NOT NULL,
            model TEXT NOT NULL,
            inputPencePerMTok INTEGER NOT NULL DEFAULT 0,
            outputPencePerMTok INTEGER NOT NULL DEFAULT 0,
            tokensPerSecond INTEGER NOT NULL DEFAULT 50,
            updatedAt INTEGER NOT NULL,
            UNIQUE(providerId, model)
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Creates or replaces the price for one (provider, model).
pub async fn set_price(
    conn: &Connection,
    provider_id: i64,
    model: &str,
    input_pence_per_mtok: i64,
    output_pence_per_mtok: i64,
    tokens_per_second: i64,
) -> Result<i64> {
    if model.trim().is_empty() {
        return Err(DbError::Validation("a price needs a model name".into()));
    }
    if input_pence_per_mtok < 0 || output_pence_per_mtok < 0 {
        return Err(DbError::Validation("prices cannot be negative".into()));
    }
    if tokens_per_second <= 0 {
        return Err(DbError::Validation(
            "tokensPerSecond must be greater than zero".into(),
        ));
    }
    if crate::db::ai_provider::find_by_id(conn, provider_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no AI provider with id {provider_id}"
        )));
    }
    conn.execute(
        "DELETE FROM model_prices WHERE providerId = ?1 AND model = ?2",
        (provider_id, model),
    )
    .await?;
    conn.execute(
        "INSERT INTO model_prices (providerId, model, inputPencePerMTok, outputPencePerMTok, tokensPerSecond, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (
            provider_id,
            model,
            input_pence_per_mtok,
            output_pence_per_mtok,
            tokens_per_second,
            now_millis(),
        ),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn find(conn: &Connection, provider_id: i64, model: &str) -> Result<Option<ModelPrice>> {
    let mut rows = conn
        .query(
            &format!("{SELECT} WHERE providerId = ?1 AND model = ?2"),
            (provider_id, model),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_price(row)?)),
        None => Ok(None),
    }
}

pub async fn list_all(conn: &Connection) -> Result<Vec<ModelPrice>> {
    let mut rows = conn.query(&format!("{SELECT} ORDER BY providerId, model"), ()).await?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().await? {
        items.push(row_to_price(row)?);
    }
    Ok(items)
}

pub async fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM model_prices WHERE id = ?1", (id,)).await?;
    Ok(())
}

fn row_to_price(row: turso::Row) -> Result<ModelPrice> {
    Ok(ModelPrice {
        id: row.get(0)?,
        provider_id: row.get(1)?,
        model: row.get(2)?,
        input_pence_per_mtok: row.get(3)?,
        output_pence_per_mtok: row.get(4)?,
        tokens_per_second: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

/// Cost of a call in **micropence** — exact integer arithmetic, no rounding.
/// Cache reads are billed at a tenth of the input rate and cache writes at
/// input rate plus a quarter, matching Anthropic's published multipliers.
/// A model with no price row costs zero rather than blocking the call; an
/// unpriced model is a configuration gap, not a reason to lose someone's work.
pub fn cost_micropence(price: Option<&ModelPrice>, tokens: &crate::db::ai_usage::TokenCounts) -> i64 {
    let Some(price) = price else { return 0 };
    let input = tokens.input_tokens * price.input_pence_per_mtok;
    let output = tokens.output_tokens * price.output_pence_per_mtok;
    let cache_read = tokens.cache_read_tokens * price.input_pence_per_mtok / 10;
    let cache_write = tokens.cache_write_tokens * price.input_pence_per_mtok * 5 / 4;
    input + output + cache_read + cache_write
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ai_usage::TokenCounts;
    use crate::db::product::tests::db_with_product;

    async fn provider(conn: &Connection) -> i64 {
        crate::db::ai_provider::add(conn, "Claude", "https://api.anthropic.com", &["m"], "alias")
            .await
            .expect("provider")
    }

    #[tokio::test]
    async fn a_price_round_trips_and_replaces_rather_than_duplicating() {
        let (conn, _) = db_with_product().await;
        let p = provider(&conn).await;
        set_price(&conn, p, "claude-haiku-4-5", 80, 400, 120).await.expect("set");
        set_price(&conn, p, "claude-haiku-4-5", 90, 450, 130).await.expect("replace");

        let found = find(&conn, p, "claude-haiku-4-5").await.expect("find").expect("exists");
        assert_eq!(found.input_pence_per_mtok, 90);
        assert_eq!(found.tokens_per_second, 130);
        assert_eq!(list_all(&conn).await.expect("list").len(), 1);
    }

    #[tokio::test]
    async fn prices_are_validated() {
        let (conn, _) = db_with_product().await;
        let p = provider(&conn).await;
        assert!(set_price(&conn, p, " ", 1, 1, 1).await.is_err());
        assert!(set_price(&conn, p, "m", -1, 1, 1).await.is_err());
        assert!(set_price(&conn, p, "m", 1, 1, 0).await.is_err());
        assert!(set_price(&conn, 999, "m", 1, 1, 1).await.is_err());
    }

    /// 1M input tokens at 80p per million must be exactly 80p — i.e. 80 million
    /// micropence — with no rounding drift.
    #[test]
    fn cost_is_exact_for_a_round_million_tokens() {
        let price = ModelPrice {
            id: 1,
            provider_id: 1,
            model: "m".into(),
            input_pence_per_mtok: 80,
            output_pence_per_mtok: 400,
            tokens_per_second: 100,
            updated_at: 0,
        };
        let tokens = TokenCounts {
            input_tokens: 1_000_000,
            output_tokens: 0,
            ..Default::default()
        };
        // 80p = 80_000_000 micropence
        assert_eq!(cost_micropence(Some(&price), &tokens), 80_000_000);
    }

    #[test]
    fn a_small_call_keeps_sub_penny_precision() {
        let price = ModelPrice {
            id: 1,
            provider_id: 1,
            model: "m".into(),
            input_pence_per_mtok: 80,
            output_pence_per_mtok: 400,
            tokens_per_second: 100,
            updated_at: 0,
        };
        let tokens = TokenCounts {
            input_tokens: 1_000,
            output_tokens: 500,
            ..Default::default()
        };
        // 1000*80 + 500*400 = 80_000 + 200_000 = 280_000 micropence = 0.28p,
        // which whole-pence storage would have thrown away entirely.
        assert_eq!(cost_micropence(Some(&price), &tokens), 280_000);
    }

    #[test]
    fn cache_reads_are_cheaper_than_fresh_input() {
        let price = ModelPrice {
            id: 1,
            provider_id: 1,
            model: "m".into(),
            input_pence_per_mtok: 100,
            output_pence_per_mtok: 100,
            tokens_per_second: 100,
            updated_at: 0,
        };
        let fresh = TokenCounts { input_tokens: 10_000, ..Default::default() };
        let cached = TokenCounts { cache_read_tokens: 10_000, ..Default::default() };
        let fresh_cost = cost_micropence(Some(&price), &fresh);
        let cached_cost = cost_micropence(Some(&price), &cached);
        assert_eq!(cached_cost, fresh_cost / 10);
    }

    #[test]
    fn an_unpriced_model_costs_zero_rather_than_failing() {
        let tokens = TokenCounts { input_tokens: 5_000, ..Default::default() };
        assert_eq!(cost_micropence(None, &tokens), 0);
    }
}
