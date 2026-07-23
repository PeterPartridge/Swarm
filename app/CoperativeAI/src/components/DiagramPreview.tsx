import { diagramPosition, DIAGRAM_GRID, type DiagramEdge, type DiagramNode } from "../lib/backend";

const FILL: Record<string, { fill: string; stroke: string }> = {
  service: { fill: "#d5e8d4", stroke: "#82b366" },
  database: { fill: "#dae8fc", stroke: "#6c8ebf" },
  queue: { fill: "#fff2cc", stroke: "#d6b656" },
  store: { fill: "#d5e8d4", stroke: "#82b366" },
  external: { fill: "#f5f5f5", stroke: "#999999" },
};

/** The diagram as it will be written.
 *
 *  **Drawn from the same grid the file uses** — `DIAGRAM_GRID` is mirrored from
 *  `drawio.rs`, and both sides have a test asserting the same coordinates. A
 *  preview that laid things out differently would be a picture of a diagram
 *  nobody is about to get, which is worse than showing none.
 *
 *  Rendered from the nodes and edges in hand rather than by parsing the XML
 *  back: it updates as boxes are added, before there is a file at all. */
export function DiagramPreview({
  nodes,
  edges,
}: {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}) {
  if (nodes.length === 0) {
    return <p className="hint">Add a box and it will appear here.</p>;
  }
  const placed = nodes.map((node, i) => ({ node, ...diagramPosition(i) }));
  const centre = (id: string) => {
    const found = placed.find((p) => p.node.id === id);
    if (!found) return null;
    return { x: found.x + DIAGRAM_GRID.w / 2, y: found.y + DIAGRAM_GRID.h / 2 };
  };
  const width =
    Math.max(...placed.map((p) => p.x + DIAGRAM_GRID.w)) + DIAGRAM_GRID.x0;
  const height =
    Math.max(...placed.map((p) => p.y + DIAGRAM_GRID.h)) + DIAGRAM_GRID.y0;

  return (
    <svg
      className="diagram-preview"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Diagram preview"
    >
      {edges.map((edge, i) => {
        const from = centre(edge.from);
        const to = centre(edge.to);
        if (!from || !to) return null;
        return (
          <g key={`e${i}`}>
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#6b7280"
              strokeWidth={1.5}
            />
            {edge.label && (
              <text
                x={(from.x + to.x) / 2}
                y={(from.y + to.y) / 2 - 4}
                fontSize={11}
                fill="#6b7280"
                textAnchor="middle"
              >
                {edge.label}
              </text>
            )}
          </g>
        );
      })}
      {placed.map(({ node, x, y }) => {
        const colour = FILL[node.kind] ?? FILL.service;
        return (
          <g key={node.id}>
            <rect
              x={x}
              y={y}
              width={DIAGRAM_GRID.w}
              height={DIAGRAM_GRID.h}
              rx={node.kind === "external" ? 10 : 6}
              fill={colour.fill}
              stroke={colour.stroke}
              strokeDasharray={node.kind === "external" ? "5 3" : undefined}
            />
            <text
              x={x + DIAGRAM_GRID.w / 2}
              y={y + DIAGRAM_GRID.h / 2 + 4}
              fontSize={13}
              textAnchor="middle"
              fill="#1f2937"
            >
              {node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
