import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSolution,
  linkSolutions,
  listRepoLinks,
  listSolutions,
  saveDiagram,
  unlinkSolutions,
  REPO_LINK_LABELS,
  SOLUTION_TYPES,
  type DiagramEdge,
  type DiagramNode,
  type RepoLink,
  type RepoLinkKind,
  type Solution,
} from "../../lib/backend";

/** The cross-repo map and the architecture diagram, which were the same picture
 *  drawn twice: a box per Solution and the dependencies between them.
 *
 *  Each Solution is a box shaped by its type — an API, a database and a website
 *  should not look the same — dragged where it belongs and joined by its real
 *  dependencies (the repo links the map already stored). A new Solution is added
 *  from here, and the arrangement is saved: kept on this machine as you move
 *  things, and written out as a .drawio when you want it in the repo.
 *
 *  The layout lives in localStorage rather than the database because it is a
 *  view of shared facts, not a fact itself — two people can arrange the same
 *  Solutions differently, and neither arrangement is more true. The Solutions
 *  and the links between them are the shared truth, and those are in the DB. */

const NODE_W = 150;
const NODE_H = 58;
const LINK_KINDS = Object.keys(REPO_LINK_LABELS) as RepoLinkKind[];

interface Point {
  x: number;
  y: number;
}

function layoutKey(productId: number): string {
  return `coperativeai.map.${productId}`;
}

function loadLayout(productId: number): Record<number, Point> {
  try {
    const raw = localStorage.getItem(layoutKey(productId));
    return raw ? (JSON.parse(raw) as Record<number, Point>) : {};
  } catch {
    return {};
  }
}

function saveLayout(productId: number, layout: Record<number, Point>): void {
  try {
    localStorage.setItem(layoutKey(productId), JSON.stringify(layout));
  } catch {
    // A machine that refuses localStorage still arranges for this session.
  }
}

/** A tidy starting spot for a Solution with no saved position — a grid, so a
 *  first open is legible rather than a pile in one corner. */
function defaultPosition(index: number): Point {
  return { x: 40 + (index % 4) * 190, y: 40 + Math.floor(index / 4) * 130 };
}

/** The Solution type a box is drawn as, mapped to the diagram vocabulary the
 *  .drawio export understands. */
function exportKind(solutionType: string): string {
  switch (solutionType) {
    case "database":
      return "database";
    case "api":
      return "queue";
    case "website":
      return "external";
    default:
      return "service";
  }
}

