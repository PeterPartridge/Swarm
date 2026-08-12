//! Validating that a model can actually work inside the platform.
//!
//! Not "does it answer like Claude" — two models given the same item will phrase
//! things differently and both be right, and judging equivalence would need a
//! third call to referee, which is circular and costs money on every install.
//!
//! Instead each probe checks something the platform **depends on**: does the
//! answer parse against the schema, are the architecture kinds ones the app can
//! file, is a forbidden technology absent from what the model says it will use,
//! does it decline a hopeless brief instead of inventing work. Those are
//! deterministic, cheap, and they are precisely the behaviours whose absence
//! breaks the app.

use crate::ai::client::{Generated, GeneratedStrategy};
use crate::db::developer_rules;
use crate::db::solution_strategy::ARCHITECTURE_KINDS;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub probe: String,
    pub passed: bool,
    /// What was checked, in words a person can act on.
    pub detail: String,
    /// Whether the model **answered at all**.
    ///
    /// **A failed probe and an unanswered one are different findings**, and
    /// conflating them made this app say things it had not seen. Every probe
    /// here judges a behaviour — invented an architecture kind, proposed a
    /// forbidden technology, invented work from an empty brief — and every one
    /// of those claims needs an answer to have been read. When the call never
    /// reached the model, there is no answer, and the only honest thing to
    /// report is that the model could not be asked.
    pub answered: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub model: String,
    pub passed: bool,
    pub probes: Vec<ProbeResult>,
    /// What to do about the failures, if any.
    pub suggested_fixes: Vec<String>,
}

impl ValidationReport {
    /// All-or-nothing: one failed probe blocks the model. A partial pass would
    /// be more forgiving, but the platform routes work automatically, so a model
    /// that is wrong at one job would silently be handed that job.
    pub fn finish(model: &str, probes: Vec<ProbeResult>) -> Self {
        let passed = probes.iter().all(|p| p.passed);
        // Only a probe that was actually answered can say anything about how
        // the model behaves. The rest describe a model that could not be
        // reached, and their names are not evidence of anything.
        let mut suggested_fixes: Vec<String> = probes
            .iter()
            .filter(|p| !p.passed && p.answered)
            .map(|p| suggest(&p.probe))
            .collect();
        if let Some(why) = unreachable(&probes) {
            // First, because it is the cause: any behavioural finding beside it
            // is about a different probe that did get through.
            suggested_fixes.insert(0, why);
        }
        ValidationReport {
            model: model.to_string(),
            passed,
            probes,
            suggested_fixes,
        }
    }

    /// The probes that failed — used by tests and available to any caller that
    /// wants the failures without re-filtering.
    #[cfg(test)]
    pub fn failures(&self) -> Vec<&ProbeResult> {
        self.probes.iter().filter(|p| !p.passed).collect()
    }
}

/// The one honest thing to say when probes went unanswered.
///
/// Quotes the error rather than summarising it, because the error is the only
/// evidence there is — and a model that never ran cannot have "invented" or
/// "proposed" anything.
fn unreachable(probes: &[ProbeResult]) -> Option<String> {
    let silent: Vec<&ProbeResult> = probes.iter().filter(|p| !p.answered).collect();
    let first = silent.first()?;
    let all = silent.len() == probes.len();
    Some(format!(
        "{} of the {} checks got no answer from the model at all, so nothing here is a \
         judgement about how it behaves — it could not be asked. {}The first failure was: {}",
        silent.len(),
        probes.len(),
        if all {
            "Every check failed the same way, which points at the model not being reachable \
             rather than at the model itself: check that it is installed, that its command \
             runs on its own, and that any key or sign-in it needs is in place. "
        } else {
            ""
        },
        first.detail,
    ))
}

fn suggest(probe: &str) -> String {
    match probe {
        "workItemInterpretation" => "The model could not return work items in the required shape. \
             Try a larger model, or one advertised as supporting JSON / structured output."
            .into(),
        "solutionStrategy" => "The model could not produce a solution strategy in the required \
             shape. Architecture work is the most demanding task here — a larger model is \
             usually the fix."
            .into(),
        "architectureKinds" => format!(
            "The model invented architecture kinds. The platform can only file these: {}. \
             The capability pack states them; a model that ignores it will keep doing so.",
            ARCHITECTURE_KINDS.join(", ")
        ),
        "respectsDisallowed" => "The model proposed a technology the developer rules forbid. \
             It cannot be trusted with design work for this Product."
            .into(),
        "declinesVagueWork" => "The model invented work from a brief with nothing in it, rather \
             than declining. It will produce plausible-looking output for under-specified \
             items, which is the failure this platform exists to prevent."
            .into(),
        _ => "Re-install to try again, or choose a different model.".into(),
    }
}

