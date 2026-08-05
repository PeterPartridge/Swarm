//! Which provider and model a call should use, given what has been spent.
//!
//! Pure: it takes the budget, the spend so far, and the available providers,
//! and returns a decision. No database, no network, no credential store — the
//! same split that makes the policy gates testable, and the reason this
//! component (which decides whether to spend someone's money) can be covered
//! exhaustively by unit tests.
//!
//! The rule the user asked for — *"free Claude Code until 90% token usage, then
//! hand over to Ollama"* — is expressed as an ordered provider chain plus a
//! handover threshold, so it generalises to any pair of providers.

use crate::ai::tiering::model_for_effort;

/// A provider the router may choose, reduced to what the decision needs.
#[derive(Debug, Clone, PartialEq)]
pub struct ProviderOption {
    pub id: i64,
    pub name: String,
    pub models: Vec<String>,
    /// A provider that costs nothing can still be used past a money limit.
    pub metered: bool,
}

/// The budget and what has been spent against it this period.
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetState {
    pub ai_budget_micropence: i64,
    pub token_limit: i64,
    pub spent_micropence: i64,
    pub spent_tokens: i64,
    pub warn_pct: i64,
    pub handover_pct: i64,
    pub hard_stop_pct: i64,
    /// Ordered provider ids. Empty means "no handover plan".
    pub chain: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    Use {
        provider_id: i64,
        model: String,
        /// Percentage of the budget consumed, for the UI.
        used_pct: i64,
        /// True once past the warn threshold — the call still proceeds.
        warn: bool,
        /// Set when the chain moved off its first provider.
        handed_over: bool,
        reason: String,
    },
    Blocked {
        used_pct: i64,
        reason: String,
    },
}

/// Percentage of the budget used, taking whichever of money or tokens is
/// further along. A limit set to zero means "not limited by this", not "no
/// allowance" — otherwise leaving the token limit blank would block every call.
pub fn used_pct(budget: &BudgetState) -> i64 {
    let money = if budget.ai_budget_micropence > 0 {
        budget.spent_micropence.saturating_mul(100) / budget.ai_budget_micropence
    } else {
        0
    };
    let tokens = if budget.token_limit > 0 {
        budget.spent_tokens.saturating_mul(100) / budget.token_limit
    } else {
        0
    };
    money.max(tokens)
}

