//! Structural checks for the diagram formats the platform stores.
//!
//! These are **not parsers**. They catch the failure that actually happens — a
//! model returning prose, an apology, or the wrong notation where a diagram was
//! asked for — without claiming to validate a language only its own renderer
//! can validate. A check that pretends to more certainty than it has is worse
//! than one that is honest about its job.
//!
//! Shared by design assets and architecture documents so there is one answer to
//! "is this a diagram", rather than two that drift apart.

/// The formats a stored diagram may be in.
/// `drawio` sits beside the text notations because an infrastructure diagram is
/// an architecture document like any other — the notation is a rendering
/// choice, not a different kind of thing. It is stored here *and* written as a
/// `.drawio` file, so draw.io can open it.
pub const FORMATS: &[&str] = &["mermaid", "plantuml", "jsonGraph", "drawio"];

const MERMAID_STARTERS: &[&str] = &[
    "flowchart",
    "graph",
    "sequenceDiagram",
    "classDiagram",
    "stateDiagram",
    "erDiagram",
    "journey",
    "gantt",
    "C4Context",
    "C4Container",
    "mindmap",
];

/// Checks a diagram against its declared format, returning why it fails.
///
/// `Ok(())` means "this is plausibly the notation you said it was", not "this
/// will render".
pub fn check(format: &str, content: &str) -> Result<(), String> {
    if content.trim().is_empty() {
        return Err("the diagram is empty".into());
    }
    match format {
        "mermaid" => check_mermaid(content),
        "plantuml" => check_plantuml(content),
        "jsonGraph" => check_json_graph(content),
        // The same standard as the others: plausibly the notation it claims to
        // be. `drawio::looks_like_drawio` is the one place that judges it, so
        // the file writer and this check cannot disagree.
        "drawio" => {
            if crate::drawio::looks_like_drawio(content) {
                Ok(())
            } else {
                Err("a draw.io diagram starts with <mxfile> — this does not".into())
            }
        }
        other => Err(format!(
            "unknown diagram format '{other}' — expected one of {FORMATS:?}"
        )),
    }
}

fn first_meaningful_line(content: &str, comment: &str) -> Option<String> {
    content
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with(comment))
        .map(str::to_string)
}

fn check_mermaid(content: &str) -> Result<(), String> {
    let first = first_meaningful_line(content, "%%")
        .ok_or("the diagram has nothing in it but comments")?;
    if MERMAID_STARTERS.iter().any(|s| first.starts_with(s)) {
        return Ok(());
    }
    Err(format!(
        "this does not start like a Mermaid diagram — it needs a diagram type such as \
         'flowchart TD' or 'sequenceDiagram' on the first line, but starts with \"{}\"",
        first.chars().take(40).collect::<String>()
    ))
}

fn check_plantuml(content: &str) -> Result<(), String> {
    let trimmed = content.trim();
    // PlantUML is delimited rather than prefixed, so both ends must be there —
    // a truncated diagram is the common failure and it opens correctly.
    if !trimmed.starts_with("@start") {
        return Err("PlantUML must start with @startuml (or another @start… directive)".into());
    }
    if !trimmed.ends_with("@enduml") && !trimmed.contains("\n@end") {
        return Err(
            "this PlantUML diagram is never closed — it needs an @enduml, and a diagram that \
             stops half way usually means the response was cut short"
                .into(),
        );
    }
    Ok(())
}

/// A graph the app can walk itself: `{"nodes": [...], "edges": [...]}`, with
/// every edge joining nodes that exist. An edge pointing at a missing node is
/// the failure worth catching — it renders as a diagram with a line going
/// nowhere, which reads as a design decision rather than a mistake.
fn check_json_graph(content: &str) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| format!("this graph is not valid JSON: {e}"))?;
    let nodes = value
        .get("nodes")
        .and_then(|n| n.as_array())
        .ok_or("a JSON graph needs a \"nodes\" array")?;
    let ids: Vec<&str> = nodes
        .iter()
        .filter_map(|n| n.get("id").and_then(|i| i.as_str()))
        .collect();
    if ids.len() != nodes.len() {
        return Err("every node in a JSON graph needs a string \"id\"".into());
    }
    let edges = value
        .get("edges")
        .and_then(|e| e.as_array())
        .ok_or("a JSON graph needs an \"edges\" array")?;
    for edge in edges {
        for end in ["from", "to"] {
            let id = edge
                .get(end)
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("every edge needs a string \"{end}\""))?;
            if !ids.contains(&id) {
                return Err(format!(
                    "an edge points at \"{id}\", which is not one of the nodes"
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The failure that actually happens: a model answering in prose.
    #[test]
    fn prose_where_a_diagram_was_asked_for_is_rejected_with_the_reason() {
        let err = check("mermaid", "First the user signs in, then they check out.")
            .expect_err("must reject");
        assert!(err.contains("Mermaid"), "got: {err}");
        assert!(err.contains("First the user"), "the reason should quote what it saw");
    }

    #[test]
    fn mermaid_accepts_its_diagram_types_and_leading_comments() {
        check("mermaid", "flowchart TD\n  A --> B").expect("flowchart");
        check("mermaid", "sequenceDiagram\n  A ->> B: hi").expect("sequence");
        check("mermaid", "C4Context\n  title X").expect("C4 — architecture work uses it");
        check("mermaid", "\n%% generated\n\ngraph LR\n  A --> B").expect("comments first");
        assert!(check("mermaid", "%% only a comment").is_err());
        assert!(check("mermaid", "   ").is_err());
    }

    /// A response cut short opens correctly and never closes, so checking only
    /// the opening would pass exactly the case worth catching.
    #[test]
    fn plantuml_must_be_closed_as_well_as_opened() {
        check("plantuml", "@startuml\nA -> B\n@enduml").expect("complete");
        let err = check("plantuml", "@startuml\nA -> B").expect_err("truncated");
        assert!(err.contains("never closed"), "got: {err}");
        assert!(check("plantuml", "A -> B\n@enduml").is_err(), "no opening");
    }

    /// An edge to a missing node renders as a line going nowhere, which reads
    /// as a decision rather than a mistake.
    #[test]
    fn a_json_graph_edge_must_join_nodes_that_exist() {
        let good = r#"{"nodes":[{"id":"api"},{"id":"web"}],"edges":[{"from":"web","to":"api"}]}"#;
        check("jsonGraph", good).expect("valid graph");

        let dangling = r#"{"nodes":[{"id":"api"}],"edges":[{"from":"api","to":"ghost"}]}"#;
        let err = check("jsonGraph", dangling).expect_err("must reject");
        assert!(err.contains("ghost"), "got: {err}");

        assert!(check("jsonGraph", r#"{"nodes":[{"id":1}],"edges":[]}"#).is_err(), "id must be text");
        assert!(check("jsonGraph", r#"{"nodes":[]}"#).is_err(), "edges required");
        assert!(check("jsonGraph", "{not json").is_err());
    }

    #[test]
    fn an_unknown_format_names_the_ones_that_exist() {
        let err = check("visio", "anything").expect_err("must reject");
        assert!(err.contains("mermaid"), "got: {err}");
    }
}
