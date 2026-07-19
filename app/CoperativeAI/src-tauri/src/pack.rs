//! The Model Capability Pack — the platform's rules, turned into instructions a
//! model can work from.
//!
//! There is no magic translation here, and it is worth being plain about that:
//! a pack is the framework's own rules assembled into a **token-efficient system
//! prompt plus the schemas the platform parses**. What makes it work for a
//! different model is not clever conversion, it is that the rules are stated
//! once, compactly, in the same place every call reads from — and that the
//! validation probes then check whether the model actually complies.
//!
//! Packs are emitted as files (see `emit.rs`) so they can be read, diffed and
//! edited outside the app, rather than living only as rows.

use crate::db::developer_rules::DeveloperRules;
use crate::db::solution_strategy::ARCHITECTURE_KINDS;
use crate::emit::EmitFile;

/// What the pack was built from, so a pack can be rebuilt identically.
pub struct PackInputs<'a> {
    pub model: &'a str,
    pub provider: &'a str,
    pub product_name: &'a str,
    pub product_answers: &'a str,
    pub product_strategy: &'a str,
    pub rules: &'a DeveloperRules,
}

/// The system instructions every call for this model begins from.
///
/// Deliberately terse. This text is prepended to work, so every wasted line is
/// paid for on every call — the framework's aim is fewer tokens, and a system
/// prompt is the one place where verbosity compounds.
pub fn system_instructions(inputs: &PackInputs<'_>) -> String {
    let mut s = String::new();
    s.push_str(
        "You are a build agent inside CoperativeAI, a Product/Develop/Test workspace.\n\
         You plan and design software against a written specification. You do not \
         invent requirements.\n\n\
         Rules that override your defaults:\n\
         1. Answer only in the JSON schema you are given. No prose outside it.\n\
         2. If the request is too vague or contradictory to do well, do NOT guess. \
         Use the `blocked` field to decline and ask the single most useful question. \
         Declining is a better outcome than inventing work.\n\
         3. Never propose a technology the developer rules forbid. When asked for \
         technologies, list only what you will USE, never what you are avoiding.\n\
         4. Be brief. Tokens cost the team money and a shorter correct answer is \
         better than a longer one.\n\n",
    );
    s.push_str(&format!("Product: {}\n", inputs.product_name));
    if !inputs.product_answers.trim().is_empty() && inputs.product_answers.trim() != "{}" {
        s.push_str(&format!("Product brief (JSON): {}\n", inputs.product_answers));
    }
    if !inputs.product_strategy.trim().is_empty() && inputs.product_strategy.trim() != "{}" {
        s.push_str(&format!("Product strategy (JSON): {}\n", inputs.product_strategy));
    }
    s
}

/// The developer rules, as constraints.
pub fn developer_rules_doc(rules: &DeveloperRules) -> String {
    let mut s = String::from("# Developer rules\n\nThese are constraints, not preferences.\n\n");
    for (label, value) in [
        ("Coding standards", &rules.coding_standards),
        ("Architecture principles", &rules.architecture_principles),
        ("Maintainability", &rules.maintainability),
        ("Preferred frameworks", &rules.preferred_frameworks),
        ("Allowed technologies", &rules.allowed_tech),
        ("Constraints on AI", &rules.ai_constraints),
    ] {
        if !value.trim().is_empty() {
            s.push_str(&format!("- **{label}:** {value}\n"));
        }
    }
    if !rules.disallowed_tech.trim().is_empty() {
        s.push_str(&format!(
            "- **MUST NOT use, under any circumstances:** {}\n",
            rules.disallowed_tech
        ));
    }
    if s.lines().count() <= 4 {
        s.push_str("\n_No developer rules have been set for this Product yet._\n");
    }
    s
}

/// The architecture vocabulary the platform will accept. A model that invents
/// its own kinds produces options the app cannot file, which is exactly what
/// validation catches.
pub fn architecture_templates() -> String {
    let kinds: Vec<serde_json::Value> = ARCHITECTURE_KINDS
        .iter()
        .map(|k| serde_json::json!({ "kind": k }))
        .collect();
    let doc = serde_json::json!({
        "form": "architecture-templates",
        "note": "Every architecture option must use one of these kinds verbatim. \
                 Use `other` rather than inventing a new kind.",
        "kinds": kinds
    });
    format!("{}\n", serde_json::to_string_pretty(&doc).expect("serialises"))
}

/// How the platform decides what an AI action may cost, stated so the model
/// understands why it is sometimes asked to be brief.
pub fn cost_logic_doc() -> String {
    String::from(
        "# Cost and handover\n\n\
         Every call is metered against the Product's AI budget.\n\n\
         - Under the warn threshold, work proceeds normally.\n\
         - At the handover threshold the platform moves to the next provider in \
           the chain, typically a free local model. Output quality drops; brevity \
           matters more, not less.\n\
         - Past the hard stop, only a provider that costs nothing may run.\n\n\
         What this means for you: prefer the shortest answer that is still \
         correct and complete. Padding is charged to a real budget.\n",
    )
}

/// How to read a work item.
pub fn work_item_logic_doc() -> String {
    String::from(
        "# Interpreting work items\n\n\
         An item has a title, an optional description, a type (epic, feature, \
         userStory, task, bug, test) and may belong to a Deliverable.\n\n\
         - The title states the outcome, not the implementation.\n\
         - A thin description is not permission to invent scope. If what is asked \
           cannot be determined, decline through `blocked` and ask.\n\
         - Answers already given about an item arrive as clarifications. Treat \
           them as settled and do not ask again.\n",
    )
}

