//! Budget commands: what a Product may spend on AI, what it has spent, and the
//! per-model price table those figures are computed from.

use super::{to_message, AppDb};
use crate::ai::router::{self, BudgetState, Decision, ProviderOption};
use crate::db::{ai_provider, ai_usage, model_price, product_budget};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductBudgetDto {
    pub product_id: i64,
    pub total_budget_micropence: i64,
    pub ai_budget_micropence: i64,
    pub token_limit: i64,
    pub warn_pct: i64,
    pub handover_pct: i64,
    pub hard_stop_pct: i64,
    pub period_days: i64,
    pub provider_chain: Vec<i64>,
}

/// What the Product has spent this period and what the router would do next —
/// the panel shows the real decision rather than re-deriving it in TypeScript,
/// so the displayed state cannot drift from the enforced one.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendSummaryDto {
    pub spent_micropence: i64,
    pub spent_tokens: i64,
    pub calls: i64,
    pub ai_budget_micropence: i64,
    pub token_limit: i64,
    pub used_pct: i64,
    /// "none" (no budget) | "ok" | "warn" | "handover" | "blocked"
    pub state: String,
    pub active_provider: Option<String>,
    pub reason: String,
    pub period_start: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPriceDto {
    pub id: i64,
    pub provider_id: i64,
    pub model: String,
    pub input_pence_per_mtok: i64,
    pub output_pence_per_mtok: i64,
    pub tokens_per_second: i64,
}

#[tauri::command]
pub async fn get_product_budget(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Option<ProductBudgetDto>, String> {
    let conn = db.0.lock().await;
    let budget = product_budget::get_for_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    Ok(budget.map(|b| ProductBudgetDto {
        product_id: b.product_id,
        total_budget_micropence: b.total_budget_micropence,
        ai_budget_micropence: b.ai_budget_micropence,
        token_limit: b.token_limit,
        warn_pct: b.warn_pct,
        handover_pct: b.handover_pct,
        hard_stop_pct: b.hard_stop_pct,
        period_days: b.period_days,
        provider_chain: b.provider_chain,
    }))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn set_product_budget(
    db: State<'_, AppDb>,
    product_id: i64,
    total_budget_micropence: i64,
    ai_budget_micropence: i64,
    token_limit: i64,
    warn_pct: i64,
    handover_pct: i64,
    hard_stop_pct: i64,
    period_days: i64,
    provider_chain: Vec<i64>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    product_budget::set_budget(
        &conn,
        product_id,
        total_budget_micropence,
        ai_budget_micropence,
        token_limit,
        warn_pct,
        handover_pct,
        hard_stop_pct,
        period_days,
        &provider_chain,
    )
    .await
    .map_err(to_message)
}

#[tauri::command]
pub async fn get_spend_summary(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<SpendSummaryDto, String> {
    let conn = db.0.lock().await;
    let budget = product_budget::get_for_product(&conn, product_id)
        .await
        .map_err(to_message)?;

    let Some(budget) = budget else {
        return Ok(SpendSummaryDto {
            spent_micropence: 0,
            spent_tokens: 0,
            calls: 0,
            ai_budget_micropence: 0,
            token_limit: 0,
            used_pct: 0,
            state: "none".into(),
            active_provider: None,
            reason: "No AI budget is set for this Product.".into(),
            period_start: 0,
        });
    };

    let since = product_budget::current_period_start(&budget, crate::db::now_millis());
    let spend = ai_usage::spend_for_product(&conn, product_id, since)
        .await
        .map_err(to_message)?;
    let providers: Vec<ProviderOption> = ai_provider::list_all(&conn)
        .await
        .map_err(to_message)?
        .into_iter()
        .map(|p| ProviderOption {
            id: p.id,
            name: p.name,
            models: p.models,
            metered: p.metered,
        })
        .collect();

    let state = BudgetState {
        ai_budget_micropence: budget.ai_budget_micropence,
        token_limit: budget.token_limit,
        spent_micropence: spend.micropence,
        spent_tokens: spend.tokens,
        warn_pct: budget.warn_pct,
        handover_pct: budget.handover_pct,
        hard_stop_pct: budget.hard_stop_pct,
        chain: budget.provider_chain.clone(),
    };
    // Ask the router what it would actually do, with the chain head as the
    // fallback so the answer reflects a real call.
    let fallback = budget.provider_chain.first().copied().unwrap_or(0);
    let decision = router::route(Some(&state), &providers, fallback, "medium");

    let (label, active_provider, reason) = match decision {
        Decision::Use {
            provider_id,
            handed_over,
            warn,
            reason,
            ..
        } => {
            let name = providers
                .iter()
                .find(|p| p.id == provider_id)
                .map(|p| p.name.clone());
            let label = if handed_over {
                "handover"
            } else if warn {
                "warn"
            } else {
                "ok"
            };
            (label, name, reason)
        }
        Decision::Blocked { reason, .. } => ("blocked", None, reason),
    };

    Ok(SpendSummaryDto {
        spent_micropence: spend.micropence,
        spent_tokens: spend.tokens,
        calls: spend.calls,
        ai_budget_micropence: budget.ai_budget_micropence,
        token_limit: budget.token_limit,
        used_pct: router::used_pct(&state),
        state: label.into(),
        active_provider,
        reason,
        period_start: since,
    })
}

#[tauri::command]
pub async fn list_model_prices(db: State<'_, AppDb>) -> Result<Vec<ModelPriceDto>, String> {
    let conn = db.0.lock().await;
    let prices = model_price::list_all(&conn).await.map_err(to_message)?;
    Ok(prices
        .into_iter()
        .map(|p| ModelPriceDto {
            id: p.id,
            provider_id: p.provider_id,
            model: p.model,
            input_pence_per_mtok: p.input_pence_per_mtok,
            output_pence_per_mtok: p.output_pence_per_mtok,
            tokens_per_second: p.tokens_per_second,
        })
        .collect())
}

#[tauri::command]
pub async fn set_model_price(
    db: State<'_, AppDb>,
    provider_id: i64,
    model: String,
    input_pence_per_mtok: i64,
    output_pence_per_mtok: i64,
    tokens_per_second: i64,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    model_price::set_price(
        &conn,
        provider_id,
        &model,
        input_pence_per_mtok,
        output_pence_per_mtok,
        tokens_per_second,
    )
    .await
    .map_err(to_message)
}

#[tauri::command]
pub async fn delete_model_price(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    model_price::delete(&conn, id).await.map_err(to_message)
}
