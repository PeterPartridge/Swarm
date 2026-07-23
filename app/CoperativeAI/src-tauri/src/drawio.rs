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
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub label: String,
    /// "service" | "database" | "queue" | "external" | "store"
    #[serde(default)]
    pub kind: String,
}

/// One arrow.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
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

/// Builds a `.drawio` document.
///
/// Laid out in a grid rather than left at the origin: draw.io opens a file with
/// everything stacked at 0,0 as a single unreadable pile, and the first thing
/// anyone would do is drag them apart. Four to a row is a starting point to
/// rearrange, not a claim about the architecture.
pub fn build(title: &str, nodes: &[Node], edges: &[Edge]) -> String {
    let mut cells = String::new();

    for (index, node) in nodes.iter().enumerate() {
        let x = 40 + (index % 4) * 200;
        let y = 40 + (index / 4) * 140;
        cells.push_str(&format!(
            "        <mxCell id=\"{}\" value=\"{}\" style=\"{}\" vertex=\"1\" parent=\"1\">\n\
             \x20         <mxGeometry x=\"{x}\" y=\"{y}\" width=\"160\" height=\"60\" as=\"geometry\" />\n\
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
