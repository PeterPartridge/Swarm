import { useState } from "react";
import {
  draftArchitecture,
  openDiagram,
  saveArchitectureDoc,
  saveDiagram,
  type ArchitectureDocKind,
  type DiagramEdge,
  type DiagramFormat,
  type DiagramNode,
} from "../lib/backend";
import { DiagramPreview } from "./DiagramPreview";

const KINDS = ["service", "database", "queue", "store", "external"];

/** Building an architecture diagram, in whichever notation was chosen.
 *
 *  **Infrastructure and Architecture used to be two sections doing the same
 *  job.** They are one now, because a diagram of the system is a diagram of the
 *  system — draw.io versus Mermaid is a rendering choice made after deciding
 *  what is in it, not a different feature. The boxes are worked out once, and
 *  the format is applied at the end.
 *
 *  What differs is only what happens on save. Mermaid is text: it goes into the
 *  document and renders inline. draw.io is a file as well: it goes into the
 *  document *and* is written as `.drawio` beside the Product's other framework
 *  files, so the real editor can open and rearrange it. */
export default function DiagramBuilder({
  productId,
  kind,
  format,
  solutionId,
  onSaved,
  onError,
}: {
  productId: number;
  kind: ArchitectureDocKind;
  format: DiagramFormat;
  /** "" for the whole Product. */
  solutionId: string;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("Architecture");
  const [nodes, setNodes] = useState<DiagramNode[]>([]);
  const [edges, setEdges] = useState<DiagramEdge[]>([]);
  const [nodeLabel, setNodeLabel] = useState("");
  const [nodeKind, setNodeKind] = useState("service");
  const [edgeFrom, setEdgeFrom] = useState("");
  const [edgeTo, setEdgeTo] = useState("");
  const [edgeLabel, setEdgeLabel] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const drawable = format === "drawio" || format === "mermaid";

  function addNode() {
    const label = nodeLabel.trim();
    if (!label) return;
    // The id comes from the label so the arrow pickers read as names rather
    // than as numbers nobody can match up.
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (nodes.some((n) => n.id === id)) {
      onError(`There is already a ${label} on this diagram.`);
      return;
    }
    setNodes([...nodes, { id, label, kind: nodeKind }]);
    setNodeLabel("");
  }

  function addEdge() {
    if (!edgeFrom || !edgeTo || edgeFrom === edgeTo) return;
    setEdges([...edges, { from: edgeFrom, to: edgeTo, label: edgeLabel.trim() }]);
    setEdgeLabel("");
  }

  /** Drafts from the Solutions the app already knows about.
   *
   *  Replaces the builder's contents rather than merging: a merge would
   *  duplicate every box on a second press, and a draft is a starting point to
   *  correct. */
  async function draft() {
    try {
      const drafted = await draftArchitecture(productId, format);
      if (drafted.nodes.length === 0) {
        onError("This Product has no Solutions yet — there is nothing to draw from.");
        return;
      }
      setNodes(drafted.nodes);
      setEdges(drafted.edges);
      setNotice(
        `Drafted ${drafted.nodes.length} box${drafted.nodes.length === 1 ? "" : "es"} from this Product's Solutions. Add whatever the app cannot know — the queue, the load balancer, anything third-party.`,
      );
    } catch (e) {
      onError(String(e));
    }
  }

  const [lastFile, setLastFile] = useState<string | null>(null);

  async function save() {
    // Rendered from the boxes on screen, which are what somebody has edited
    // since the draft. The renderings mirror `drawio.rs`, and a test asserts
    // the two languages produce the same string for the same input.
    const content =
      format === "drawio" ? buildDrawio(name, nodes, edges) : buildMermaid(nodes, edges);
    try {
      await saveArchitectureDoc({
        productId,
        solutionId: solutionId === "" ? null : Number(solutionId),
        kind,
        name,
        content,
        format,
      });
      let where = "";
      if (format === "drawio") {
        // A file as well, so the real editor can open and rearrange it.
        const path = await saveDiagram(productId, name, nodes, edges);
        where = ` and written to ${path}`;
        setLastFile(path);
      }
      setNotice(`Saved${where}.`);
      onSaved();
    } catch (e) {
      onError(String(e));
    }
  }

  if (!drawable) {
    return (
      <p className="hint">
        Boxes and arrows are drawn for Mermaid and draw.io. For {format}, write
        the document below.
      </p>
    );
  }

  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <div className="diagram-builder">
      <button type="button" onClick={draft}>
        Draft from this Product's Solutions
      </button>
      <p className="hint">
        Draws the Solutions and the links already recorded between them, in{" "}
        {format === "drawio" ? "draw.io" : "Mermaid"}. It cannot know about the
        queue, the load balancer or anything third-party — those you add below.
      </p>
      {notice && <p role="status">{notice}</p>}

      <label>
        Diagram name
        <input
          aria-label="Diagram name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div className="diagram-add">
        <label>
          Add a box
          <input
            aria-label="Box label"
            value={nodeLabel}
            placeholder="Shop API"
            onChange={(e) => setNodeLabel(e.target.value)}
          />
        </label>
        <label>
          Kind
          <select
            aria-label="Box kind"
            value={nodeKind}
            onChange={(e) => setNodeKind(e.target.value)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={addNode} disabled={nodeLabel.trim() === ""}>
          Add box
        </button>
      </div>

      {nodes.length > 1 && (
        <div className="diagram-add">
          <label>
            Connect
            <select
              aria-label="Arrow from"
              value={edgeFrom}
              onChange={(e) => setEdgeFrom(e.target.value)}
            >
              <option value="">from…</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            to
            <select
              aria-label="Arrow to"
              value={edgeTo}
              onChange={(e) => setEdgeTo(e.target.value)}
            >
              <option value="">to…</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Label
            <input
              aria-label="Arrow label"
              value={edgeLabel}
              placeholder="reads"
              onChange={(e) => setEdgeLabel(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={addEdge}
            disabled={!edgeFrom || !edgeTo || edgeFrom === edgeTo}
          >
            Add arrow
          </button>
        </div>
      )}

      {nodes.length > 0 && (
        <ul className="diagram-parts">
          {nodes.map((n) => (
            <li key={n.id}>
              <span className={`diagram-kind ${n.kind}`}>{n.kind}</span> {n.label}
              <button
                type="button"
                aria-label={`Remove ${n.label}`}
                onClick={() => {
                  setNodes(nodes.filter((x) => x.id !== n.id));
                  // An arrow to a box that no longer exists renders as a
                  // dangling edge in either notation.
                  setEdges(edges.filter((e) => e.from !== n.id && e.to !== n.id));
                }}
              >
                ×
              </button>
            </li>
          ))}
          {edges.map((e, i) => (
            <li key={`e${i}`} className="diagram-edge">
              {labelOf(e.from)} → {labelOf(e.to)}
              {e.label && ` (${e.label})`}
              <button
                type="button"
                aria-label={`Remove arrow ${labelOf(e.from)} to ${labelOf(e.to)}`}
                onClick={() => setEdges(edges.filter((_, n) => n !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The same preview whichever notation is chosen — the boxes are the
          same, so a picture of them is too. */}
      <section className="diagram-preview-section" aria-label="Preview">
        <h4>Preview</h4>
        <DiagramPreview nodes={nodes} edges={edges} />
      </section>

      <button type="button" onClick={save} disabled={nodes.length === 0}>
        {format === "drawio" ? "Save and write the .drawio file" : "Save"}
      </button>

      {lastFile && (
        <button type="button" onClick={() => void openDiagram(lastFile).catch((e) => onError(String(e)))}>
          Open in draw.io
        </button>
      )}
    </div>
  );
}

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