export default function SolutionMap({ productId }: { productId: number }) {
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [links, setLinks] = useState<RepoLink[]>([]);
  const [pos, setPos] = useState<Record<number, Point>>(() => loadLayout(productId));
  const [mode, setMode] = useState<"arrange" | "connect">("arrange");
  const [connectFrom, setConnectFrom] = useState<number | null>(null);
  const [connectKind, setConnectKind] = useState<RepoLinkKind>("callsApi");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<string>(SOLUTION_TYPES[0]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const surface = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedSolutions, loadedLinks] = await Promise.all([
        listSolutions(),
        listRepoLinks(productId),
      ]);
      const mine = loadedSolutions.filter((s) => s.productId === productId);
      setSolutions(mine);
      setLinks(loadedLinks);
      setError(null);
      // Give any Solution without a saved spot a place on the grid, so it is
      // never invisible off-canvas.
      setPos((prev) => {
        const next = { ...prev };
        mine.forEach((s, i) => {
          if (!next[s.id]) next[s.id] = defaultPosition(i);
        });
        return next;
      });
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Persist the arrangement whenever it settles.
  useEffect(() => {
    saveLayout(productId, pos);
  }, [productId, pos]);

  const positionOf = (id: number): Point => pos[id] ?? { x: 40, y: 40 };

  function onPointerDown(e: React.PointerEvent, id: number) {
    if (mode === "connect") {
      onConnectClick(id);
      return;
    }
    const p = positionOf(id);
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    drag.current = { id, dx: e.clientX - rect.left - p.x, dy: e.clientY - rect.top - p.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const rect = surface.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const x = Math.max(0, e.clientX - rect.left - d.dx);
    const y = Math.max(0, e.clientY - rect.top - d.dy);
    setPos((prev) => ({ ...prev, [d.id]: { x, y } }));
  }

  function onPointerUp() {
    drag.current = null;
  }

  async function onConnectClick(id: number) {
    if (connectFrom === null) {
      setConnectFrom(id);
      return;
    }
    if (connectFrom === id) {
      setConnectFrom(null);
      return;
    }
    try {
      await linkSolutions(connectFrom, id, connectKind, "");
      setConnectFrom(null);
      setNotice(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function onAdd() {
    const name = newName.trim();
    if (name === "") return;
    try {
      const id = await createSolution({ name, productId, solutionType: newType, answers: "{}" });
      setNewName("");
      setPos((prev) => ({ ...prev, [id]: defaultPosition(solutions.length) }));
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function onSave() {
    const nodes: DiagramNode[] = solutions.map((s) => ({
      id: String(s.id),
      label: s.name,
      kind: exportKind(s.solutionType),
    }));
    const edges: DiagramEdge[] = links.map((l) => ({
      from: String(l.fromSolutionId),
      to: String(l.toSolutionId),
      label: REPO_LINK_LABELS[l.kind],
    }));
    try {
      const path = await saveDiagram(productId, "architecture-map", nodes, edges);
      setNotice(
        `Saved to ${path}. It is a .drawio file in the Product's diagrams — commit it from a Solution's Git tab to put it on GitHub.`,
      );
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  const nameOf = (id: number) => solutions.find((s) => s.id === id)?.name ?? `#${id}`;

  return (
    <section className="solution-map" aria-label="Architecture map">
      <div className="map-toolbar">
        <div role="radiogroup" aria-label="Map mode" className="map-mode">
          <label>
            <input
              type="radio"
              name="map-mode"
              checked={mode === "arrange"}
              onChange={() => {
                setMode("arrange");
                setConnectFrom(null);
              }}
            />{" "}
            Arrange
          </label>
          <label>
            <input
              type="radio"
              name="map-mode"
              checked={mode === "connect"}
              onChange={() => setMode("connect")}
            />{" "}
            Connect
          </label>
        </div>

        {mode === "connect" && (
          <>
            <select
              aria-label="Dependency kind"
              value={connectKind}
              onChange={(e) => setConnectKind(e.target.value as RepoLinkKind)}
            >
              {LINK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {REPO_LINK_LABELS[k]}
                </option>
              ))}
            </select>
            <span className="hint">
              {connectFrom === null
                ? "Click the Solution the dependency starts at."
                : `From ${nameOf(connectFrom)} — click the one it depends on.`}
            </span>
          </>
        )}

        <div className="map-add">
          <input
            aria-label="New Solution name"
            placeholder="New Solution"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <select
            aria-label="New Solution type"
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
          >
            {SOLUTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button aria-label="Add Solution to the map" disabled={newName.trim() === ""} onClick={onAdd}>
            Add
          </button>
        </div>

        <button aria-label="Save the map as a diagram" onClick={onSave}>
          Save
        </button>
      </div>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {solutions.length === 0 ? (
        <p className="hint">
          This Product has no Solutions yet — add one above, or create it on the
          Solutions tab, and it appears here as a box.
        </p>
      ) : (
        <div
          className="map-surface"
          ref={surface}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {/* Edges sit behind the boxes and never take the pointer, so a line
              crossing a box does not steal its drag. */}
          <svg className="map-edges" aria-hidden="true">
            <defs>
              <marker
                id="map-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="var(--fg-muted)" />
              </marker>
            </defs>
            {links.map((l) => {
              const a = positionOf(l.fromSolutionId);
              const b = positionOf(l.toSolutionId);
              const x1 = a.x + NODE_W / 2;
              const y1 = a.y + NODE_H / 2;
              const x2 = b.x + NODE_W / 2;
              const y2 = b.y + NODE_H / 2;
              return (
                <g key={l.id}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="var(--fg-muted)"
                    strokeWidth={1.5}
                    markerEnd="url(#map-arrow)"
                  />
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} className="map-edge-label">
                    {REPO_LINK_LABELS[l.kind]}
                  </text>
                </g>
              );
            })}
          </svg>

          {solutions.map((s) => {
            const p = positionOf(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={`map-node type-${s.solutionType}${
                  connectFrom === s.id ? " map-node-picked" : ""
                }`}
                style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                aria-label={`${s.name} (${s.solutionType})`}
                onPointerDown={(e) => onPointerDown(e, s.id)}
              >
                <span className="map-node-type">{s.solutionType}</span>
                <span className="map-node-name">{s.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {links.length > 0 && (
        <ul className="map-link-list" aria-label="Dependencies">
          {links.map((l) => (
            <li key={l.id}>
              {nameOf(l.fromSolutionId)} {REPO_LINK_LABELS[l.kind]} {nameOf(l.toSolutionId)}
              <button
                aria-label={`Remove dependency ${nameOf(l.fromSolutionId)} to ${nameOf(l.toSolutionId)}`}
                onClick={() => void unlinkSolutions(l.id).then(refresh).catch((e) => setError(String(e)))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