/// Chooses the provider and model for a call.
///
/// `fallback` is the provider the work item's policy names — used when no
/// budget governs this Product, or when the budget has no chain.
pub fn route(
    budget: Option<&BudgetState>,
    providers: &[ProviderOption],
    fallback_provider_id: i64,
    effort: &str,
    // `allow_paid`: whether providers that cost money may run at all — the
    // Admin switch. Enforced here rather than by hiding a form, because this is
    // the one place every call passes through. A switch that only tidied the UI
    // would be a suggestion: a provider already in a Product's chain would keep
    // being billed by a queue nobody was watching.
    allow_paid: bool,
) -> Decision {
    let find = |id: i64| {
        providers
            .iter()
            .find(|p| p.id == id)
            .filter(|p| allow_paid || !p.metered)
    };

    // No budget: behave as before, governed only by the item's policy. Adding
    // a budget is what opts a Product into cost control.
    let Some(budget) = budget else {
        return match find(fallback_provider_id).and_then(|p| pick(p, effort)) {
            Some((provider_id, model)) => Decision::Use {
                provider_id,
                model,
                used_pct: 0,
                warn: false,
                handed_over: false,
                reason: "no AI budget is set for this Product".into(),
            },
            // Two very different reasons land here, and saying the wrong one
            // sends somebody to check a model list that was never the problem.
            None => Decision::Blocked {
                used_pct: 0,
                reason: if !allow_paid
                    && providers
                        .iter()
                        .any(|p| p.id == fallback_provider_id && p.metered)
                {
                    "paid API calls are switched off in Admin, and this Product's provider \
                     costs money. Turn them on there, or use Claude Code on your plan or a \
                     local Ollama — neither is billed."
                        .into()
                } else {
                    "the AI provider has no models configured".into()
                },
            },
        };
    };

    let pct = used_pct(budget);
    let past_handover = pct >= budget.handover_pct;
    let past_hard_stop = pct >= budget.hard_stop_pct;

    // Walk the chain from the position the spend has pushed us to, taking the
    // first provider that can actually serve the call.
    let start = if past_handover { 1 } else { 0 };
    let candidates: Vec<i64> = if budget.chain.is_empty() {
        vec![fallback_provider_id]
    } else {
        budget.chain.iter().skip(start).copied().collect()
    };

    for id in &candidates {
        let Some(provider) = find(*id) else { continue };
        // Past the hard stop only a provider that costs nothing may run.
        if past_hard_stop && provider.metered {
            continue;
        }
        let Some((provider_id, model)) = pick(provider, effort) else {
            continue;
        };
        let handed_over = start > 0;
        let reason = if past_hard_stop {
            format!(
                "the AI budget is spent ({pct}%) — using {}, which costs nothing",
                provider.name
            )
        } else if handed_over {
            format!(
                "past {}% of the AI budget — handed over to {}",
                budget.handover_pct, provider.name
            )
        } else if pct >= budget.warn_pct {
            format!("{pct}% of the AI budget used")
        } else {
            format!("within budget ({pct}% used)")
        };
        return Decision::Use {
            provider_id,
            model,
            used_pct: pct,
            warn: pct >= budget.warn_pct,
            handed_over,
            reason,
        };
    }

    Decision::Blocked {
        used_pct: pct,
        reason: if past_hard_stop {
            format!(
                "the AI budget is spent ({pct}% of it) and no free provider is available. \
                 Raise the budget or add a local provider to the chain."
            )
        } else if past_handover {
            format!(
                "past {}% of the AI budget, and the provider chain has nothing to hand over to. \
                 Add a provider to the chain in the Product's budget.",
                budget.handover_pct
            )
        } else if !allow_paid && providers.iter().any(|p| p.metered) {
            // Naming the switch matters: without it this reads as a broken
            // setup, and somebody goes looking for a fault in a chain that is
            // fine. It is off, and off is the default.
            "paid API calls are switched off in Admin, and the providers set up here all \
             cost money. Turn them on there, or use Claude Code on your plan or a local \
             Ollama — neither is billed."
                .into()
        } else {
            "no usable AI provider — check the provider chain and that each provider has models"
                .into()
        },
    }
}