/// What the pack was built for and from. Kept out of the system prompt — the
/// model does not need it and every line there is paid for on every call — but
/// a person opening the folder should not have to guess which model a pack
/// belongs to or whether it predates the current rules.
pub fn pack_info(inputs: &PackInputs<'_>) -> String {
    let info = serde_json::json!({
        "form": "capability-pack",
        "model": inputs.model,
        "provider": inputs.provider,
        "product": inputs.product_name,
        "note": "Generated by CoperativeAI from the Product's rules and strategy. \
                 Regenerated on every install — edits here are overwritten, and a \
                 pack that no longer matches the Product's rules is a stale pack.",
    });
    format!("{}\n", serde_json::to_string_pretty(&info).expect("serialises"))
}

/// Builds the whole pack as files, relative to the Product's scaffold root.
pub fn build(inputs: &PackInputs<'_>) -> Vec<EmitFile> {
    let dir = format!("packs/{}", crate::emit::safe_stem(inputs.model));
    vec![
        EmitFile {
            rel_path: format!("{dir}/pack-info.json"),
            contents: pack_info(inputs),
        },
        EmitFile {
            rel_path: format!("{dir}/system-instructions.md"),
            contents: system_instructions(inputs),
        },
        EmitFile {
            rel_path: format!("{dir}/developer-rules.md"),
            contents: developer_rules_doc(inputs.rules),
        },
        EmitFile {
            rel_path: format!("{dir}/architecture-templates.json"),
            contents: architecture_templates(),
        },
        EmitFile {
            rel_path: format!("{dir}/cost-logic.md"),
            contents: cost_logic_doc(),
        },
        EmitFile {
            rel_path: format!("{dir}/work-item-logic.md"),
            contents: work_item_logic_doc(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> DeveloperRules {
        DeveloperRules {
            disallowed_tech: "Java, PHP".into(),
            allowed_tech: "Rust, TypeScript".into(),
            coding_standards: "DRY".into(),
            ..Default::default()
        }
    }

    fn inputs<'a>(rules: &'a DeveloperRules) -> PackInputs<'a> {
        PackInputs {
            model: "ornith:9b",
            provider: "Ollama",
            product_name: "Shop App",
            product_answers: "{\"purpose\":\"sell coffee\"}",
            product_strategy: "{}",
            rules,
        }
    }

    #[test]
    fn the_pack_carries_every_capability_the_requirement_named() {
        let r = rules();
        let files = build(&inputs(&r));
        let paths: Vec<&str> = files.iter().map(|f| f.rel_path.as_str()).collect();
        for expected in [
            "packs/ornith_9b/pack-info.json",
            "packs/ornith_9b/system-instructions.md",
            "packs/ornith_9b/developer-rules.md",
            "packs/ornith_9b/architecture-templates.json",
            "packs/ornith_9b/cost-logic.md",
            "packs/ornith_9b/work-item-logic.md",
        ] {
            assert!(paths.contains(&expected), "missing {expected} in {paths:?}");
        }
    }

    #[test]
    fn system_instructions_state_the_rules_that_override_a_models_defaults() {
        let r = rules();
        let text = system_instructions(&inputs(&r));
        assert!(text.contains("do NOT guess"));
        assert!(text.contains("blocked"));
        assert!(text.contains("list only what you will USE"));
        assert!(text.contains("Shop App"));
    }

    /// The system prompt is paid for on every call, so its size is a feature.
    #[test]
    fn the_system_prompt_stays_small() {
        let r = rules();
        let text = system_instructions(&inputs(&r));
        assert!(
            text.len() < 1_400,
            "system instructions grew to {} chars — every call pays for this",
            text.len()
        );
    }

    #[test]
    fn disallowed_technology_is_stated_as_a_prohibition() {
        let doc = developer_rules_doc(&rules());
        assert!(doc.contains("MUST NOT use"));
        assert!(doc.contains("Java, PHP"));
    }

    #[test]
    fn a_product_with_no_rules_says_so_rather_than_emitting_an_empty_list() {
        let doc = developer_rules_doc(&DeveloperRules::default());
        assert!(doc.contains("No developer rules have been set"));
        assert!(!doc.contains("MUST NOT use"));
    }

    #[test]
    fn the_architecture_pack_lists_exactly_the_kinds_the_app_accepts() {
        let json: serde_json::Value =
            serde_json::from_str(&architecture_templates()).expect("valid JSON");
        let kinds: Vec<&str> = json["kinds"]
            .as_array()
            .expect("array")
            .iter()
            .map(|k| k["kind"].as_str().expect("kind"))
            .collect();
        assert_eq!(kinds, ARCHITECTURE_KINDS);
    }

    #[test]
    fn the_pack_records_what_it_was_built_for() {
        let r = rules();
        let info: serde_json::Value =
            serde_json::from_str(&pack_info(&inputs(&r))).expect("valid JSON");
        assert_eq!(info["model"], "ornith:9b");
        assert_eq!(info["provider"], "Ollama");
        assert_eq!(info["product"], "Shop App");
        // and warns that hand edits will not survive
        assert!(info["note"].as_str().expect("note").contains("overwritten"));
    }

    #[test]
    fn packs_are_namespaced_by_model_so_two_models_do_not_collide() {
        let r = rules();
        let a = build(&inputs(&r));
        let mut other = inputs(&r);
        other.model = "llama3.2:1b";
        let b = build(&other);
        assert_ne!(a[0].rel_path, b[0].rel_path);
        // Dots and colons are both filesystem-unfriendly, so both become '_'.
        assert!(
            b[0].rel_path.starts_with("packs/llama3_2_1b/"),
            "got {}",
            b[0].rel_path
        );
    }
}
