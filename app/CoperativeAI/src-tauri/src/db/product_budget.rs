//! The `ProductBudget` model — what a Product may spend on AI, and what should
//! happen as it runs out.
//!
//! Money in micropence, matching the ledger. Three thresholds mark the points
//! where behaviour changes: warn (tell someone), handover (move to the next
//! provider in the chain, typically a free local one), and hard stop (refuse).
//! The chain is an ordered list of provider ids — "Claude until 90%, then
//! Ollama" is `[claude, ollama]` with `handoverPct = 90`.

use crate::db::{now_millis, DbError, Result};
use turso::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct ProductBudget {
    pub id: i64,
    pub product_id: i64,
    /// The whole Product budget, for context alongside the AI slice.
    pub total_budget_micropence: i64,
    pub ai_budget_micropence: i64,
    /// Zero means "no token ceiling"; money is then the only limit.
    pub token_limit: i64,
    pub warn_pct: i64,
    pub handover_pct: i64,
    pub hard_stop_pct: i64,
    pub period_days: i64,
    pub period_start: i64,
    /// Ordered provider ids: spend the first until handover, then the next.
    pub provider_chain: Vec<i64>,
    pub updated_at: i64,
}

const SELECT: &str = "SELECT id, productId, totalBudgetMicropence, aiBudgetMicropence, tokenLimit, warnPct, handoverPct, hardStopPct, periodDays, periodStart, providerChain, updatedAt FROM product_budgets";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS product_budgets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            productId INTEGER NOT NULL UNIQUE,
            totalBudgetMicropence INTEGER NOT NULL DEFAULT 0,
            aiBudgetMicropence INTEGER NOT NULL DEFAULT 0,
            tokenLimit INTEGER NOT NULL DEFAULT 0,
            warnPct INTEGER NOT NULL DEFAULT 75,
            handoverPct INTEGER NOT NULL DEFAULT 90,
            hardStopPct INTEGER NOT NULL DEFAULT 100,
            periodDays INTEGER NOT NULL DEFAULT 30,
            periodStart INTEGER NOT NULL,
            providerChain TEXT NOT NULL DEFAULT '[]',
            updatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn set_budget(
    conn: &Connection,
    product_id: i64,
    total_budget_micropence: i64,
    ai_budget_micropence: i64,
    token_limit: i64,
    warn_pct: i64,
    handover_pct: i64,
    hard_stop_pct: i64,
    period_days: i64,
    provider_chain: &[i64],
) -> Result<()> {
    if crate::db::product::find_by_id(conn, product_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no Product with id {product_id}"
        )));
    }
    if total_budget_micropence < 0 || ai_budget_micropence < 0 || token_limit < 0 {
        return Err(DbError::Validation("budgets cannot be negative".into()));
    }
    // Ascending thresholds are what make the router's decisions unambiguous:
    // out of order, "past handover but under warn" would be reachable.
    if !(warn_pct <= handover_pct && handover_pct <= hard_stop_pct) {
        return Err(DbError::Validation(
            "thresholds must be in order: warn ≤ handover ≤ hard stop".into(),
        ));
    }
    if warn_pct < 0 || hard_stop_pct > 1000 {
        return Err(DbError::Validation(
            "thresholds must be between 0 and 1000 percent".into(),
        ));
    }
    if period_days <= 0 {
        return Err(DbError::Validation(
            "the budget period must be at least one day".into(),
        ));
    }
    for provider_id in provider_chain {
        if crate::db::ai_provider::find_by_id(conn, *provider_id).await?.is_none() {
            return Err(DbError::Validation(format!(
                "the provider chain names AI provider {provider_id}, which does not exist"
            )));
        }
    }
    let chain_json = serde_json::to_string(provider_chain).expect("chain serialises");

    // Keep the period start when only the amounts change, so editing a budget
    // mid-month does not silently reset the spend window.
    let existing_start = get_for_product(conn, product_id).await?.map(|b| b.period_start);
    let period_start = existing_start.unwrap_or_else(now_millis);

    conn.execute("DELETE FROM product_budgets WHERE productId = ?1", (product_id,))
        .await?;
    conn.execute(
        "INSERT INTO product_budgets (productId, totalBudgetMicropence, aiBudgetMicropence,
            tokenLimit, warnPct, handoverPct, hardStopPct, periodDays, periodStart,
            providerChain, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        (
            product_id,
            total_budget_micropence,
            ai_budget_micropence,
            token_limit,
            warn_pct,
            handover_pct,
            hard_stop_pct,
            period_days,
            period_start,
            chain_json,
            now_millis(),
        ),
    )
    .await?;
    Ok(())
}