fn pick(provider: &ProviderOption, effort: &str) -> Option<(i64, String)> {
    model_for_effort(&provider.models, effort).map(|m| (provider.id, m.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claude() -> ProviderOption {
        ProviderOption {
            id: 1,
            name: "Claude".into(),
            models: vec!["haiku".into(), "sonnet".into(), "opus".into()],
            metered: true,
        }
    }

    fn ollama() -> ProviderOption {
        ProviderOption {
            id: 2,
            name: "Ollama".into(),
            models: vec!["llama3".into()],
            metered: false,
        }
    }

    /// £50 budget, spend expressed as a percentage of it.
    fn budget_at(pct: i64) -> BudgetState {
        let ai_budget = 50_000_000; // 50p in micropence — the unit does not matter here
        BudgetState {
            ai_budget_micropence: ai_budget,
            token_limit: 0,
            spent_micropence: ai_budget * pct / 100,
            spent_tokens: 0,
            warn_pct: 75,
            handover_pct: 90,
            hard_stop_pct: 100,
            chain: vec![1, 2],
        }
    }

    #[test]
    fn with_no_budget_the_policys_provider_is_used() {
        let decision = route(None, &[claude()], 1, "high", true);
        match decision {
            Decision::Use { provider_id, model, warn, handed_over, .. } => {
                assert_eq!(provider_id, 1);
                assert_eq!(model, "opus");
                assert!(!warn && !handed_over);
            }
            other => panic!("expected Use, got {other:?}"),
        }
    }

    #[test]
    fn under_the_warn_threshold_the_first_provider_runs_quietly() {
        let decision = route(Some(&budget_at(10)), &[claude(), ollama()], 1, "low", true);
        match decision {
            Decision::Use { provider_id, model, warn, handed_over, used_pct, .. } => {
                assert_eq!(provider_id, 1);
                assert_eq!(model, "haiku");
                assert_eq!(used_pct, 10);
                assert!(!warn && !handed_over);
            }
            other => panic!("expected Use, got {other:?}"),
        }
    }

    #[test]
    fn past_the_warn_threshold_the_call_proceeds_but_is_flagged() {
        let decision = route(Some(&budget_at(80)), &[claude(), ollama()], 1, "low", true);
        match decision {
            Decision::Use { provider_id, warn, handed_over, .. } => {
                assert_eq!(provider_id, 1, "warning must not change the provider");
                assert!(warn);
                assert!(!handed_over);
            }
            other => panic!("expected Use, got {other:?}"),
        }
    }

    /// The headline rule: Claude until 90%, then Ollama.
    #[test]
    fn at_the_handover_threshold_the_chain_moves_to_the_next_provider() {
        let decision = route(Some(&budget_at(90)), &[claude(), ollama()], 1, "high", true);
        match decision {
            Decision::Use { provider_id, model, handed_over, reason, .. } => {
                assert_eq!(provider_id, 2, "should have handed over to Ollama");
                assert_eq!(model, "llama3");
                assert!(handed_over);
                assert!(reason.contains("handed over"), "got: {reason}");
            }
            other => panic!("expected Use, got {other:?}"),
        }
    }

    /// Past the hard stop a free provider may still run — spending nothing
    /// cannot breach a money budget.
    #[test]
    fn past_the_hard_stop_a_free_provider_still_runs() {
        let decision = route(Some(&budget_at(120)), &[claude(), ollama()], 1, "low", true);
        match decision {
            Decision::Use { provider_id, reason, .. } => {
                assert_eq!(provider_id, 2);
                assert!(reason.contains("costs nothing"), "got: {reason}");
            }
            other => panic!("expected Use, got {other:?}"),
        }
    }

    #[test]
    fn past_the_hard_stop_with_only_metered_providers_the_call_is_blocked() {
        let mut budget = budget_at(120);
        budget.chain = vec![1]; // Claude only
        let decision = route(Some(&budget), &[claude()], 1, "low", true);
        match decision {
            Decision::Blocked { used_pct, reason } => {
                assert_eq!(used_pct, 120);
                assert!(reason.contains("no free provider"), "got: {reason}");
            }
            other => panic!("expected Blocked, got {other:?}"),
        }
    }

    #[test]
    fn past_handover_with_nothing_left_in_the_chain_is_blocked() {
        let mut budget = budget_at(95);
        budget.chain = vec![1]; // nothing to hand over to
        let decision = route(Some(&budget), &[claude()], 1, "low", true);
        match decision {
            Decision::Blocked { reason, .. } => {
                assert!(reason.contains("nothing to hand over to"), "got: {reason}");
            }
            other => panic!("expected Blocked, got {other:?}"),
        }
    }

    #[test]
    fn an_empty_chain_falls_back_to_the_policys_provider_while_in_budget() {
        let mut budget = budget_at(10);
        budget.chain = vec![];
        let decision = route(Some(&budget), &[claude()], 1, "medium", true);
        match decision {
            Decision::Use { provider_id, model, .. } => {
                assert_eq!(provider_id, 1);
                assert_eq!(model, "sonnet");
            }
            other => panic!("expected Use, got {other:?}"),
        }
    }

    /// A token ceiling governs even when the money budget is untouched.
    #[test]
    fn the_token_limit_can_trigger_handover_on_its_own() {
        let budget = BudgetState {
            ai_budget_micropence: 0, // no money limit
            token_limit: 1_000_000,
            spent_micropence: 0,
            spent_tokens: 950_000, // 95%
            warn_pct: 75,
            handover_pct: 90,
            hard_stop_pct: 100,
            chain: vec![1, 2],
        };
        match route(Some(&budget), &[claude(), ollama()], 1, "low", true) {
            Decision::Use { provider_id, used_pct, .. } => {
                assert_eq!(provider_id, 2);
                assert_eq!(used_pct, 95);
            }
            other => panic!("expected Use, got {other:?}"),
        }
    }

    /// Blank limits mean "not limited by this", not "no allowance" — otherwise
    /// leaving a field empty would block every call.
    #[test]
    fn unset_limits_never_block() {
        let budget = BudgetState {
            ai_budget_micropence: 0,
            token_limit: 0,
            spent_micropence: 99_999,
            spent_tokens: 99_999,
            warn_pct: 75,
            handover_pct: 90,
            hard_stop_pct: 100,
            chain: vec![1, 2],
        };
        assert_eq!(used_pct(&budget), 0);
        match route(Some(&budget), &[claude(), ollama()], 1, "low", true) {
            Decision::Use { provider_id, .. } => assert_eq!(provider_id, 1),
            other => panic!("expected Use, got {other:?}"),
        }
    }

    #[test]
    fn a_provider_with_no_models_is_skipped_for_the_next_in_the_chain() {
        let empty = ProviderOption {
            id: 1,
            name: "Broken".into(),
            models: vec![],
            metered: true,
        };
        let mut budget = budget_at(10);
        budget.chain = vec![1, 2];
        match route(Some(&budget), &[empty, ollama()], 1, "low", true) {
            Decision::Use { provider_id, .. } => assert_eq!(provider_id, 2),
            other => panic!("expected Use, got {other:?}"),
        }
    }

    #[test]
    fn a_chain_naming_a_deleted_provider_is_skipped_not_fatal() {
        let mut budget = budget_at(10);
        budget.chain = vec![99, 2]; // 99 no longer exists
        match route(Some(&budget), &[ollama()], 1, "low", true) {
            Decision::Use { provider_id, .. } => assert_eq!(provider_id, 2),
            other => panic!("expected Use, got {other:?}"),
        }
    }

    /// **The switch, where it has to bite.** Hiding a form would leave a
    /// provider already in a Product's chain being billed by a queue nobody was
    /// watching. Off means the metered provider is not chosen, whatever the
    /// chain says.
    #[test]
    fn with_paid_calls_off_a_metered_provider_is_not_chosen() {
        let decision = route(Some(&budget_at(10)), &[claude(), ollama()], 1, "low", false);
        match decision {
            // Claude is first in the chain and costs money; Ollama is behind it
            // and does not.
            Decision::Use { provider_id, model, .. } => {
                assert_eq!(provider_id, 2, "the free provider runs instead");
                assert_eq!(model, "llama3");
            }
            other => panic!("expected the free provider, got {other:?}"),
        }
    }

    /// With nothing free to fall back to, the call is refused — and the reason
    /// names the switch. Without that it reads as a broken chain, and somebody
    /// goes hunting a fault that is not there.
    #[test]
    fn with_paid_calls_off_and_nothing_free_the_reason_names_the_switch() {
        let decision = route(Some(&budget_at(10)), &[claude()], 1, "low", false);
        match decision {
            Decision::Blocked { reason, .. } => {
                assert!(
                    reason.contains("switched off in Admin"),
                    "the refusal must name the switch: {reason}"
                );
                assert!(
                    reason.contains("Claude Code") || reason.contains("Ollama"),
                    "and say what would work instead: {reason}"
                );
            }
            other => panic!("expected Blocked, got {other:?}"),
        }
    }

    /// The switch governs money, not Claude specifically: a hosted Ollama bills
    /// for somebody else's hardware just as surely as an API key does.
    #[test]
    fn the_switch_stops_any_metered_provider_not_just_claude() {
        let hosted = ProviderOption {
            id: 3,
            name: "Ollama Cloud".into(),
            models: vec!["gpt-oss".into()],
            metered: true,
        };
        let decision = route(None, &[hosted], 3, "low", false);
        assert!(
            matches!(decision, Decision::Blocked { .. }),
            "a metered Ollama is still a metered provider"
        );
    }

    /// And with the switch on, nothing changes — the budget rules still decide.
    #[test]
    fn with_paid_calls_on_the_budget_rules_are_unchanged() {
        let decision = route(Some(&budget_at(10)), &[claude(), ollama()], 1, "low", true);
        assert!(matches!(
            decision,
            Decision::Use { provider_id: 1, .. }
        ));
    }

    #[test]
    fn no_usable_provider_at_all_is_blocked() {
        let decision = route(Some(&budget_at(10)), &[], 1, "low", true);
        assert!(matches!(decision, Decision::Blocked { .. }));
    }
}
