//! Which effort levels a given model will actually accept.
//!
//! Effort is how much Claude spends on a reply — thinking, tool calls, prose,
//! all of it. Five levels exist (`low`, `medium`, `high`, `xhigh`, `max`) and
//! `high` is the default, meaning it behaves exactly as if the parameter were
//! never sent.
//!
//! **Support is not uniform, which is the whole reason this file exists.** Two
//! separate facts have to be respected, and getting either wrong is a failed
//! call rather than a weaker answer:
//!
//! - Some models take no effort parameter at all. Haiku is the one this app
//!   offers, and it sits on the *cheapest* complexity row — so the naive
//!   "always send it" would break the tier people use most.
//! - `xhigh` arrived after `max` did, so a model can support `max` and reject
//!   `xhigh`. Ordering the levels and assuming a prefix works is wrong.
//!
//! **An unknown model is assumed to support everything.** The list here is one
//! somebody maintains, and the app deliberately lets a model name be typed in;
//! a model released tomorrow is far likelier to support effort than not, since
//! everything from 4.6 onward does. That way round the mistake is also the
//! louder one — a rejected level fails immediately and says so, where silently
//! dropping effort spends at the default and never mentions it.

/// Every level, cheapest first.
pub const ALL: &[&str] = &["low", "medium", "high", "xhigh", "max"];

/// Levels this model accepts. Empty when it takes no effort parameter at all.
pub fn levels_for(model: &str) -> &'static [&'static str] {
    let name = model.trim().to_ascii_lowercase();
    if name.contains("haiku") {
        return &[];
    }
    // `xhigh` is newer than `max`: these support the older one and not it.
    if name.contains("sonnet-4-6") || name.contains("opus-4-6") || name.contains("opus-4-5") {
        return &["low", "medium", "high", "max"];
    }
    ALL
}

/// The level to actually send, given what was asked for.
///
/// Returns `None` when the model takes no effort at all — the caller leaves the
/// parameter out rather than sending something.
///
/// An unsupported level **steps down** to the best one below it rather than
/// failing: asking for `xhigh` on a model that stops at `high` means "work
/// hard", and the honest reading of that is high, not an error page. Stepping
/// *up* would spend more than was asked for, which is never the safe default.
pub fn resolve(model: &str, wanted: &str) -> Option<&'static str> {
    let levels = levels_for(model);
    if levels.is_empty() {
        return None;
    }
    if let Some(exact) = levels.iter().find(|l| **l == wanted) {
        return Some(exact);
    }
    // Where the request sits on the full scale, so the step down is to the
    // nearest supported level *below* it — not merely to the end of the list.
    let ceiling = ALL.iter().position(|l| *l == wanted)?;
    levels
        .iter()
        .filter(|l| ALL.iter().position(|a| a == *l).unwrap_or(0) <= ceiling)
        .next_back()
        .copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_models_this_app_offers_take_every_level() {
        for model in ["claude-sonnet-5", "claude-opus-5", "claude-fable-5"] {
            assert_eq!(levels_for(model), ALL, "for {model}");
            assert_eq!(resolve(model, "max"), Some("max"));
            assert_eq!(resolve(model, "xhigh"), Some("xhigh"));
        }
    }

    /// **Haiku takes no effort parameter** — and it is the default model on the
    /// cheapest complexity, so "always send it" would break the commonest tier.
    #[test]
    fn haiku_takes_no_effort_at_all() {
        assert!(levels_for("claude-haiku-4-5").is_empty());
        assert_eq!(resolve("claude-haiku-4-5", "low"), None);
        assert_eq!(resolve("claude-haiku-4-5", "max"), None);
    }

    /// `xhigh` is newer than `max`, so supporting one says nothing about the
    /// other. Asking for it where it does not exist steps *down* to high.
    #[test]
    fn xhigh_steps_down_on_a_model_that_only_reaches_max() {
        assert_eq!(resolve("claude-sonnet-4-6", "xhigh"), Some("high"));
        // …but max itself is still available there, so the step down must not
        // simply be "the last level this model has".
        assert_eq!(resolve("claude-sonnet-4-6", "max"), Some("max"));
    }

    #[test]
    fn a_model_nobody_has_heard_of_is_given_the_benefit_of_the_doubt() {
        assert_eq!(resolve("claude-something-6", "max"), Some("max"));
    }

    /// A word that is not a level at all cannot be stepped down from, and must
    /// not be sent: the API would reject it.
    #[test]
    fn a_word_that_is_not_a_level_resolves_to_nothing() {
        assert_eq!(resolve("claude-opus-5", "ultra"), None);
        assert_eq!(resolve("claude-opus-5", ""), None);
    }

    #[test]
    fn stepping_down_never_spends_more_than_was_asked() {
        for wanted in ALL {
            let got = resolve("claude-sonnet-4-6", wanted);
            if let Some(got) = got {
                let asked = ALL.iter().position(|l| l == wanted).unwrap();
                let sent = ALL.iter().position(|l| *l == got).unwrap();
                assert!(sent <= asked, "{wanted} became {got}");
            }
        }
    }
}
