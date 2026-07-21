//! Handing a work item to a coding agent.
//!
//! **What this does not do, and why.** It does not spawn Claude Code and it
//! does not report what a run cost. Claude Code is billed against its own
//! subscription or key; this app's ledger meters the API calls *it* makes. A
//! figure presented as "the spend for that run" would be a number the app
//! cannot see. Everything here is therefore about the half the app genuinely
//! owns: assembling the context once, completely, and reviewing what comes
//! back.
//!
//! That half is the point anyway. The expensive failure in agent coding is not
//! the tokens — it is an agent that was told too little, built the wrong thing,
//! and had to be paid for twice. This assembles everything already known about
//! a piece of work so it is said once, in order, rather than dribbled out over
//! a conversation.

use crate::db::developer_rules::DeveloperRules;

/// Everything known about a piece of work, borrowed for assembly.
pub struct HandoverInputs<'a> {
    pub product_name: &'a str,
    pub work_item_title: &'a str,
    pub work_item_type: &'a str,
    pub work_item_description: Option<&'a str>,
    /// Free text from the planner — what could go wrong.
    pub risk: &'a str,
    pub solution_name: Option<&'a str>,
    /// The AI's own build strategy for this item, if one was generated.
    pub strategy: Option<&'a str>,
    /// The chosen architecture option, if the developer picked one.
    pub chosen_option: Option<&'a str>,
    pub rules: &'a DeveloperRules,
    /// Architecture documents for the Solution: (name, format, content).
    pub architecture: &'a [(String, String, String)],
    /// Answers a person already gave to the AI's questions about this item.
    pub clarifications: &'a [String],
    /// What this work must not break: other work that depends on it.
    pub depended_on_by: &'a [String],
    /// The per-Solution plan: what changes, what proves it, which branch, and
    /// the schemas generated from all of that.
    pub solution_plans: &'a [SolutionPlanBrief<'a>],
}

/// One Solution's slice of the work, as it reaches the agent.
pub struct SolutionPlanBrief<'a> {
    pub name: &'a str,
    pub changes_required: &'a str,
    pub unit_tests: &'a str,
    pub branch_name: &'a str,
    pub clone_from: &'a str,
    pub api_schema: &'a str,
    pub page_schema: &'a str,
    pub files_to_change: &'a str,
}

/// Builds the brief handed to the agent.
///
/// Ordered by what an agent needs first: the job, then the constraints, then
/// the context. A brief that opens with three pages of architecture buries the
/// request underneath it.
pub fn brief(inputs: &HandoverInputs<'_>) -> String {
    let mut s = String::new();

    s.push_str(&format!(
        "# {}\n\n_{} in {}_\n\n",
        inputs.work_item_title, inputs.work_item_type, inputs.product_name
    ));
    if let Some(solution) = inputs.solution_name {
        s.push_str(&format!("This work lands in **{solution}**.\n\n"));
    }

    s.push_str("## What is being asked for\n\n");
    match inputs.work_item_description.map(str::trim).filter(|d| !d.is_empty()) {
        Some(description) => s.push_str(&format!("{description}\n\n")),
        // Said plainly rather than left as an empty heading: an agent given a
        // title and nothing else should know that is all there was, and a
        // person reading the brief back should see the gap.
        None => s.push_str(
            "_No description was written for this item — the title above is all there is._\n\n",
        ),
    }

    if !inputs.clarifications.is_empty() {
        s.push_str("## Already answered\n\n");
        s.push_str("Questions the AI raised about this work, and the answers given:\n\n");
        for answer in inputs.clarifications {
            s.push_str(&format!("- {answer}\n"));
        }
        s.push('\n');
    }

    s.push_str(&crate::pack::developer_rules_doc(inputs.rules));
    s.push('\n');

    if let Some(strategy) = inputs.strategy.map(str::trim).filter(|v| !v.is_empty()) {
        s.push_str("## How it was decided this should be built\n\n");
        s.push_str(strategy);
        s.push_str("\n\n");
        if let Some(option) = inputs.chosen_option.map(str::trim).filter(|v| !v.is_empty()) {
            s.push_str(&format!(
                "The developer chose this approach: **{option}**. Build that one; do not \
                 re-open the decision.\n\n"
            ));
        }
    }

    if !inputs.solution_plans.is_empty() {
        s.push_str("## What each Solution needs\n\n");
        for plan in inputs.solution_plans {
            s.push_str(&format!("### {}\n\n", plan.name));
            if !plan.branch_name.trim().is_empty() {
                s.push_str(&format!(
                    "Work on branch `{}`{}.\n\n",
                    plan.branch_name,
                    if plan.clone_from.trim().is_empty() {
                        String::new()
                    } else {
                        format!(", cut from `{}`", plan.clone_from)
                    }
                ));
            }
            if !plan.changes_required.trim().is_empty() {
                s.push_str(&format!("{}\n\n", plan.changes_required.trim()));
            }
            for (heading, body) in [
                ("API schema", plan.api_schema),
                ("Page schema", plan.page_schema),
                ("Files expected to change", plan.files_to_change),
            ] {
                if !body.trim().is_empty() {
                    s.push_str(&format!("**{heading}:**\n\n```\n{}\n```\n\n", body.trim()));
                }
            }
            // Last, and phrased as a requirement: tests written after the fact
            // are tests written to pass.
            if !plan.unit_tests.trim().is_empty() {
                s.push_str(&format!(
                    "**These must be proved by tests:** {}\n\n",
                    plan.unit_tests.trim()
                ));
            }
        }
    }

    if !inputs.architecture.is_empty() {
        s.push_str("## How the system is put together\n\n");
        for (name, format, content) in inputs.architecture {
            s.push_str(&format!("### {name}\n\n```{format}\n{content}\n```\n\n"));
        }
    }

    if !inputs.depended_on_by.is_empty() {
        s.push_str("## Other work is waiting on this\n\n");
        s.push_str("Do not change the shape of what these expect:\n\n");
        for item in inputs.depended_on_by {
            s.push_str(&format!("- {item}\n"));
        }
        s.push('\n');
    }

    if !inputs.risk.trim().is_empty() {
        s.push_str(&format!(
            "## What the planner was worried about\n\n{}\n\n",
            inputs.risk.trim()
        ));
    }

    s.push_str(
        "## When you are done\n\n\
         Leave the change uncommitted. It will be reviewed against the developer rules \
         above before anything is kept.\n\n\
         If this brief is too vague or contradictory to build well, stop and say so \
         rather than guessing. An unanswered question costs less than the wrong feature.\n",
    );
    s
}

