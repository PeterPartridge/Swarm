//! Shared plumbing for running a routed, budgeted, ledgered AI call.
//!
//! Both generation commands follow the same three beats, and R4's solution
//! strategy will too, so the beats live here rather than being copied:
//!
//! 1. `plan()` — under the DB lock: read the budget and spend, ask the router
//!    which provider and model to use, and refuse (recording the refusal)
//!    if the budget says no.
//! 2. the caller makes the network call **without the lock held**, so the rest
//!    of the app stays responsive.
//! 3. `record()` — under the lock again: price the tokens and write the ledger.

use super::to_message;
use crate::ai::client::Usage;
use crate::ai::router::{self, BudgetState, Decision, ProviderOption};
use crate::db::ai_usage::{self, TokenCounts};
use crate::db::{ai_provider, model_install, model_price, product_budget};
use crate::db::ai_provider::AiProvider;
use turso::Connection;

/// The router's answer, resolved to the provider row the caller needs.
#[derive(Debug)]
pub(crate) struct Routed {
    pub provider: AiProvider,
    pub model: String,
    /// Plain-English explanation, shown to the user with the result.
    pub reason: String,
}

/// Decides how a call should run, or refuses it. A refusal is written to the
/// ledger with outcome `blocked` before the error is returned, so "we chose not
/// to spend" is as visible in the history as spending would have been.
pub(crate) async fn plan(
    conn: &Connection,
    product_id: i64,
    fallback_provider_id: i64,
    effort: &str,
    purpose: &str,
) -> Result<Routed, String> {
    let providers: Vec<ProviderOption> = ai_provider::list_all(conn)
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

    let budget_row = product_budget::get_for_product(conn, product_id)
        .await
        .map_err(to_message)?;
    let state = match &budget_row {
        Some(budget) => {
            let since = product_budget::current_period_start(budget, crate::db::now_millis());
            let spend = ai_usage::spend_for_product(conn, product_id, since)
                .await
                .map_err(to_message)?;
            Some(BudgetState {
                ai_budget_micropence: budget.ai_budget_micropence,
                token_limit: budget.token_limit,
                spent_micropence: spend.micropence,
                spent_tokens: spend.tokens,
                warn_pct: budget.warn_pct,
                handover_pct: budget.handover_pct,
                hard_stop_pct: budget.hard_stop_pct,
                chain: budget.provider_chain.clone(),
            })
        }
        None => None,
    };

    match router::route(state.as_ref(), &providers, fallback_provider_id, effort) {
        Decision::Use {
            provider_id,
            model,
            reason,
            ..
        } => {
            let provider = ai_provider::find_by_id(conn, provider_id)
                .await
                .map_err(to_message)?
                .ok_or_else(|| "the chosen AI provider no longer exists".to_string())?;

            // A model the platform has not installed is refused here, at the
            // last gate before content moves — so it cannot be reached by any
            // route, including a budget handover that picked it automatically.
            if !model_install::is_installed(conn, provider.id, &model)
                .await
                .map_err(to_message)?
            {
                let _ = ai_usage::record(
                    conn, Some(product_id), None, Some(provider.id), &model, purpose,
                    TokenCounts::default(), 0, 0, "blocked",
                )
                .await;
                return Err(format!(
                    "'{model}' on {} has not been installed yet. Install it in AI Settings — \
                     the platform validates a model before trusting it with work.",
                    provider.name
                ));
            }

            Ok(Routed {
                provider,
                model,
                reason,
            })
        }
        Decision::Blocked { reason, .. } => {
            // Recorded, not silent: a blocked call is a fact worth keeping.
            let _ = ai_usage::record(
                conn,
                Some(product_id),
                None,
                None,
                "",
                purpose,
                TokenCounts::default(),
                0,
                0,
                "blocked",
            )
            .await;
            Err(reason)
        }
    }
}

