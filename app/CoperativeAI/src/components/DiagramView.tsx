import { useEffect, useRef, useState } from "react";
import type { DiagramFormat } from "../lib/backend";

/** Renders a stored diagram, or explains why it cannot.
 *
 *  **Mermaid** is rendered by Mermaid itself. The project already chose Mermaid
 *  as the notation, so drawing it any other way would produce pictures that
 *  disagree with every other Mermaid renderer — worse than not drawing it.
 *
 *  **jsonGraph** is nodes and edges, which maps onto a Mermaid flowchart
 *  exactly, so it is converted and rendered the same way.
 *
 *  **PlantUML cannot be rendered here, and is deliberately not sent anywhere.**
 *  Its renderer is a Java program; the usual browser route is to post the
 *  diagram to plantuml.com. That would send a private architecture diagram to a
 *  third party, silently, to draw a picture — so this shows the source and says
 *  why instead.
 *
 *  Mermaid is loaded on demand rather than imported at the top. It is by far
 *  the largest dependency in this app, and a workspace that only sometimes
 *  shows a diagram should not pay for it on every start. */
export default function DiagramView({
  content,
  format,
  label,
}: {
  content: string;
  format: DiagramFormat;
  label: string;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const idRef = useRef(`diagram-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let cancelled = false;
    if (format === "plantuml") {
      setSvg(null);
      setFailed(null);
      return;
    }
    const source = format === "jsonGraph" ? jsonGraphToMermaid(content) : content;
    if (source === null) {
      setFailed("this graph could not be turned into a diagram");
      return;
    }

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          // The stored diagram is data, and Mermaid's own directives can change
          // how it renders. "strict" keeps a diagram from reconfiguring the app.
          securityLevel: "strict",
          theme: "neutral",
        });
        const { svg: rendered } = await mermaid.render(idRef.current, source);
        if (!cancelled) {
          setSvg(rendered);
          setFailed(null);
        }
      } catch (e) {
        if (!cancelled) {
          setSvg(null);
          // The structural check that let this be stored is not a parser, so a
          // diagram can pass it and still fail to render. Saying so beats a
          // blank space.
          setFailed(String(e instanceof Error ? e.message : e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [content, format]);

  if (format === "plantuml") {
    return (
      <div className="diagram-view">
        <pre className="diagram-source" aria-label={`${label} source`}>{content}</pre>
        <p className="hint">
          PlantUML is not drawn here. Rendering it in a browser means sending the
          diagram to a third-party server, and a private architecture diagram is
          not worth posting elsewhere to get a picture.
        </p>
      </div>
    );
  }

  return (
    <div className="diagram-view">
      {svg && (
        <div
          className="diagram-svg"
          role="img"
          aria-label={label}
          // Mermaid's own output, rendered with securityLevel "strict".
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      {failed && (
        <p role="status" className="diagram-failed">
          This diagram did not render: {failed}
        </p>
      )}
      {(failed || showSource) && (
        <pre className="diagram-source" aria-label={`${label} source`}>{content}</pre>
      )}
      {svg && !failed && (
        <button
          className="diagram-toggle"
          aria-label={`${showSource ? "Hide" : "Show"} source of ${label}`}
          onClick={() => setShowSource((s) => !s)}
        >
          {showSource ? "Hide source" : "Show source"}
        </button>
      )}
    </div>
  );
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