/// Where the brief is written, relative to the working copy.
///
/// Inside `.coperativeai/` rather than the repository root: it is this app's
/// output, not the project's, and it should be obvious which is which to
/// whoever opens the folder next.
///
/// `attempt` numbers the file from the second try onward, so preparing again
/// never overwrites what an earlier attempt was told — which is the first
/// thing anyone wants to read when a second attempt goes wrong.
pub fn brief_path(work_item_title: &str, attempt: usize) -> String {
    let stem = crate::emit::safe_stem(work_item_title);
    if attempt <= 1 {
        format!(".coperativeai/briefs/{stem}.md")
    } else {
        format!(".coperativeai/briefs/{stem}-attempt-{attempt}.md")
    }
}

/// The command that runs this brief through Claude Code.
///
/// Shown rather than executed. Spawning it would make the app responsible for
/// a long-running interactive process it cannot supervise, and would still not
/// tell it what the run cost — so the honest arrangement is to prepare the work
/// properly and hand it over in the open.
pub fn suggested_command(brief_rel_path: &str) -> String {
    format!("claude \"Read {brief_rel_path} and implement it.\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> DeveloperRules {
        DeveloperRules {
            disallowed_tech: "jQuery".into(),
            coding_standards: "Small functions".into(),
            ..Default::default()
        }
    }

    fn inputs<'a>(rules: &'a DeveloperRules) -> HandoverInputs<'a> {
        HandoverInputs {
            product_name: "Shop",
            work_item_title: "Add checkout",
            work_item_type: "feature",
            work_item_description: Some("Take payment and email a receipt."),
            risk: "",
            solution_name: Some("Shop API"),
            strategy: None,
            chosen_option: None,
            rules,
            architecture: &[],
            clarifications: &[],
            depended_on_by: &[],
            solution_plans: &[],
        }
    }

    /// The schemas are the point of the planning feature — if they do not reach
    /// the agent, the questions were asked for nothing.
    #[test]
    fn the_per_solution_plan_reaches_the_brief() {
        let r = rules();
        let mut i = inputs(&r);
        let plans = [SolutionPlanBrief {
            name: "Shop API",
            changes_required: "Add POST /checkout",
            unit_tests: "It charges exactly once",
            branch_name: "feature/12-add-checkout",
            clone_from: "main",
            api_schema: "POST /checkout -> 201",
            page_schema: "",
            files_to_change: "src/api/checkout.rs",
        }];
        i.solution_plans = &plans;
        let brief = brief(&i);

        assert!(brief.contains("### Shop API"));
        assert!(brief.contains("branch `feature/12-add-checkout`"));
        assert!(brief.contains("cut from `main`"));
        assert!(brief.contains("POST /checkout -> 201"));
        assert!(brief.contains("src/api/checkout.rs"));
        assert!(brief.contains("must be proved by tests"));
        // an empty schema half is left out rather than printed as a blank fence
        assert!(!brief.contains("**Page schema:**"));
    }

    #[test]
    fn the_brief_leads_with_the_job_and_carries_the_rules() {
        let r = rules();
        let brief = brief(&inputs(&r));

        assert!(brief.starts_with("# Add checkout"), "the job comes first");
        assert!(brief.contains("lands in **Shop API**"));
        assert!(brief.contains("Take payment and email a receipt."));
        assert!(brief.contains("jQuery"), "the forbidden list must travel with the work");
        assert!(brief.contains("reviewed against the developer rules"));
    }

    /// An agent given a title and nothing else should know that is all there
    /// was, and a person reading the brief back should see the gap.
    #[test]
    fn a_missing_description_is_stated_rather_than_left_blank() {
        let r = rules();
        let mut i = inputs(&r);
        i.work_item_description = None;
        let brief = brief(&i);

        assert!(brief.contains("No description was written"), "got: {brief}");
    }

    /// Re-opening a settled decision is how an agent burns a budget.
    #[test]
    fn a_chosen_architecture_is_stated_as_settled() {
        let r = rules();
        let mut i = inputs(&r);
        i.strategy = Some("Split the payment call out.");
        i.chosen_option = Some("Azure Function");
        let brief = brief(&i);

        assert!(brief.contains("Split the payment call out."));
        assert!(brief.contains("do not re-open the decision"));
        assert!(brief.contains("Azure Function"));
    }

    /// Answers already given must travel, or the agent asks again and the
    /// person answers twice.
    #[test]
    fn answers_already_given_travel_with_the_work() {
        let r = rules();
        let mut i = inputs(&r);
        let answers = ["Card payments only, no wallets.".to_string()];
        i.clarifications = &answers;

        assert!(brief(&i).contains("Card payments only"));
    }

    #[test]
    fn work_waiting_on_this_is_named_as_a_constraint() {
        let r = rules();
        let mut i = inputs(&r);
        let waiting = ["Web: call the checkout endpoint".to_string()];
        i.depended_on_by = &waiting;
        let brief = brief(&i);

        assert!(brief.contains("Other work is waiting on this"));
        assert!(brief.contains("Do not change the shape"));
        assert!(brief.contains("call the checkout endpoint"));
    }

    #[test]
    fn architecture_travels_fenced_by_its_own_format() {
        let r = rules();
        let mut i = inputs(&r);
        let docs = [(
            "How it fits".to_string(),
            "mermaid".to_string(),
            "flowchart TD\n  Web --> Api".to_string(),
        )];
        i.architecture = &docs;
        let brief = brief(&i);

        assert!(brief.contains("```mermaid\nflowchart TD"));
    }

    /// The planner's risk is the one thing in the brief nobody else would have
    /// thought to say.
    #[test]
    fn the_planners_risk_is_carried_over_verbatim() {
        let r = rules();
        let mut i = inputs(&r);
        i.risk = "the payments vendor may not sign off in time";
        assert!(brief(&i).contains("the payments vendor may not sign off in time"));
    }

    #[test]
    fn empty_sections_are_left_out_entirely() {
        let r = rules();
        let brief = brief(&inputs(&r));

        assert!(!brief.contains("Already answered"));
        assert!(!brief.contains("Other work is waiting"));
        assert!(!brief.contains("worried about"));
        assert!(!brief.contains("How the system is put together"));
    }

    /// A second attempt must not erase what the first was told — that history
    /// is the first thing anyone reads when attempt two goes wrong.
    #[test]
    fn each_attempt_gets_its_own_brief_file() {
        assert_eq!(brief_path("Add checkout!", 1), ".coperativeai/briefs/add-checkout.md");
        assert_eq!(
            brief_path("Add checkout!", 2),
            ".coperativeai/briefs/add-checkout-attempt-2.md"
        );
        assert_eq!(
            brief_path("Add checkout!", 3),
            ".coperativeai/briefs/add-checkout-attempt-3.md"
        );
        assert!(suggested_command(".coperativeai/briefs/add-checkout.md").starts_with("claude "));
    }
}
