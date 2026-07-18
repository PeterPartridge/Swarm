//! The two-option recommendation for a scoped work item: the fastest way to get
//! it done, and the cheapest.
//!
//! Recommendations are **computed on demand, not stored.** The plan called for
//! a table, but every input — prices, budget, recorded history — changes
//! independently of the work item, so a stored recommendation starts going
//! stale the moment it is written. Recomputing is cheap (no network, just the
//! ledger and the price table) and is always right, which a cached answer about
//! money would not be.

use super::{to_message, AppDb};
use crate::ai::estimator::{self, Estimate};
use crate::ai::tiering;
use crate::db::{ai_provider, ai_usage, model_price, product_budget, work_item};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationDto {
    /// "fastest" | "costEfficient"
    pub kind: String,
    pub provider: String,
    pub model: String,
    pub est_tokens: i64,
    pub est_cost_micropence: i64,
    pub est_minutes: i64,
    /// "priceTable" (a stated guess) | "history" (median of real calls)
    pub source: String,
    pub affordable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationsDto {
    pub options: Vec<RecommendationDto>,
    /// Set when an option had to be withheld rather than shown.
    pub note: Option<String>,
}

/// Estimates both ways of doing a piece of work.
///
/// `purpose` is what the call would be for, so the estimate reflects the actual
/// job — planning stories is not the same size of task as designing a solution.
#[tauri::command]
pub async fn recommend_for_work_item(
    db: State<'_, AppDb>,
    work_item_id: i64,
    purpose: String,
) -> Result<RecommendationsDto, String> {
    let conn = db.0.lock().await;

    let Some(item) = work_item::find_by_id(&conn, work_item_id)
        .await
        .map_err(to_message)?
    else {
        return Err("that work item no longer exists".into());
    };
    let size = estimator::size_factor(&item.title, item.description.as_deref());

    // Budget state, so an option can be marked unaffordable rather than
    // offered and then refused by the router at the moment of spending.
    let budget = product_budget::get_for_product(&conn, item.product_id)
        .await
        .map_err(to_message)?;
    let (ai_budget, spent, hard_stop_reached) = match &budget {
        Some(b) => {
            let since = product_budget::current_period_start(b, crate::db::now_millis());
            let spend = ai_usage::spend_for_product(&conn, item.product_id, since)
                .await
                .map_err(to_message)?;
            let pct = if b.ai_budget_micropence > 0 {
                spend.micropence.saturating_mul(100) / b.ai_budget_micropence
            } else {
                0
            };
            (b.ai_budget_micropence, spend.micropence, pct >= b.hard_stop_pct)
        }
        None => (0, 0, false),
    };

    // Candidates come from the budget's provider chain when there is one, so
    // the options offered are the ones the router would actually allow.
    let providers = ai_provider::list_all(&conn).await.map_err(to_message)?;
    let candidates: Vec<&crate::db::ai_provider::AiProvider> = match &budget {
        Some(b) if !b.provider_chain.is_empty() => b
            .provider_chain
            .iter()
            .filter_map(|id| providers.iter().find(|p| p.id == *id))
            .collect(),
        _ => providers.iter().collect(),
    };
    if candidates.is_empty() {
        return Err("no AI providers are configured — add one in AI Settings".into());
    }

    let mut options = Vec::new();
    let mut note = None;

    // Fastest: the most capable model available, which is the high tier.
    let fastest = pick(&candidates, "high");
    // Cost-efficient: prefer a provider that costs nothing at all; otherwise
    // the cheapest model of the cheapest provider.
    let free = candidates.iter().find(|p| !p.metered).copied();
    let cheapest = free.or_else(|| candidates.first().copied());

    if let Some((provider, model)) = fastest {
        if hard_stop_reached && provider.metered {
            // Offering it would be offering something the router will refuse.
            note = Some(
                "The fastest option is hidden: this Product's AI budget is spent, so a paid model cannot run."
                    .into(),
            );
        } else {
            options.push(
                build(&conn, "fastest", provider, &model, &purpose, size, ai_budget, spent).await?,
            );
        }
    }

    if let Some(provider) = cheapest {
        if let Some(model) = tiering::model_for_effort(&provider.models, "low") {
            let already = options
                .iter()
                .any(|o: &RecommendationDto| o.model == model && o.provider == provider.name);
            if !already {
                options.push(
                    build(&conn, "costEfficient", provider, model, &purpose, size, ai_budget, spent)
                        .await?,
                );
            } else {
                note = Some(
                    "Only one model is configured, so the fastest and cheapest options are the same."
                        .into(),
                );
            }
        }
    }

    if options.is_empty() {
        return Err("no usable model — check that your AI providers have models listed".into());
    }
    Ok(RecommendationsDto { options, note })
}

fn pick<'a>(
    candidates: &[&'a crate::db::ai_provider::AiProvider],
    effort: &str,
) -> Option<(&'a crate::db::ai_provider::AiProvider, String)> {
    candidates.iter().find_map(|p| {
        tiering::model_for_effort(&p.models, effort).map(|m| (*p, m.to_string()))
    })
}

#[allow(clippy::too_many_arguments)]
async fn build(
    conn: &turso::Connection,
    kind: &str,
    provider: &crate::db::ai_provider::AiProvider,
    model: &str,
    purpose: &str,
    size: f64,
    ai_budget: i64,
    spent: i64,
) -> Result<RecommendationDto, String> {
    let price = model_price::find(conn, provider.id, model)
        .await
        .map_err(to_message)?;
    // Enough history to matter, or none — the estimator decides which wins.
    let history = ai_usage::recent_token_totals(conn, purpose, model, 50)
        .await
        .map_err(to_message)?;
    // Measured speed for this model, so "how long" is not a hand-typed guess.
    let throughput = ai_usage::recent_throughput(conn, model, 20)
        .await
        .map_err(to_message)?;
    let estimate: Estimate = estimator::estimate(
        model,
        purpose,
        size,
        price.as_ref(),
        &history,
        &throughput,
        ai_budget,
        spent,
    );
    Ok(RecommendationDto {
        kind: kind.into(),
        provider: provider.name.clone(),
        model: estimate.model,
        est_tokens: estimate.tokens,
        est_cost_micropence: estimate.cost_micropence,
        est_minutes: estimate.minutes,
        source: estimate.source.as_str().into(),
        // A free provider is always affordable whatever the budget says.
        affordable: estimate.affordable || !provider.metered,
    })
}