pub async fn get_for_product(conn: &Connection, product_id: i64) -> Result<Option<ProductBudget>> {
    let mut rows = conn
        .query(&format!("{SELECT} WHERE productId = ?1"), (product_id,))
        .await?;
    match rows.next().await? {
        Some(row) => {
            let chain_json: String = row.get(10)?;
            Ok(Some(ProductBudget {
                id: row.get(0)?,
                product_id: row.get(1)?,
                total_budget_micropence: row.get(2)?,
                ai_budget_micropence: row.get(3)?,
                token_limit: row.get(4)?,
                warn_pct: row.get(5)?,
                handover_pct: row.get(6)?,
                hard_stop_pct: row.get(7)?,
                period_days: row.get(8)?,
                period_start: row.get(9)?,
                provider_chain: serde_json::from_str(&chain_json).unwrap_or_default(),
                updated_at: row.get(11)?,
            }))
        }
        None => Ok(None),
    }
}

/// Start of the current spend window, rolling forward from `period_start` so a
/// budget renews itself without anyone pressing anything.
pub fn current_period_start(budget: &ProductBudget, now: i64) -> i64 {
    let period_ms = budget.period_days * 24 * 60 * 60 * 1000;
    if period_ms <= 0 || now <= budget.period_start {
        return budget.period_start;
    }
    let elapsed = now - budget.period_start;
    budget.period_start + (elapsed / period_ms) * period_ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    async fn provider(conn: &Connection, name: &str) -> i64 {
        crate::db::ai_provider::add(conn, name, "https://api.anthropic.com", &["m"], name)
            .await
            .expect("provider")
    }

    #[tokio::test]
    async fn a_product_with_no_budget_has_none() {
        let (conn, product_id) = db_with_product().await;
        assert_eq!(get_for_product(&conn, product_id).await.expect("get"), None);
    }

    #[tokio::test]
    async fn a_budget_round_trips_with_its_chain() {
        let (conn, product_id) = db_with_product().await;
        let claude = provider(&conn, "Claude").await;
        let ollama = provider(&conn, "Ollama").await;
        set_budget(&conn, product_id, 100_000_000, 50_000_000, 2_000_000, 75, 90, 100, 30, &[claude, ollama])
            .await
            .expect("set");

        let budget = get_for_product(&conn, product_id).await.expect("get").expect("exists");
        assert_eq!(budget.ai_budget_micropence, 50_000_000);
        assert_eq!(budget.provider_chain, vec![claude, ollama]);
        assert_eq!(budget.handover_pct, 90);
    }

    #[tokio::test]
    async fn thresholds_must_be_in_order() {
        let (conn, product_id) = db_with_product().await;
        assert!(set_budget(&conn, product_id, 0, 100, 0, 95, 90, 100, 30, &[]).await.is_err());
        assert!(set_budget(&conn, product_id, 0, 100, 0, 75, 110, 100, 30, &[]).await.is_err());
        set_budget(&conn, product_id, 0, 100, 0, 90, 90, 90, 30, &[])
            .await
            .expect("equal thresholds are allowed");
    }

    #[tokio::test]
    async fn budget_rejects_bad_products_negatives_periods_and_unknown_providers() {
        let (conn, product_id) = db_with_product().await;
        assert!(set_budget(&conn, 999, 0, 100, 0, 75, 90, 100, 30, &[]).await.is_err());
        assert!(set_budget(&conn, product_id, 0, -1, 0, 75, 90, 100, 30, &[]).await.is_err());
        assert!(set_budget(&conn, product_id, 0, 100, 0, 75, 90, 100, 0, &[]).await.is_err());
        assert!(set_budget(&conn, product_id, 0, 100, 0, 75, 90, 100, 30, &[999]).await.is_err());
    }

    /// Editing the amounts mid-period must not hand back a fresh allowance.
    #[tokio::test]
    async fn editing_a_budget_keeps_the_period_start() {
        let (conn, product_id) = db_with_product().await;
        set_budget(&conn, product_id, 0, 100, 0, 75, 90, 100, 30, &[]).await.expect("first");
        let first = get_for_product(&conn, product_id).await.expect("get").expect("exists");

        set_budget(&conn, product_id, 0, 999, 0, 75, 90, 100, 30, &[]).await.expect("second");
        let second = get_for_product(&conn, product_id).await.expect("get").expect("exists");

        assert_eq!(second.period_start, first.period_start);
        assert_eq!(second.ai_budget_micropence, 999);
    }

    #[test]
    fn the_period_rolls_forward_without_anyone_resetting_it() {
        let day = 24 * 60 * 60 * 1000;
        let budget = ProductBudget {
            id: 1,
            product_id: 1,
            total_budget_micropence: 0,
            ai_budget_micropence: 100,
            token_limit: 0,
            warn_pct: 75,
            handover_pct: 90,
            hard_stop_pct: 100,
            period_days: 30,
            period_start: 0,
            provider_chain: vec![],
            updated_at: 0,
        };
        assert_eq!(current_period_start(&budget, 0), 0);
        assert_eq!(current_period_start(&budget, 29 * day), 0);
        assert_eq!(current_period_start(&budget, 30 * day), 30 * day);
        assert_eq!(current_period_start(&budget, 61 * day), 60 * day);
    }
}
