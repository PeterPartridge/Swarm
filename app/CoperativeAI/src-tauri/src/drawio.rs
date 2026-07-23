//! Infrastructure diagrams as real `.drawio` files.
//!
//! **The app writes the file; draw.io edits it.** Embedding the real editor
//! means loading app.diagrams.net over the network on every open — which breaks
//! offline and sends someone's infrastructure to a third party — and building a
//! substitute would be a worse draw.io that could not open anything anyone else
//! made. So this owns creating, storing and versioning the document, and hands
//! the editing to whatever draw.io the developer already has: the desktop app,
//! or the VS Code extension.
//!
//! That makes the file the contract. `.drawio` is mxGraph XML, so what is
//! written here opens in every draw.io there is, and what they save comes back
//! as a diff in the Solution's repository like any other file.

use std::path::{Path, PathBuf};

/// One node in a generated diagram.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub label: String,
    /// "service" | "database" | "queue" | "external" | "store"
    #[serde(default)]
    pub kind: String,
}

/// One arrow.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub label: String,
}

/// XML's five reserved characters. A service called `Orders & Billing` writes a
/// file draw.io refuses to open unless this happens, and the failure looks like
/// a corrupt diagram rather than a naming problem.
fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// The draw.io shape for each kind, so an infrastructure diagram reads as one
/// at a glance rather than as a page of identical rectangles.
fn style_for(kind: &str) -> &'static str {
    match kind {
        "database" => "shape=cylinder3;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;",
        "queue" => "shape=parallelogram;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;",
        "external" => "rounded=1;whiteSpace=wrap;html=1;dashed=1;fillColor=#f5f5f5;strokeColor=#999999;",
        "store" => "shape=note;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;",
        _ => "rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;",
    }
}

/// The grid every box is placed on.
///
/// **The preview in the app draws from these same numbers.** A preview that
/// laid things out differently from the file would be a picture of a diagram
/// nobody is about to get, which is worse than no preview — so the constants
/// are stated once here, mirrored in `InfrastructureDiagrams.tsx`, and both
/// sides have a test asserting the same coordinates for the same input.
pub const GRID_PER_ROW: usize = 4;
pub const GRID_X0: usize = 40;
pub const GRID_Y0: usize = 40;
pub const GRID_DX: usize = 200;
pub const GRID_DY: usize = 140;
pub const BOX_W: usize = 160;
pub const BOX_H: usize = 60;

/// Where the nth box goes.
pub fn position(index: usize) -> (usize, usize) {
    (
        GRID_X0 + (index % GRID_PER_ROW) * GRID_DX,
        GRID_Y0 + (index / GRID_PER_ROW) * GRID_DY,
    )
}

/// Builds a `.drawio` document.
///
/// Laid out in a grid rather than left at the origin: draw.io opens a file with
/// everything stacked at 0,0 as a single unreadable pile, and the first thing
/// anyone would do is drag them apart. Four to a row is a starting point to
/// rearrange, not a claim about the architecture.
pub fn build(title: &str, nodes: &[Node], edges: &[Edge]) -> String {
    let mut cells = String::new();

    for (index, node) in nodes.iter().enumerate() {
        let (x, y) = position(index);
        cells.push_str(&format!(
            "        <mxCell id=\"{}\" value=\"{}\" style=\"{}\" vertex=\"1\" parent=\"1\">\n\
             \x20         <mxGeometry x=\"{x}\" y=\"{y}\" width=\"{BOX_W}\" height=\"{BOX_H}\" as=\"geometry\" />\n\
             \x20       </mxCell>\n",
            escape(&node.id),
            escape(&node.label),
            style_for(&node.kind),
        ));
    }

    for (index, edge) in edges.iter().enumerate() {
        cells.push_str(&format!(
            "        <mxCell id=\"edge-{index}\" value=\"{}\" style=\"edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;\" edge=\"1\" parent=\"1\" source=\"{}\" target=\"{}\">\n\
             \x20         <mxGeometry relative=\"1\" as=\"geometry\" />\n\
             \x20       </mxCell>\n",
            escape(&edge.label),
            escape(&edge.from),
            escape(&edge.to),
        ));
    }

    format!(
        "<mxfile host=\"CoperativeAI\">\n\
         \x20 <diagram name=\"{}\">\n\
         \x20   <mxGraphModel dx=\"800\" dy=\"600\" grid=\"1\" gridSize=\"10\" page=\"1\" pageWidth=\"1100\" pageHeight=\"850\">\n\
         \x20     <root>\n\
         \x20       <mxCell id=\"0\" />\n\
         \x20       <mxCell id=\"1\" parent=\"0\" />\n\
         {cells}\
         \x20     </root>\n\
         \x20   </mxGraphModel>\n\
         \x20 </diagram>\n\
         </mxfile>\n",
        escape(title)
    )
}

