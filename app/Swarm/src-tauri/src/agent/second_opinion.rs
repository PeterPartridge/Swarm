//! A second model's opinion of a change, and who gave it.
//!
//! **A second opinion, not a second gate.** `review.rs` checks a diff against
//! the Developer Rules; that is mechanical, it blocks, and it stays exactly as
//! it is. This is a different model reading the same diff and saying what it
//! thinks. Nothing here blocks anything.
//!
//! **Attribution is the whole point, and it is not decoration.** A local model
//! reviewing work done by a far more capable one is worth having, and is not
//! the same as that model reviewing itself. So every opinion carries the model
//! and provider that produced it, and there is no shape in this module that can
//! hold an opinion without them.
//!
//! **The absent case is a statement, not an empty result.** With no Secondary
//! for the area, an empty review panel reads exactly like a review that found
//! nothing — which is the difference between "nobody looked" and "it is fine".
//! So not-happening is a value with a reason in it.

use crate::ai::client::Prompt;
use crate::files::workspace::FileChange;

/// How much of the change is worth sending.
///
/// **A limit, because a diff has no upper size and a prompt does.** Forty
/// thousand characters is enough for the changes a single run produces and
/// small enough that an accidental vendored folder does not turn one review
/// into a bill. Truncation is reported rather than hidden: an opinion about
/// half a change is worth having only if you know that is what it is.
const MOST_DIFF: usize = 40_000;

/// What a second opinion is, once there is one.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondOpinion {
    /// The model that gave it. **Never empty** — an unattributed opinion is
    /// what this module exists to make impossible.
    pub model: String,
    /// The provider it came from, so "Ollama" and "Claude Code" are told apart
    /// when both could be running the same model name.
    pub provider: String,
    /// What it said.
    pub notes: String,
    /// Whether the diff it saw was only the beginning of the change.
    pub truncated: bool,
}

/// Why there is no opinion, when there is none.
///
/// Each of these reads differently to somebody looking at a run, which is the
/// reason they are separate rather than one empty string.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "why", content = "detail")]
pub enum NotGiven {
    /// No Secondary is set for this area. The ordinary case, and not a fault.
    NoSecondary,
    /// A Secondary is set but the change had nothing in it to read.
    NothingChanged,
    /// It was asked and could not answer — the reason is the model's or the
    /// network's, and it is kept because "no opinion" and "it failed" are
    /// different things to see on a run.
    Failed(String),
    /// It declined, which a model is allowed to do. Its reason, not ours.
    Declined(String),
}

/// A second opinion, or why there is not one.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Given(SecondOpinion),
    NotGiven(NotGiven),
}

impl Outcome {
    /// One line for a run's record, always naming the model when there is one.
    pub fn says(&self) -> String {
        match self {
            Outcome::Given(o) => format!("{} via {} reviewed this change", o.model, o.provider),
            Outcome::NotGiven(NotGiven::NoSecondary) => {
                "No Secondary AI is set for Develop, so nothing gave a second opinion".into()
            }
            Outcome::NotGiven(NotGiven::NothingChanged) => {
                "There was nothing changed to review".into()
            }
            Outcome::NotGiven(NotGiven::Failed(why)) => {
                format!("The Secondary AI was asked and could not answer: {why}")
            }
            Outcome::NotGiven(NotGiven::Declined(why)) => {
                format!("The Secondary AI declined: {why}")
            }
        }
    }
}

/// The changed files as text a model can read, and whether it is all of them.
///
/// **Added lines only, the same rule `review.rs` learned.** A diff that deletes
/// the last Java file mentions Java on every removed line, and asking a model
/// about removals invites it to report the fix as the fault.
pub fn diff_text(changes: &[FileChange]) -> (String, bool) {
    let mut out = String::new();
    let mut truncated = false;
    for change in changes {
        let header = format!("--- {} ({})\n", change.path, change.status);
        if out.len() + header.len() > MOST_DIFF {
            truncated = true;
            break;
        }
        out.push_str(&header);
        // `review.rs` owns this: the `+++` header is a trap, and two
        // implementations of the same strip is one that drifts.
        for line in super::review::added_text(change).lines() {
            let line = format!("+ {line}\n");
            if out.len() + line.len() > MOST_DIFF {
                truncated = true;
                break;
            }
            out.push_str(&line);
        }
        if truncated {
            break;
        }
    }
    (out, truncated)
}