/// Prices the call and writes it to the ledger. Ledger failures never fail the
/// user's work — the items are already generated, and losing them to a
/// bookkeeping error would be the worse outcome.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn record(
    conn: &Connection,
    product_id: i64,
    work_item_id: Option<i64>,
    provider: &AiProvider,
    model: &str,
    purpose: &str,
    usage: &Usage,
    latency_ms: i64,
    outcome: &str,
) {
    let tokens = TokenCounts {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_tokens: usage.cache_read_input_tokens,
        cache_write_tokens: usage.cache_creation_input_tokens,
    };
    // An unmetered provider costs nothing however many tokens it burned.
    let cost = if provider.metered {
        let price = model_price::find(conn, provider.id, model).await.ok().flatten();
        model_price::cost_micropence(price.as_ref(), &tokens)
    } else {
        0
    };
    let _ = ai_usage::record(
        conn,
        Some(product_id),
        work_item_id,
        Some(provider.id),
        model,
        purpose,
        tokens,
        cost,
        latency_ms,
        outcome,
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    /// Regression guard for a silent-loss bug. `record` swallows ledger errors
    /// deliberately (generated work must never be lost to bookkeeping), which
    /// meant a purpose missing from `PURPOSES` vanished without a trace: two
    /// rounds of marketing, design and architecture spend were never written,
    /// so the budget router routed against an understated bill. **Every purpose
    /// a command passes to `plan`/`record` must be in this list, and this list
    /// must stay in step with the commands.**
    #[tokio::test]
    async fn every_purpose_the_commands_use_actually_reaches_the_ledger() {
        let (conn, product_id) = db_with_product().await;
        let claude_id = claude(&conn).await;
        let provider = ai_provider::find_by_id(&conn, claude_id).await.expect("q").expect("p");

        // One entry per `PURPOSE` constant in commands/ (and the pal's).
        let used_by_commands = [
            "storyGeneration",     // work_items::generate_user_stories
            "deliverablePlanning", // work_items::generate_deliverable_work
            "solutionStrategy",    // strategies::generate_solution_strategy
            "recommendation",      // recommendations
            "modelValidation",     // models::install_model
            "marketingStrategy",   // design::generate_design_strategy
            "designStrategy",      // design::generate_design_strategy
            "architectureDoc",     // architecture::generate_architecture_doc
            "codingPal",           // workspace::ask_coding_pal
            "changePlan",          // work_item_plans::generate_change_plan
        ];
        for purpose in used_by_commands {
            record(
                &conn, product_id, None, &provider, "haiku", purpose,
                &Usage { input_tokens: 10, output_tokens: 5, ..Default::default() },
                1, "ok",
            )
            .await;
        }
        let spend = ai_usage::spend_for_product(&conn, product_id, 0).await.expect("spend");
        assert_eq!(
            spend.calls,
            used_by_commands.len() as i64,
            "a purpose was silently dropped — it is missing from ai_usage::PURPOSES"
        );
    }

    /// Marks a provider's models installed. Every routing test needs this now:
    /// the platform refuses a model it has not validated, so a test that skips
    /// installation is testing the install gate rather than routing.
    async fn install_all(conn: &Connection, provider_id: i64, models: &[&str]) {
        for model in models {
            model_install::set_result(conn, provider_id, model, "installed", "", "{}")
                .await
                .expect("install");
        }
    }

    async fn claude(conn: &Connection) -> i64 {
        let id = ai_provider::add(conn, "Claude", "https://api.anthropic.com", &["haiku", "opus"], "claude")
            .await
            .expect("provider");
        install_all(conn, id, &["haiku", "opus"]).await;
        id
    }

    async fn local(conn: &Connection) -> i64 {
        let id = ai_provider::add_of_kind(
            conn,
            "Ollama",
            "http://localhost:11434",
            &["llama3"],
            "ollama",
            "ollama",
            false,
        )
        .await
        .expect("provider");
        install_all(conn, id, &["llama3"]).await;
        id
    }

    #[tokio::test]
    async fn with_no_budget_the_policys_provider_is_planned() {
        let (conn, product_id) = db_with_product().await;
        let claude_id = claude(&conn).await;
        let routed = plan(&conn, product_id, claude_id, "high", "storyGeneration")
            .await
            .expect("planned");
        assert_eq!(routed.provider.id, claude_id);
        assert_eq!(routed.model, "opus");
    }

    /// End to end through the DB: spend past the handover threshold and the
    /// plan must come back pointing at the free local provider.
    #[tokio::test]
    async fn spending_past_the_threshold_hands_over_to_the_local_provider() {
        let (conn, product_id) = db_with_product().await;
        let claude_id = claude(&conn).await;
        let local_id = local(&conn).await;
        product_budget::set_budget(
            &conn, product_id, 0, 1_000_000, 0, 75, 90, 100, 30, &[claude_id, local_id],
        )
        .await
        .expect("budget");

        // 95% of the AI budget already spent
        ai_usage::record(
            &conn, Some(product_id), None, Some(claude_id), "haiku", "storyGeneration",
            TokenCounts::default(), 950_000, 10, "ok",
        )
        .await
        .expect("record");

        let routed = plan(&conn, product_id, claude_id, "low", "storyGeneration")
            .await
            .expect("planned");
        assert_eq!(routed.provider.id, local_id, "should hand over: {}", routed.reason);
        assert!(routed.reason.contains("handed over"), "got: {}", routed.reason);
    }

    /// A model that has not been through installation is refused at the last
    /// gate, whichever route chose it.
    #[tokio::test]
    async fn an_uninstalled_model_is_refused_even_though_the_provider_is_fine() {
        let (conn, product_id) = db_with_product().await;
        let claude_id = ai_provider::add(
            &conn, "Claude", "https://api.anthropic.com", &["haiku"], "claude",
        )
        .await
        .expect("provider");
        // deliberately not installed

        let err = plan(&conn, product_id, claude_id, "low", "storyGeneration")
            .await
            .expect_err("must be refused");
        assert!(err.contains("has not been installed"), "got: {err}");

        // …and the refusal is on the record, without counting as spend.
        let ledger = ai_usage::list_for_product(&conn, product_id, 10).await.expect("list");
        assert!(ledger.iter().any(|u| u.outcome == "blocked"));
        assert_eq!(ai_usage::spend_for_product(&conn, product_id, 0).await.expect("spend").calls, 0);
    }

    /// The interaction worth knowing about: with all-or-nothing installation, a
    /// local model that failed validation is not a usable handover target, so
    /// passing the threshold stops work rather than degrading it.
    #[tokio::test]
    async fn handover_to_an_uninstalled_local_model_is_refused_not_silently_downgraded() {
        let (conn, product_id) = db_with_product().await;
        let claude_id = claude(&conn).await;
        let local_id = ai_provider::add_of_kind(
            &conn, "Ollama", "http://localhost:11434", &["llama3"], "ollama", "ollama", false,
        )
        .await
        .expect("provider");
        // the handover target exists but never passed validation

        product_budget::set_budget(
            &conn, product_id, 0, 1_000_000, 0, 75, 90, 100, 30, &[claude_id, local_id],
        )
        .await
        .expect("budget");
        ai_usage::record(
            &conn, Some(product_id), None, Some(claude_id), "haiku", "storyGeneration",
            TokenCounts::default(), 950_000, 10, "ok",
        )
        .await
        .expect("record");

        let err = plan(&conn, product_id, claude_id, "low", "storyGeneration")
            .await
            .expect_err("must be refused");
        assert!(
            err.contains("has not been installed"),
            "the user should be told why work stopped, not left guessing: {err}"
        );
    }

    #[tokio::test]
    async fn a_blocked_call_is_refused_and_written_to_the_ledger() {
        let (conn, product_id) = db_with_product().await;
        let claude_id = claude(&conn).await;
        product_budget::set_budget(
            &conn, product_id, 0, 1_000_000, 0, 75, 90, 100, 30, &[claude_id],
        )
        .await
        .expect("budget");
        ai_usage::record(
            &conn, Some(product_id), None, Some(claude_id), "haiku", "storyGeneration",
            TokenCounts::default(), 1_200_000, 10, "ok",
        )
        .await
        .expect("record");

        let err = plan(&conn, product_id, claude_id, "low", "storyGeneration")
            .await
            .expect_err("must be blocked");
        assert!(err.contains("budget is spent"), "got: {err}");

        let ledger = ai_usage::list_for_product(&conn, product_id, 10).await.expect("list");
        assert!(
            ledger.iter().any(|u| u.outcome == "blocked"),
            "the refusal should be recorded"
        );
        // …but the refusal must not itself count as spend
        let spend = ai_usage::spend_for_product(&conn, product_id, 0).await.expect("spend");
        assert_eq!(spend.calls, 1);
    }

    #[tokio::test]
    async fn a_recorded_call_is_priced_from_the_price_table() {
        let (conn, product_id) = db_with_product().await;
        let claude_id = claude(&conn).await;
        model_price::set_price(&conn, claude_id, "haiku", 80, 400, 100)
            .await
            .expect("price");
        let provider = ai_provider::find_by_id(&conn, claude_id).await.expect("q").expect("p");

        record(
            &conn,
            product_id,
            None,
            &provider,
            "haiku",
            "storyGeneration",
            &Usage {
                input_tokens: 1_000,
                output_tokens: 500,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
            },
            1234,
            "ok",
        )
        .await;

        let spend = ai_usage::spend_for_product(&conn, product_id, 0).await.expect("spend");
        assert_eq!(spend.micropence, 1_000 * 80 + 500 * 400);
        assert_eq!(spend.tokens, 1_500);
    }

    /// A local model burns tokens but costs nothing — the ledger must say so,
    /// or handover would keep pushing the budget up after it stopped spending.
    #[tokio::test]
    async fn an_unmetered_provider_records_tokens_at_zero_cost() {
        let (conn, product_id) = db_with_product().await;
        let local_id = local(&conn).await;
        model_price::set_price(&conn, local_id, "llama3", 999, 999, 50)
            .await
            .expect("even with a price row");
        let provider = ai_provider::find_by_id(&conn, local_id).await.expect("q").expect("p");

        record(
            &conn, product_id, None, &provider, "llama3", "storyGeneration",
            &Usage { input_tokens: 10_000, output_tokens: 5_000, ..Default::default() },
            999, "ok",
        )
        .await;

        let spend = ai_usage::spend_for_product(&conn, product_id, 0).await.expect("spend");
        assert_eq!(spend.micropence, 0, "a local model costs nothing");
        assert_eq!(spend.tokens, 15_000, "but its tokens are still counted");
    }
}