/// The shape a Solution takes on a diagram.
///
/// A database Solution is a store; everything else is a service. Deliberately
/// not clever about it: guessing that a website is "external" because it faces
/// users would be an opinion about somebody's architecture rather than a fact
/// about their Solutions, and the boxes are theirs to re-kind afterwards.
pub fn kind_for_solution(solution_type: &str) -> &'static str {
    match solution_type {
        "database" => "database",
        _ => "service",
    }
}

/// Builds a diagram from Solutions and the links between them.
///
/// This is the point of having recorded any of it: the Solutions, their types
/// and the links are already in the app, so the first draft of the diagram
/// should not be typed in again by hand.
///
/// **A first draft, not the answer.** It draws what the app knows — which is
/// the Solutions, not the load balancer, the queue or the third party they all
/// depend on. Those get added afterwards, which is why the builder stays.
pub fn from_solutions(solutions: &[(i64, String, String)], links: &[(i64, i64, String)]) -> (Vec<Node>, Vec<Edge>) {
    let nodes: Vec<Node> = solutions
        .iter()
        .map(|(id, name, solution_type)| Node {
            // Keyed by id rather than by name: two Products can hold Solutions
            // with the same name, and an edge that matched on name would join
            // the wrong pair.
            id: format!("solution-{id}"),
            label: name.clone(),
            kind: kind_for_solution(solution_type).to_string(),
        })
        .collect();

    let known: std::collections::HashSet<i64> = solutions.iter().map(|(id, _, _)| *id).collect();
    let edges: Vec<Edge> = links
        .iter()
        // A link to a Solution in another Product would draw an arrow to a box
        // that is not on this diagram, which draw.io opens as a dangling edge.
        .filter(|(from, to, _)| known.contains(from) && known.contains(to))
        .map(|(from, to, label)| Edge {
            from: format!("solution-{from}"),
            to: format!("solution-{to}"),
            label: label.clone(),
        })
        .collect();

    (nodes, edges)
}

/// The same nodes and edges as a Mermaid flowchart.
///
/// **This is what makes merging the two sections real rather than cosmetic.**
/// A draft from the Solutions is a set of boxes and arrows; which notation it
/// is written in is a rendering choice made afterwards, not a different
/// feature. One source, two outputs — so the draw.io and Mermaid halves cannot
/// disagree about what the architecture is.
pub fn to_mermaid(nodes: &[Node], edges: &[Edge]) -> String {
    let mut out = String::from("flowchart TD\n");
    for node in nodes {
        // Mermaid ids are bare words: a dash or a space ends the id and the
        // rest becomes a parse error nobody can read.
        let id = mermaid_id(&node.id);
        let label = node.label.replace('"', "'");
        out.push_str(&match node.kind.as_str() {
            "database" => format!("    {id}[(\"{label}\")]\n"),
            "queue" => format!("    {id}[/\"{label}\"/]\n"),
            "store" => format!("    {id}[[\"{label}\"]]\n"),
            "external" => format!("    {id}([\"{label}\"])\n"),
            _ => format!("    {id}[\"{label}\"]\n"),
        });
    }
    for edge in edges {
        let from = mermaid_id(&edge.from);
        let to = mermaid_id(&edge.to);
        if edge.label.trim().is_empty() {
            out.push_str(&format!("    {from} --> {to}\n"));
        } else {
            // A pipe inside a label closes it early, taking the rest of the
            // line with it.
            let label = edge.label.replace('|', "/");
            out.push_str(&format!("    {from} -->|{label}| {to}\n"));
        }
    }
    out
}

