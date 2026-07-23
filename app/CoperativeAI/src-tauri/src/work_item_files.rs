//! A work item as two files an agent can work from: `.md` and `.json`.
//!
//! **Both, not one, and for different readers.** The Markdown is what a person
//! or a model reads for the intent — why the work exists, what has to change,
//! what must be proved. The JSON is what a tool parses: the same facts with no
//! prose around them, so a script can ask "which endpoints does this add" and
//! get a list rather than a paragraph to guess at.
//!
//! Writing one and generating the other on demand was the alternative, and it
//! is worse: a Markdown-to-JSON parser is a guess about prose, and JSON
//! rendered to Markdown reads like a form. They are produced from the same
//! structure here instead, which is the only way they cannot disagree.
//!
//! The structure is exactly what the team recorded — no invention. Where a
//! field is empty this says so rather than filling it in, because a brief that
//! quietly supplies the missing half is how an agent builds the wrong thing
//! confidently.

use serde::Serialize;

/// One screen, endpoint or table the work touches.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeEntry {
    pub kind: String,
    pub action: String,
    pub name: String,
    pub detail: String,
    pub mockup: Option<String>,
}

/// What one Solution is asked to do.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolutionPart {
    pub name: String,
    pub solution_type: String,
    pub changes_required: String,
    pub unit_tests: String,
    pub branch_name: String,
    pub clone_from: String,
    pub changes: Vec<ChangeEntry>,
    /// The AI-generated schemas, when they have been generated.
    pub api_schema: String,
    pub page_schema: String,
    pub files_to_change: String,
}

/// Everything known about one work item.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemDoc {
    pub id: i64,
    pub title: String,
    pub item_type: String,
    pub status: String,
    pub description: String,
    pub risk: String,
    pub product: String,
    /// Free text: how this should be built, over and above the per-Solution
    /// notes — conventions, gotchas, the thing everyone knows and nobody wrote
    /// down.
    pub development_details: String,
    /// Questions Product has already answered, so an agent does not ask again.
    pub clarifications: Vec<String>,
    pub solutions: Vec<SolutionPart>,
    /// Screens Product asked for that reach no Solution. Carried into the files
    /// rather than dropped: work nobody assigned is the work that goes missing.
    pub unassigned: Vec<ChangeEntry>,
}

/// The JSON half — the same facts, machine-readable.
pub fn to_json(doc: &WorkItemDoc) -> String {
    serde_json::to_string_pretty(doc).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
}

/// The Markdown half — the same facts, for reading.
pub fn to_markdown(doc: &WorkItemDoc) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {} ({})\n\n", doc.title, doc.item_type));
    out.push_str(&format!("Product: {}\nStatus: {}\n", doc.product, doc.status));
    if !doc.risk.trim().is_empty() {
        out.push_str(&format!("Risk: {}\n", doc.risk.trim()));
    }
    out.push('\n');

    if doc.description.trim().is_empty() {
        // Said out loud. A brief that quietly supplies the missing half is how
        // an agent builds the wrong thing confidently.
        out.push_str("## What it is\n\n_Not written._\n\n");
    } else {
        out.push_str(&format!("## What it is\n\n{}\n\n", doc.description.trim()));
    }

    if !doc.development_details.trim().is_empty() {
        out.push_str(&format!(
            "## How to build it\n\n{}\n\n",
            doc.development_details.trim()
        ));
    }

    if !doc.clarifications.is_empty() {
        out.push_str("## Already answered\n\nDo not ask these again:\n\n");
        for answer in &doc.clarifications {
            out.push_str(&format!("- {answer}\n"));
        }
        out.push('\n');
    }

    for part in &doc.solutions {
        out.push_str(&format!("## {} ({})\n\n", part.name, part.solution_type));
        out.push_str(&format!(
            "Changes required: {}\n",
            blank_as(&part.changes_required, "_not written yet_")
        ));
        out.push_str(&format!(
            "Must be proved by: {}\n",
            blank_as(&part.unit_tests, "_no tests named_")
        ));
        if !part.branch_name.trim().is_empty() {
            out.push_str(&format!(
                "Branch: `{}`, cut from `{}`\n",
                part.branch_name.trim(),
                blank_as(&part.clone_from, "the default branch")
            ));
        }
        out.push('\n');

        for (kind, heading) in [
            ("screen", "Screens"),
            ("api", "APIs"),
            ("table", "Database tables"),
        ] {
            let of_kind: Vec<&ChangeEntry> =
                part.changes.iter().filter(|c| c.kind == kind).collect();
            if of_kind.is_empty() {
                continue;
            }
            // The same sentence the generation prompt uses, for the same
            // reason: without it a model reads the names as examples.
            out.push_str(&format!("### {heading} — this is the complete list\n\n"));
            for change in of_kind {
                let verb = if change.action == "add" { "new" } else { "change" };
                out.push_str(&format!("- **[{verb}]** {}", change.name));
                if !change.detail.trim().is_empty() {
                    out.push_str(&format!(" — {}", change.detail.trim()));
                }
                if let Some(mockup) = &change.mockup {
                    out.push_str(&format!(" (shown in {mockup})"));
                }
                out.push('\n');
            }
            out.push('\n');
        }

        for (label, content) in [
            ("API schema", &part.api_schema),
            ("Page schema", &part.page_schema),
            ("Files expected to change", &part.files_to_change),
        ] {
            if !content.trim().is_empty() {
                out.push_str(&format!("### {label}\n\n```\n{}\n```\n\n", content.trim()));
            }
        }
    }

    if !doc.unassigned.is_empty() {
        // Work nobody assigned is the work that goes missing, so it is named
        // rather than left out of the file.
        out.push_str("## Not assigned to any Solution\n\nAsked for, but nobody has said where it is built:\n\n");
        for change in &doc.unassigned {
            out.push_str(&format!("- {} ({})\n", change.name, change.kind));
        }
        out.push('\n');
    }

    out
}