/// Probe 1 — can it return work items at all?
pub fn check_work_items(result: &Result<Generated, String>) -> ProbeResult {
    match result {
        Ok(Generated::Items(items)) if !items.is_empty() => ProbeResult {
            probe: "workItemInterpretation".into(),
            passed: true,
            detail: format!("returned {} work items in the required shape", items.len()),
            answered: true,
        },
        Ok(Generated::Items(_)) => ProbeResult {
            probe: "workItemInterpretation".into(),
            passed: false,
            detail: "parsed, but contained no usable items".into(),
            answered: true,
        },
        // Declining a well-specified probe is a failure of this probe: the
        // brief given is deliberately complete.
        Ok(Generated::Blocked { reason, .. }) => ProbeResult {
            probe: "workItemInterpretation".into(),
            passed: false,
            detail: format!("declined a fully specified brief: {reason}"),
            answered: true,
        },
        Err(e) => ProbeResult {
            probe: "workItemInterpretation".into(),
            passed: false,
            detail: format!("no usable answer: {e}"),
            answered: false,
        },
    }
}

/// Probes 2–4 — strategy, architecture vocabulary, and rule obedience.
pub fn check_strategy(
    result: &Result<GeneratedStrategy, String>,
    disallowed: &str,
) -> Vec<ProbeResult> {
    let draft = match result {
        Ok(GeneratedStrategy::Strategy(draft)) => draft,
        // Declining is an answer — a wrong one for a brief this complete, but
        // the model did speak, so the verdict is about its judgement.
        Ok(GeneratedStrategy::Blocked { reason, .. }) => {
            return failed_triplet(&format!("declined a fully specified brief: {reason}"), true)
        }
        Err(e) => return failed_triplet(&format!("no usable answer: {e}"), false),
    };

    let mut probes = vec![ProbeResult {
        probe: "solutionStrategy".into(),
        passed: !draft.options.is_empty(),
        detail: if draft.options.is_empty() {
            "produced a strategy with no architecture options".into()
        } else {
            format!("produced a strategy with {} options", draft.options.len())
        },
        answered: true,
    }];

    // The app files options by kind; an invented kind cannot be filed.
    let invented: Vec<String> = draft
        .options
        .iter()
        .map(|o| o.kind.trim().to_string())
        .filter(|k| !ARCHITECTURE_KINDS.contains(&k.as_str()))
        .collect();
    probes.push(ProbeResult {
        probe: "architectureKinds".into(),
        passed: invented.is_empty(),
        detail: if invented.is_empty() {
            "every option used a kind the platform accepts".into()
        } else {
            format!("invented kinds: {}", invented.join(", "))
        },
        answered: true,
    });

    // Checked against what it says it will USE — never its prose. A model that
    // writes "no Java here" is obeying, and flagging that taught us the
    // difference the hard way.
    let violations: Vec<String> = draft
        .technologies
        .iter()
        .flat_map(|t| developer_rules::violations(disallowed, t))
        .collect();
    probes.push(ProbeResult {
        probe: "respectsDisallowed".into(),
        passed: violations.is_empty(),
        detail: if violations.is_empty() {
            format!("declared {:?}, none forbidden", draft.technologies)
        } else {
            format!("proposed forbidden technology: {}", violations.join(", "))
        },
        answered: true,
    });
    probes
}

/// The three strategy probes, all failed the same way.
///
/// `answered` is passed in rather than guessed from the text: a model that
/// declined has spoken and can be judged, and one that never replied has not.
fn failed_triplet(detail: &str, answered: bool) -> Vec<ProbeResult> {
    ["solutionStrategy", "architectureKinds", "respectsDisallowed"]
        .iter()
        .map(|probe| ProbeResult {
            probe: (*probe).to_string(),
            passed: false,
            detail: detail.to_string(),
            answered,
        })
        .collect()
}