/// What to ask the Secondary.
///
/// **It is told it is the second reader, and what already ran.** A model that
/// does not know the rules were already checked mechanically spends its answer
/// repeating them, which is the most expensive way to learn nothing.
pub fn build_prompt(diff: &str, rules_doc: &str, truncated: bool) -> Prompt {
    let mut context = String::from(
        "You are giving a second opinion on a change another AI has already made. \
         A mechanical check against the team's developer rules has already run, so do not \
         repeat it — assume the rules below are known and look for what a rules check cannot \
         see: mistakes, missed cases, things that will surprise somebody later.\n\n",
    );
    if !rules_doc.trim().is_empty() {
        context.push_str("The team's developer rules, for context only:\n");
        context.push_str(rules_doc);
        context.push_str("\n\n");
    }
    if truncated {
        context.push_str(
            "NOTE: the change was larger than could be sent. You are seeing only the \
             beginning of it. Say so if that limits what you can judge.\n\n",
        );
    }
    context.push_str("The added lines of the change:\n");
    context.push_str(diff);

    Prompt {
        context,
        task: "Give a short second opinion. Say what looks wrong or risky and why, and say \
               plainly if it looks fine. Do not rewrite the code. If you cannot judge it from \
               what you were given, say that instead of guessing."
            .into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change(path: &str, added: &[&str]) -> FileChange {
        FileChange {
            path: path.into(),
            status: "modified".into(),
            added_lines: added.len() as i64,
            removed_lines: 0,
            diff: added.iter().map(|l| format!("+{l}\n")).collect(),
        }
    }

    /// **Attribution cannot be omitted.** There is no shape here that holds an
    /// opinion without the model that gave it — which is the one thing this
    /// module exists to guarantee.
    #[test]
    fn an_opinion_always_names_its_model_and_provider() {
        let given = Outcome::Given(SecondOpinion {
            model: "kimi-k2".into(),
            provider: "Ollama Cloud".into(),
            notes: "The error path is unhandled.".into(),
            truncated: false,
        });
        let said = given.says();
        assert!(said.contains("kimi-k2"), "{said}");
        assert!(said.contains("Ollama Cloud"), "{said}");
    }

    /// **"Nobody looked" and "it is fine" must never read the same.** An empty
    /// panel is the failure this enum exists to prevent, so each absent case
    /// says something different.
    #[test]
    fn every_reason_for_no_opinion_reads_differently() {
        let reasons = [
            Outcome::NotGiven(NotGiven::NoSecondary),
            Outcome::NotGiven(NotGiven::NothingChanged),
            Outcome::NotGiven(NotGiven::Failed("timed out".into())),
            Outcome::NotGiven(NotGiven::Declined("not enough context".into())),
        ];
        let said: Vec<String> = reasons.iter().map(Outcome::says).collect();
        for line in &said {
            assert!(!line.trim().is_empty(), "an absent opinion still has to say something");
        }
        let unique: std::collections::HashSet<&String> = said.iter().collect();
        assert_eq!(unique.len(), said.len(), "these must not read alike: {said:?}");
        // And the failure keeps the reason, because "no opinion" and "it broke"
        // are different things to find on a run.
        assert!(said[2].contains("timed out"), "{}", said[2]);
        assert!(said[3].contains("not enough context"), "{}", said[3]);
    }

    /// **Added lines only**, the same rule the rules-based review learned the
    /// expensive way: a diff that removes the last Java file mentions Java on
    /// every removed line.
    #[test]
    fn only_added_lines_are_sent() {
        let mut c = change("src/main.rs", &["let x = 1;"]);
        c.diff.push_str("-let removed = 2;\n");
        let (text, truncated) = diff_text(&[c]);
        assert!(text.contains("let x = 1;"));
        assert!(!text.contains("removed"), "removals must not be sent: {text}");
        assert!(!truncated);
    }

    /// **A diff has no upper size and a prompt does.** Truncation is reported
    /// rather than hidden: an opinion about half a change is worth having only
    /// if you know that is what it is.
    #[test]
    fn an_enormous_change_is_cut_and_says_so() {
        let big: Vec<String> = (0..5000).map(|i| format!("let line{i} = {i};")).collect();
        let refs: Vec<&str> = big.iter().map(String::as_str).collect();
        let (text, truncated) = diff_text(&[change("src/big.rs", &refs)]);
        assert!(truncated, "a change this size must report as truncated");
        assert!(text.len() <= MOST_DIFF + 200, "cut near the limit, got {}", text.len());

        // And the prompt tells the model, so it can say its judgement is
        // limited rather than sounding confident about what it never saw.
        let prompt = build_prompt(&text, "", truncated);
        assert!(prompt.context.contains("only the"), "{}", prompt.context);
    }

    /// The model is told the rules check already ran, so it does not spend the
    /// answer repeating it — the most expensive way to learn nothing.
    #[test]
    fn the_prompt_says_what_already_ran() {
        let prompt = build_prompt("+ let x = 1;", "No Java.", false);
        assert!(prompt.context.contains("already run"), "{}", prompt.context);
        assert!(prompt.context.contains("No Java."), "rules travel as context");
        assert!(prompt.task.contains("Do not rewrite"), "{}", prompt.task);
    }

    /// With no rules at all there is nothing to send, and the prompt must not
    /// carry an empty rules heading that reads like rules with nothing in them.
    #[test]
    fn no_rules_means_no_rules_section() {
        let prompt = build_prompt("+ let x = 1;", "   ", false);
        assert!(!prompt.context.contains("developer rules, for context"), "{}", prompt.context);
    }

    /// **What is stored has to survive being stored.** The outcome goes into a
    /// run as JSON and is read back to render it, so a shape that serialises
    /// one way and parses another would lose the attribution at exactly the
    /// point somebody is looking for it.
    #[test]
    fn an_outcome_survives_the_round_trip_it_is_stored_by() {
        let cases = vec![
            Outcome::Given(SecondOpinion {
                model: "kimi-k2".into(),
                provider: "Ollama Cloud".into(),
                notes: "The retry has no upper bound.".into(),
                truncated: true,
            }),
            Outcome::NotGiven(NotGiven::NoSecondary),
            Outcome::NotGiven(NotGiven::NothingChanged),
            Outcome::NotGiven(NotGiven::Failed("connection refused".into())),
            Outcome::NotGiven(NotGiven::Declined("too little context".into())),
        ];
        for case in cases {
            let json = serde_json::to_string(&case).expect("serialise");
            let back: Outcome = serde_json::from_str(&json).expect("parse back");
            assert_eq!(back, case, "changed by being stored: {json}");
        }
    }

    /// **An opinion without a model must not be constructible from stored
    /// data either.** The type prevents it in Rust; this checks the JSON door
    /// is shut too, since that is where an older or hand-edited row comes in.
    #[test]
    fn stored_json_cannot_produce_an_unattributed_opinion() {
        let missing_model = r#"{"given":{"provider":"Ollama","notes":"fine","truncated":false}}"#;
        assert!(
            serde_json::from_str::<Outcome>(missing_model).is_err(),
            "an opinion with no model must be refused, not defaulted to empty"
        );
    }

    /// A change with nothing in it produces no prompt worth sending — and the
    /// caller has its own reason for that, so this just proves the text is empty
    /// rather than a header with nothing under it.
    #[test]
    fn no_changes_produce_nothing_to_send() {
        let (text, truncated) = diff_text(&[]);
        assert!(text.is_empty(), "got: {text}");
        assert!(!truncated);
    }
}
