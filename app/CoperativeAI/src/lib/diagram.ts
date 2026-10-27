//! Turning boxes-and-arrows into diagram text — Mermaid and draw.io — in one
//! place.
//!
//! These emitters used to live inside the components that happened to call them
//! first: `buildMermaid`/`buildDrawio` in DiagramBuilder, `jsonGraphToMermaid`
//! in DiagramView. They are not view code — they are pure translations from a
//! graph to a notation, reused across those views and pinned by tests — so they
//! belong beside the diagram types they operate on, not inside one screen.
//!
//! `buildMermaid` and `buildDrawio` mirror `drawio::to_mermaid` and
//! `drawio::build` on the Rust side, and a test holds the two languages
//! together. `jsonGraphToMermaid` is the render-time counterpart: it reads a
//! stored `{nodes, edges}` graph rather than the builder's in-memory objects.

import type { DiagramEdge, DiagramNode } from "./backend";

/** Mermaid from the boxes in hand. Mirrors `drawio::to_mermaid`, and the test
 *  pins the two together. */
export function buildMermaid(nodes: DiagramNode[], edges: DiagramEdge[]): string {
  const id = (raw: string) => {
    const cleaned = raw.replace(/[^A-Za-z0-9]/g, "_");
    return /^\d/.test(cleaned) ? `n${cleaned}` : cleaned;
  };
  const shape = (n: DiagramNode) => {
    const label = n.label.replace(/"/g, "'");
    switch (n.kind) {
      case "database":
        return `    ${id(n.id)}[("${label}")]`;
      case "queue":
        return `    ${id(n.id)}[/"${label}"/]`;
      case "store":
        return `    ${id(n.id)}[["${label}"]]`;
      case "external":
        return `    ${id(n.id)}(["${label}"])`;
      default:
        return `    ${id(n.id)}["${label}"]`;
    }
  };
  const lines = ["flowchart TD", ...nodes.map(shape)];
  for (const e of edges) {
    lines.push(
      e.label.trim() === ""
        ? `    ${id(e.from)} --> ${id(e.to)}`
        : `    ${id(e.from)} -->|${e.label.replace(/\|/g, "/")}| ${id(e.to)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Minimal mxGraph from the boxes in hand, for a diagram edited after drafting.
 *  Mirrors `drawio::build`. */
export function buildDrawio(
  title: string,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
): string {
  const escape = (t: string) =>
    t
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  const style = (kind: string) =>
    kind === "database"
      ? "shape=cylinder3;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;"
      : kind === "queue"
        ? "shape=parallelogram;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;"
        : kind === "external"
          ? "rounded=1;whiteSpace=wrap;html=1;dashed=1;fillColor=#f5f5f5;strokeColor=#999999;"
          : kind === "store"
            ? "shape=note;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;"
            : "rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;";

  const cells = [
    ...nodes.map((n, i) => {
      const x = 40 + (i % 4) * 200;
      const y = 40 + Math.floor(i / 4) * 140;
      return `        <mxCell id="${escape(n.id)}" value="${escape(n.label)}" style="${style(n.kind)}" vertex="1" parent="1">\n          <mxGeometry x="${x}" y="${y}" width="160" height="60" as="geometry" />\n        </mxCell>`;
    }),
    ...edges.map(
      (e, i) =>
        `        <mxCell id="edge-${i}" value="${escape(e.label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="${escape(e.from)}" target="${escape(e.to)}">\n          <mxGeometry relative="1" as="geometry" />\n        </mxCell>`,
    ),
  ].join("\n");

  return `<mxfile host="CoperativeAI">\n  <diagram name="${escape(title)}">\n    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageWidth="1100" pageHeight="850">\n      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n${cells}\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n`;
}

/** `{nodes, edges}` → a Mermaid flowchart. The two describe the same thing, so
 *  this is a translation rather than an interpretation.
 *
 *  Ids are sanitised because Mermaid's node ids cannot contain the punctuation
 *  a JSON id happily can, and labels are quoted so a bracket in a label does
 *  not close the node early. */
export function jsonGraphToMermaid(content: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const graph = parsed as {
    nodes?: { id?: string; label?: string }[];
    edges?: { from?: string; to?: string; label?: string }[];
  };
  if (!Array.isArray(graph.nodes)) return null;

  const safeId = (id: string) => `n_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;
  const escapeLabel = (text: string) => text.replace(/"/g, "'");

  const lines = ["flowchart TD"];
  for (const node of graph.nodes) {
    if (!node?.id) continue;
    lines.push(`  ${safeId(node.id)}["${escapeLabel(node.label ?? node.id)}"]`);
  }
  for (const edge of graph.edges ?? []) {
    if (!edge?.from || !edge?.to) continue;
    const arrow = edge.label ? `-- "${escapeLabel(edge.label)}" -->` : "-->";
    lines.push(`  ${safeId(edge.from)} ${arrow} ${safeId(edge.to)}`);
  }
  return lines.join("\n");
}