/// Probe 5 — the one that matters most. Given a brief with nothing in it, does
/// the model decline, or does it invent plausible work?
pub fn check_declines_vague(result: &Result<Generated, String>) -> ProbeResult {
    match result {
        Ok(Generated::Blocked { what_is_needed, .. }) => ProbeResult {
            probe: "declinesVagueWork".into(),
            passed: true,
            detail: if what_is_needed.trim().is_empty() {
                "declined, though without asking anything specific".into()
            } else {
                format!("declined and asked: {what_is_needed}")
            },
            answered: true,
        },
        Ok(Generated::Items(items)) => ProbeResult {
            probe: "declinesVagueWork".into(),
            passed: false,
            detail: format!("invented {} items from a brief with nothing in it", items.len()),
            answered: true,
        },
        // An error is not a decline. The model has to *use* the escape hatch,
        // not merely fail to answer.
        Err(e) => ProbeResult {
            probe: "declinesVagueWork".into(),
            passed: false,
            detail: format!("no usable answer: {e}"),
            answered: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::client::{ArchitectureOption, StoryDraft, StrategyDraft};

    fn item(title: &str) -> StoryDraft {
        StoryDraft {
            title: title.into(),
            description: "d".into(),
        }
    }

    fn option(kind: &str) -> ArchitectureOption {
        ArchitectureOption {
            name: "An option".into(),
            kind: kind.into(),
            rationale: "r".into(),
            tradeoffs: "t".into(),
        }
    }

    fn draft(kinds: &[&str], technologies: &[&str]) -> GeneratedStrategy {
        GeneratedStrategy::Strategy(StrategyDraft {
            strategy: "Build it.".into(),
            options: kinds.iter().map(|k| option(k)).collect(),
            tech_stack: "prose".into(),
            technologies: technologies.iter().map(|t| t.to_string()).collect(),
        })
    }

    #[test]
    fn a_model_that_returns_items_passes_the_first_probe() {
        let probe = check_work_items(&Ok(Generated::Items(vec![item("A"), item("B")])));
        assert!(probe.passed);
        assert!(probe.detail.contains("2 work items"));
    }

    /// The probe brief is deliberately complete, so declining it is wrong.
    #[test]
    fn declining_a_complete_brief_fails_the_first_probe() {
        let probe = check_work_items(&Ok(Generated::Blocked {
            reason: "too vague".into(),
            what_is_needed: "?".into(),
        }));
        assert!(!probe.passed);
        assert!(probe.detail.contains("declined a fully specified brief"));
    }

    #[test]
    fn valid_architecture_kinds_pass_and_invented_ones_fail() {
        let good = check_strategy(&Ok(draft(&["api", "backgroundWorker"], &["Rust"])), "Java");
        assert!(good.iter().all(|p| p.passed), "{good:?}");

        let bad = check_strategy(&Ok(draft(&["microservice"], &["Rust"])), "Java");
        let kinds = bad.iter().find(|p| p.probe == "architectureKinds").expect("probe");
        assert!(!kinds.passed);
        assert!(kinds.detail.contains("microservice"));
    }

    #[test]
    fn proposing_forbidden_technology_fails_the_rules_probe() {
        let probes = check_strategy(&Ok(draft(&["api"], &["Java", "Rust"])), "Java, PHP");
        let rules = probes.iter().find(|p| p.probe == "respectsDisallowed").expect("probe");
        assert!(!rules.passed);
        assert!(rules.detail.contains("java"));
    }

    /// The check reads the declared list, so obedient prose cannot fail it.
    #[test]
    fn a_model_that_merely_mentions_a_forbidden_name_in_prose_still_passes() {
        let mut d = draft(&["api"], &["Rust", "TypeScript"]);
        if let GeneratedStrategy::Strategy(ref mut s) = d {
            s.tech_stack = "Rust and TypeScript. No Java or PHP anywhere.".into();
        }
        let probes = check_strategy(&Ok(d), "Java, PHP");
        let rules = probes.iter().find(|p| p.probe == "respectsDisallowed").expect("probe");
        assert!(rules.passed, "prose must not be read as intent: {rules:?}");
    }

    #[test]
    fn declining_a_hopeless_brief_passes_the_escape_hatch_probe() {
        let probe = check_declines_vague(&Ok(Generated::Blocked {
            reason: "no context".into(),
            what_is_needed: "What product?".into(),
        }));
        assert!(probe.passed);
        assert!(probe.detail.contains("What product?"));
    }

    #[test]
    fn inventing_work_from_nothing_fails_the_escape_hatch_probe() {
        let probe = check_declines_vague(&Ok(Generated::Items(vec![item("Make it better")])));
        assert!(!probe.passed);
        assert!(probe.detail.contains("invented 1 items"));
    }

    /// Failing to answer is not the same as choosing to decline.
    #[test]
    fn an_error_does_not_count_as_declining() {
        let failed: Result<Generated, String> = Err("connection refused".into());
        let probe = check_declines_vague(&failed);
        assert!(!probe.passed);
    }

    #[test]
    fn one_failed_probe_blocks_the_model_and_suggests_a_fix() {
        let report = ValidationReport::finish(
            "ornith:9b",
            vec![
                ProbeResult { probe: "workItemInterpretation".into(), passed: true, detail: "ok".into(), answered: true },
                ProbeResult { probe: "architectureKinds".into(), passed: false, detail: "invented kinds".into(), answered: true },
            ],
        );
        assert!(!report.passed, "all-or-nothing: one failure blocks the model");
        assert_eq!(report.failures().len(), 1);
        assert_eq!(report.suggested_fixes.len(), 1);
        assert!(report.suggested_fixes[0].contains("can only file"));
    }

    /// **The bug this field exists for.** Every probe failed because the model
    /// could not be reached — and the report said it had invented architecture
    /// kinds and proposed a forbidden technology, neither of which anybody had
    /// seen it do. A verdict about behaviour needs an answer to have been read.
    #[test]
    fn a_model_that_never_answered_is_not_accused_of_anything() {
        let silent = |probe: &str| ProbeResult {
            probe: probe.into(),
            passed: false,
            detail: "no usable answer: Claude Code exited with an error".into(),
            answered: false,
        };
        let report = ValidationReport::finish(
            "claude-fable-5",
            vec![
                silent("workItemInterpretation"),
                silent("solutionStrategy"),
                silent("architectureKinds"),
                silent("respectsDisallowed"),
                silent("declinesVagueWork"),
            ],
        );

        assert!(!report.passed);
        // One finding, about the model not being reachable — not five verdicts
        // about work it never did.
        assert_eq!(report.suggested_fixes.len(), 1, "{:?}", report.suggested_fixes);
        let said = &report.suggested_fixes[0];
        assert!(said.contains("no answer"), "{said}");
        assert!(said.contains("Claude Code exited with an error"), "{said}");
        for accusation in ["invented", "proposed", "cannot be trusted"] {
            assert!(
                !said.contains(accusation),
                "nothing was observed, so nothing may be alleged: {said}"
            );
        }
    }

    /// A model that answered badly and a call that never landed can happen in
    /// the same run, and each deserves its own words.
    #[test]
    fn a_real_finding_survives_beside_an_unanswered_probe() {
        let report = ValidationReport::finish(
            "half-there",
            vec![
                ProbeResult {
                    probe: "architectureKinds".into(),
                    passed: false,
                    detail: "invented kinds: lambda".into(),
                    answered: true,
                },
                ProbeResult {
                    probe: "declinesVagueWork".into(),
                    passed: false,
                    detail: "no usable answer: timed out".into(),
                    answered: false,
                },
            ],
        );

        assert_eq!(report.suggested_fixes.len(), 2);
        // The unreachable one first: it is the cause, and the other finding is
        // about a probe that did get through.
        assert!(report.suggested_fixes[0].contains("no answer"));
        assert!(report.suggested_fixes[1].contains("can only file"));
        // With only some probes silent, the "check it is installed" advice
        // would be wrong — the model plainly ran for the other one.
        assert!(!report.suggested_fixes[0].contains("installed"));
    }

    /// Declining is an answer. A model that used the escape hatch on a brief
    /// that did not warrant it has shown its judgement, and is judged.
    #[test]
    fn declining_counts_as_having_answered() {
        let blocked: Result<GeneratedStrategy, String> = Ok(GeneratedStrategy::Blocked {
            reason: "not enough detail".into(),
            what_is_needed: "a brief".into(),
        });
        let probes = check_strategy(&blocked, "Java");

        assert!(probes.iter().all(|p| !p.passed));
        assert!(
            probes.iter().all(|p| p.answered),
            "it spoke, so it can be judged: {probes:?}"
        );
    }

    #[test]
    fn a_clean_run_passes_with_no_fixes_to_suggest() {
        let report = ValidationReport::finish(
            "claude-haiku",
            vec![ProbeResult { probe: "workItemInterpretation".into(), passed: true, detail: "ok".into(), answered: true }],
        );
        assert!(report.passed);
        assert!(report.suggested_fixes.is_empty());
    }
}