fn mermaid_id(id: &str) -> String {
    let cleaned: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    // An id starting with a digit is read as a number.
    if cleaned.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        format!("n{cleaned}")
    } else {
        cleaned
    }
}

/// Whether text is a draw.io document.
///
/// Checked before a file is offered for opening, because a `.drawio` extension
/// on something else is a confusing failure inside draw.io rather than here.
pub fn looks_like_drawio(text: &str) -> bool {
    let head: String = text.chars().take(400).collect();
    head.contains("<mxfile") || head.contains("<mxGraphModel")
}

/// Where a Product's diagrams live.
///
/// Beside the framework files rather than in the app's data folder, so they are
/// in the repository — a diagram that is not versioned with the code it
/// describes goes stale without anyone seeing it happen.
pub fn diagram_dir(product_dir: &str) -> PathBuf {
    Path::new(product_dir).join(".CoperativeAI").join("diagrams")
}

/// Writes a diagram, returning the path.
pub fn save(product_dir: &str, name: &str, xml: &str) -> Result<String, String> {
    if !looks_like_drawio(xml) {
        return Err("that is not a draw.io document — it has no <mxfile> in it".into());
    }
    let dir = diagram_dir(product_dir);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let file = dir.join(format!("{}.drawio", file_stem(name)));
    std::fs::write(&file, xml).map_err(|e| format!("could not write {}: {e}", file.display()))?;
    Ok(file.to_string_lossy().to_string())
}

/// A file name from a diagram's title. Path separators are stripped rather than
/// escaped: a diagram called `infra/prod` must not write outside the folder.
fn file_stem(name: &str) -> String {
    let mut out = String::new();
    let mut last_dash = true;
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "diagram".into()
    } else {
        out
    }
}

/// Lists the diagrams already written for a Product.
pub fn list(product_dir: &str) -> Vec<String> {
    let dir = diagram_dir(product_dir);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut found: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("drawio"))
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    found.sort();
    found
}