fn blank_as<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value.trim()
    }
}

/// Where the pair goes, relative to the Product's folder.
pub fn paths(work_item_id: i64, title: &str) -> (String, String) {
    let stem = crate::emit::safe_stem(title);
    (
        format!(".CoperativeAI/work-items/{work_item_id}-{stem}.md"),
        format!(".CoperativeAI/work-items/{work_item_id}-{stem}.json"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc() -> WorkItemDoc {
        WorkItemDoc {
            id: 9,
            title: "Add checkout".into(),
            item_type: "feature".into(),
            status: "planned".into(),
            description: "Take card payments".into(),
            risk: "Payment provider not chosen".into(),
            product: "Shop App".into(),
            development_details: "Reuse the existing money type — integer pence.".into(),
            clarifications: vec!["Card payments only, no wallets.".into()],
            solutions: vec![SolutionPart {
                name: "Shop API".into(),
                solution_type: "api".into(),
                changes_required: "Add POST /checkout".into(),
                unit_tests: "It charges once".into(),
                branch_name: "feature/9-add-checkout".into(),
                clone_from: "main".into(),
                changes: vec![
                    ChangeEntry {
                        kind: "api".into(),
                        action: "add".into(),
                        name: "POST /checkout".into(),
                        detail: "takes the payment".into(),
                        mockup: None,
                    },
                    ChangeEntry {
                        kind: "table".into(),
                        action: "add".into(),
                        name: "orders".into(),
                        detail: String::new(),
                        mockup: None,
                    },
                ],
                api_schema: "{\"paths\":{}}".into(),
                page_schema: String::new(),
                files_to_change: "src/checkout.rs".into(),
            }],
            unassigned: vec![ChangeEntry {
                kind: "screen".into(),
                action: "add".into(),
                name: "Basket".into(),
                detail: String::new(),
                mockup: None,
            }],
        }
    }

    /// The Markdown is for reading: intent, then what each Solution must do.
    #[test]
    fn the_markdown_carries_everything_recorded() {
        let md = to_markdown(&doc());
        assert!(md.starts_with("# Add checkout (feature)"));
        assert!(md.contains("Take card payments"));
        assert!(md.contains("Reuse the existing money type"));
        assert!(md.contains("Card payments only"), "answers travel");
        assert!(md.contains("Shop API (api)"));
        assert!(md.contains("`feature/9-add-checkout`"));
        assert!(md.contains("**[new]** POST /checkout — takes the payment"));
        assert!(md.contains("APIs — this is the complete list"));
        assert!(md.contains("Database tables — this is the complete list"));
        assert!(md.contains("{\"paths\":{}}"));
    }

    /// Work nobody assigned is the work that goes missing.
    #[test]
    fn a_screen_nobody_assigned_is_named_rather_than_left_out() {
        let md = to_markdown(&doc());
        assert!(md.contains("Not assigned to any Solution"));
        assert!(md.contains("Basket (screen)"));
    }

    /// A brief that quietly supplies the missing half is how an agent builds
    /// the wrong thing confidently.
    #[test]
    fn what_is_missing_is_said_rather_than_filled_in() {
        let mut d = doc();
        d.description = String::new();
        d.solutions[0].changes_required = String::new();
        d.solutions[0].unit_tests = "   ".into();
        let md = to_markdown(&d);

        assert!(md.contains("_Not written._"));
        assert!(md.contains("_not written yet_"));
        assert!(md.contains("_no tests named_"));
    }

    /// Empty sections must not appear at all — "Screens — this is the complete
    /// list" followed by nothing reads as an instruction to build no screens.
    #[test]
    fn a_kind_with_nothing_in_it_gets_no_heading() {
        let md = to_markdown(&doc());
        assert!(!md.contains("Screens — this is the complete list"));
    }

    /// The JSON is for parsing: the same facts, no prose to guess at.
    #[test]
    fn the_json_is_the_same_facts_machine_readable() {
        let json = to_json(&doc());
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");

        assert_eq!(parsed["title"], "Add checkout");
        assert_eq!(parsed["developmentDetails"], "Reuse the existing money type — integer pence.");
        assert_eq!(parsed["solutions"][0]["name"], "Shop API");
        assert_eq!(parsed["solutions"][0]["branchName"], "feature/9-add-checkout");
        // a list to read, not a paragraph to guess at
        assert_eq!(parsed["solutions"][0]["changes"][0]["name"], "POST /checkout");
        assert_eq!(parsed["solutions"][0]["changes"][0]["kind"], "api");
        assert_eq!(parsed["unassigned"][0]["name"], "Basket");
    }

    /// Both are produced from one structure, which is the only way they cannot
    /// disagree — so everything named in one is present in the other.
    #[test]
    fn the_two_files_say_the_same_thing() {
        let d = doc();
        let md = to_markdown(&d);
        let json = to_json(&d);
        for fact in ["Add checkout", "Shop API", "POST /checkout", "orders", "Basket"] {
            assert!(md.contains(fact), "the Markdown is missing {fact}");
            assert!(json.contains(fact), "the JSON is missing {fact}");
        }
    }

    #[test]
    fn the_pair_is_named_after_the_item() {
        let (md, json) = paths(9, "Add checkout!");
        assert_eq!(md, ".CoperativeAI/work-items/9-add-checkout.md");
        assert_eq!(json, ".CoperativeAI/work-items/9-add-checkout.json");
    }
}
