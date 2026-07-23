import { useCallback, useEffect, useState } from "react";
import {
  listDiagrams,
  openDiagram,
  saveDiagram,
  type DiagramEdge,
  type DiagramFile,
  type DiagramNode,
} from "../lib/backend";

const KINDS = ["service", "database", "queue", "store", "external"];

/** Infrastructure diagrams as real `.drawio` files.
 *
 *  **This app writes the file; draw.io edits it.** Embedding the real editor
 *  would mean loading app.diagrams.net over the network every time — which
 *  breaks offline and sends your infrastructure to a third party — and a
 *  substitute built here would be a worse draw.io that could not open anything
 *  anyone else made.
 *
 *  So the file is the contract: `.drawio` is mxGraph XML, it opens in the
 *  desktop app or the VS Code extension, and it lands in the Product's folder
 *  so it versions alongside the code it describes. A diagram kept somewhere
 *  else goes stale without anybody seeing it happen. */
export default function InfrastructureDiagrams({ productId }: { productId: number }) {
  const [files, setFiles] = useState<DiagramFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("Infrastructure");
  const [nodes, setNodes] = useState<DiagramNode[]>([]);
  const [edges, setEdges] = useState<DiagramEdge[]>([]);
  const [nodeLabel, setNodeLabel] = useState("");
  const [nodeKind, setNodeKind] = useState("service");
  const [edgeFrom, setEdgeFrom] = useState("");
  const [edgeTo, setEdgeTo] = useState("");
  const [edgeLabel, setEdgeLabel] = useState("");

  const refresh = useCallback(async () => {
    try {
      setFiles(await listDiagrams(productId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function addNode() {
    const label = nodeLabel.trim();
    if (!label) return;
    // The id is derived from the label so the edge pickers read as names
    // rather than as numbers nobody can match up.
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (nodes.some((n) => n.id === id)) {
      setError(`There is already a ${label} on this diagram.`);
      return;
    }
    setNodes([...nodes, { id, label, kind: nodeKind }]);
    setNodeLabel("");
    setError(null);
  }

  function addEdge() {
    if (!edgeFrom || !edgeTo || edgeFrom === edgeTo) return;
    setEdges([...edges, { from: edgeFrom, to: edgeTo, label: edgeLabel.trim() }]);
    setEdgeLabel("");
  }

  async function save() {
    try {
      const path = await saveDiagram(productId, name, nodes, edges);
      setNotice(`Written to ${path} — open it in draw.io to lay it out.`);
      setError(null);
      await refresh();
    } catch (e) {
      setNotice(null);
      setError(String(e));
    }
  }

  async function open(path: string) {
    try {
      await openDiagram(path);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <section className="develop-card" aria-label="Infrastructure diagrams">
      <h2>Infrastructure</h2>
      <p className="hint">
        Diagrams are written as real <code>.drawio</code> files into this
        Product's folder, so they version with the code and open in whatever
        draw.io you have — the desktop app or the VS Code extension. This app
        creates and stores them; draw.io does the drawing.
      </p>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <div className="diagram-builder">
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
                    // An arrow to a box that no longer exists writes a file
                    // draw.io opens with a dangling edge, so they go together.
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

        <button type="button" onClick={save} disabled={nodes.length === 0}>
          Write the .drawio file
        </button>
      </div>

      <h3>Diagrams in this Product</h3>
      {files.length === 0 && (
        <p className="hint">
          None yet. A Product needs its framework files generated first — the
          diagrams go beside them.
        </p>
      )}
      <ul className="diagram-files">
        {files.map((file) => (
          <li key={file.path}>
            <strong>{file.name}</strong>
            <span className="hint">{file.path}</span>
            <button
              type="button"
              aria-label={`Open ${file.name} in draw.io`}
              onClick={() => open(file.path)}
            >
              Open in draw.io
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