/// Opens a diagram in whatever draw.io the machine has.
///
/// Handed to the OS rather than to a named executable: draw.io Desktop, the VS
/// Code extension and a browser all register for `.drawio`, and guessing which
/// one somebody uses would be wrong for most people.
pub fn open(path: &str) -> Result<(), String> {
    let file = Path::new(path);
    if !file.is_file() {
        return Err(format!("there is no diagram at {path}"));
    }
    let result = if cfg!(windows) {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", path])
            .spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(path).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(path).spawn()
    };
    result
        .map(|_| ())
        .map_err(|e| format!("could not open {path} — is draw.io installed? ({e})"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, label: &str, kind: &str) -> Node {
        Node {
            id: id.into(),
            label: label.into(),
            kind: kind.into(),
        }
    }

    /// The file is the contract: what this writes has to open in every draw.io
    /// there is, so the mxGraph skeleton is pinned.
    #[test]
    fn the_document_is_mxgraph_that_drawio_will_open() {
        let xml = build(
            "Infrastructure",
            &[node("api", "Shop API", "service"), node("db", "Orders", "database")],
            &[Edge {
                from: "api".into(),
                to: "db".into(),
                label: "reads".into(),
            }],
        );

        assert!(xml.starts_with("<mxfile"));
        assert!(xml.contains("<mxGraphModel"));
        assert!(xml.contains("<mxCell id=\"0\" />"));
        assert!(xml.contains("value=\"Shop API\""));
        assert!(xml.contains("source=\"api\" target=\"db\""));
        assert!(looks_like_drawio(&xml));
    }

    /// A database that looks like a service is a diagram nobody can read at a
    /// glance, which is most of what a diagram is for.
    #[test]
    fn each_kind_gets_its_own_shape() {
        let xml = build(
            "Infra",
            &[
                node("a", "Service", "service"),
                node("b", "Store", "database"),
                node("c", "Queue", "queue"),
            ],
            &[],
        );
        assert!(xml.contains("shape=cylinder3"), "the database is a cylinder");
        assert!(xml.contains("shape=parallelogram"), "the queue is a parallelogram");
    }

    /// A service called `Orders & Billing` writes a file draw.io refuses to
    /// open, and the failure looks like a corrupt diagram rather than a name.
    #[test]
    fn reserved_characters_in_a_name_do_not_break_the_file() {
        let xml = build("A & B", &[node("x", "Orders & <Billing>", "service")], &[]);
        assert!(xml.contains("Orders &amp; &lt;Billing&gt;"), "got: {xml}");
        assert!(!xml.contains("<Billing>"), "the raw angle brackets must not survive");
    }

    /// draw.io opens everything-at-0,0 as one unreadable pile, and the first
    /// thing anyone would do is drag them apart.
    #[test]
    fn nodes_are_laid_out_rather_than_stacked_at_the_origin() {
        let nodes: Vec<Node> = (0..6)
            .map(|n| node(&format!("n{n}"), &format!("Node {n}"), "service"))
            .collect();
        let xml = build("Infra", &nodes, &[]);
        assert!(xml.contains("x=\"40\" y=\"40\""), "first on the first row");
        assert!(xml.contains("x=\"640\" y=\"40\""), "fourth still on it");
        assert!(xml.contains("x=\"40\" y=\"180\""), "fifth wraps to the next");
    }

    /// The point of having recorded the Solutions: the first draft of the
    /// diagram is not typed in again by hand.
    #[test]
    fn a_diagram_is_drafted_from_the_solutions_and_their_links() {
        let solutions = vec![
            (3, "Shop API".to_string(), "api".to_string()),
            (5, "Shop Web".to_string(), "website".to_string()),
            (7, "Orders".to_string(), "database".to_string()),
        ];
        let links = vec![
            (5, 3, "calls the API of".to_string()),
            (3, 7, "shares a schema with".to_string()),
        ];
        let (nodes, edges) = from_solutions(&solutions, &links);

        assert_eq!(nodes.len(), 3);
        assert_eq!(nodes[0].label, "Shop API");
        // a database Solution draws as a store; everything else is a service
        assert_eq!(nodes[2].kind, "database");
        assert_eq!(nodes[1].kind, "service");

        assert_eq!(edges.len(), 2);
        assert_eq!(edges[0].from, "solution-5");
        assert_eq!(edges[0].to, "solution-3");
        assert_eq!(edges[0].label, "calls the API of");
    }

    /// Ids, not names: two Products can hold Solutions called the same thing,
    /// and an edge matched on name would join the wrong pair.
    #[test]
    fn boxes_are_keyed_by_id_so_two_solutions_of_one_name_stay_apart() {
        let solutions = vec![
            (3, "API".to_string(), "api".to_string()),
            (9, "API".to_string(), "api".to_string()),
        ];
        let (nodes, _) = from_solutions(&solutions, &[]);
        assert_ne!(nodes[0].id, nodes[1].id);
    }

    /// An arrow to a Solution that is not on this diagram opens in draw.io as a
    /// dangling edge, which looks like a corrupt file rather than a missing box.
    #[test]
    fn a_link_to_something_not_on_the_diagram_is_left_out() {
        let solutions = vec![(3, "Shop API".to_string(), "api".to_string())];
        let links = vec![(3, 99, "calls the API of".to_string())];
        let (_, edges) = from_solutions(&solutions, &links);
        assert!(edges.is_empty(), "the other end is in another Product");
    }

    /// The preview in the app draws from these same numbers. A preview laid out
    /// differently from the file would be a picture of a diagram nobody is
    /// about to get — the mirrored test in InfrastructureDiagrams.test.tsx
    /// asserts the identical coordinates.
    #[test]
    fn the_grid_positions_are_the_ones_the_preview_mirrors() {
        assert_eq!(position(0), (40, 40));
        assert_eq!(position(3), (640, 40));
        assert_eq!(position(4), (40, 180));
        assert_eq!(position(5), (240, 180));
        assert_eq!((BOX_W, BOX_H), (160, 60));
    }

    /// One draft, two notations. This is what makes merging the Infrastructure
    /// and Architecture sections real rather than cosmetic: which notation a
    /// diagram is written in is a rendering choice made afterwards, not a
    /// different feature.
    #[test]
    fn the_same_draft_renders_as_mermaid() {
        let nodes = vec![
            Node { id: "solution-3".into(), label: "Shop API".into(), kind: "service".into() },
            Node { id: "solution-7".into(), label: "Orders".into(), kind: "database".into() },
        ];
        let edges = vec![Edge {
            from: "solution-3".into(),
            to: "solution-7".into(),
            label: "shares a schema with".into(),
        }];
        let mermaid = to_mermaid(&nodes, &edges);

        assert!(mermaid.starts_with("flowchart TD"));
        assert!(mermaid.contains("solution_3[\"Shop API\"]"));
        // a database keeps its shape in either notation
        assert!(mermaid.contains("solution_7[(\"Orders\")]"));
        assert!(mermaid.contains("solution_3 -->|shares a schema with| solution_7"));
        // and the structural check agrees it is Mermaid
        assert!(crate::diagram::check("mermaid", &mermaid).is_ok());
    }

    /// A dash ends a Mermaid id and the rest becomes a parse error nobody can
    /// read — and our own ids are `solution-3`.
    #[test]
    fn ids_are_made_safe_for_mermaid() {
        assert_eq!(mermaid_id("solution-3"), "solution_3");
        assert_eq!(mermaid_id("a b c"), "a_b_c");
        // a leading digit reads as a number
        assert_eq!(mermaid_id("3rd"), "n3rd");
    }

    /// A pipe inside an arrow label closes it early and takes the rest of the
    /// line with it.
    #[test]
    fn punctuation_in_a_label_does_not_break_the_flowchart() {
        let nodes = vec![
            Node { id: "a".into(), label: "A \"quoted\" box".into(), kind: "service".into() },
            Node { id: "b".into(), label: "B".into(), kind: "service".into() },
        ];
        let edges = vec![Edge { from: "a".into(), to: "b".into(), label: "reads|writes".into() }];
        let mermaid = to_mermaid(&nodes, &edges);

        assert!(!mermaid.contains("\"quoted\""), "double quotes are swapped out");
        assert!(mermaid.contains("reads/writes"), "the pipe is swapped out");
        assert!(crate::diagram::check("mermaid", &mermaid).is_ok());
    }

    /// draw.io is an architecture format like the others, so the same validator
    /// judges it — one place decides, and the file writer cannot disagree.
    #[test]
    fn drawio_is_checked_as_an_architecture_format() {
        let xml = build("Infra", &[Node { id: "a".into(), label: "A".into(), kind: "service".into() }], &[]);
        assert!(crate::diagram::check("drawio", &xml).is_ok());
        assert!(crate::diagram::check("drawio", "flowchart TD\n  a --> b").is_err());
        assert!(crate::diagram::FORMATS.contains(&"drawio"));
    }

    #[test]
    fn something_that_is_not_a_diagram_is_refused() {
        assert!(!looks_like_drawio("# just some markdown"));
        assert!(!looks_like_drawio("<svg></svg>"));
        assert!(looks_like_drawio("<mxfile host=\"x\"></mxfile>"));
    }

    /// A diagram called `infra/prod` must not write outside the folder.
    #[test]
    fn a_title_cannot_escape_the_diagram_folder() {
        assert_eq!(file_stem("infra/prod"), "infra-prod");
        assert_eq!(file_stem("../../etc/passwd"), "etc-passwd");
        assert_eq!(file_stem("Production Infrastructure"), "production-infrastructure");
        assert_eq!(file_stem("!!!"), "diagram");
    }

    #[test]
    fn a_saved_diagram_lands_in_the_product_folder_and_is_listed() {
        let dir = std::env::temp_dir().join(format!(
            "coperativeai-drawio-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch");

        let xml = build("Infrastructure", &[node("a", "API", "service")], &[]);
        let path = save(dir.to_str().unwrap(), "Production Infrastructure", &xml)
            .expect("save");

        assert!(path.ends_with("production-infrastructure.drawio"), "got: {path}");
        assert!(std::path::Path::new(&path).is_file());
        // in the repository, not the app's data folder — a diagram that is not
        // versioned with the code goes stale unseen
        assert!(path.contains(".CoperativeAI"));
        assert_eq!(list(dir.to_str().unwrap()).len(), 1);

        assert!(save(dir.to_str().unwrap(), "x", "not a diagram").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
