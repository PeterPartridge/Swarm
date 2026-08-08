import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hueFor, markFor } from "../ai/AgentLane";
import {
  createSolution,
  linkSolutions,
  listRepoLinks,
  listRuns,
  listSolutions,
  saveDiagram,
  unlinkSolutions,
  ARCHITECTURE_KIND_LABELS,
  REPO_LINK_LABELS,
  SOLUTION_TYPES,
  type ArchitectureDoc,
  type DiagramEdge,
  type DiagramNode,
  type RepoLink,
  type RepoLinkKind,
  type Run,
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
 *  and the links between them are the shared truth, and those are in the DB.
 *
 *  **Three panes**, as the design has it: what can go on the map and what is
 *  wrong with it down the left, the canvas in the middle, and everything known
 *  about the selected box down the right. */

const NODE_W = 168;
const NODE_H = 64;
const SNAP = 10;
const LINK_KINDS = Object.keys(REPO_LINK_LABELS) as RepoLinkKind[];

/** The design's zoom range, and the view the Tidy button returns to. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.6;
const HOME = { zoom: 1, panX: 0, panY: 0 };

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
  return { x: 40 + (index % 4) * 210, y: 40 + Math.floor(index / 4) * 140 };
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

export default function SolutionMap({
  productId,
  docs = [],
  onOpenAgent,
}: {
  productId: number;
  /** The Product's architecture documents, passed in rather than read again —
   *  the section below this one already has them, and two reads of the same
   *  list is two chances to disagree. The inspector indexes them by Solution;
   *  the full list with its previews stays below. */
  docs?: ArchitectureDoc[];
  /** Opens the work item an agent in this module is working on, over in Build. */
  onOpenAgent?: (workItemId: number) => void;
}) {
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [links, setLinks] = useState<RepoLink[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [pos, setPos] = useState<Record<number, Point>>(() => loadLayout(productId));
  const [mode, setMode] = useState<"arrange" | "connect">("arrange");
  const [connectFrom, setConnectFrom] = useState<number | null>(null);
  const [connectKind, setConnectKind] = useState<RepoLinkKind>("callsApi");
  const [selected, setSelected] = useState<number | null>(null);
  const [zoom, setZoom] = useState(HOME.zoom);
  const [pan, setPan] = useState<Point>({ x: HOME.panX, y: HOME.panY });
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<string>(SOLUTION_TYPES[0]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const panning = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
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

  // Which Solutions have an agent inside them. A failure here loses the marks
  // and nothing else — the map is about the architecture first.
  useEffect(() => {
    void (async () => {
      try {
        setRuns(await listRuns(productId));
      } catch {
        setRuns([]);
      }
    })();
  }, [productId]);

  // Persist the arrangement whenever it settles.
  useEffect(() => {
    saveLayout(productId, pos);
  }, [productId, pos]);

  const positionOf = (id: number): Point => pos[id] ?? { x: 40, y: 40 };

  function onPointerDown(e: React.PointerEvent, id: number) {
    e.stopPropagation();
    if (mode === "connect") {
      void onConnectClick(id);
      return;
    }
    setSelected(id);
    const p = positionOf(id);
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    // Screen pixels are zoomed pixels: dividing by the scale is what keeps the
    // box under the pointer instead of drifting away from it as you zoom in.
    drag.current = {
      id,
      dx: (e.clientX - rect.left) / zoom - p.x,
      dy: (e.clientY - rect.top) / zoom - p.y,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onSurfaceDown(e: React.PointerEvent) {
    if (mode === "connect") {
      setConnectFrom(null);
      return;
    }
    setSelected(null);
    panning.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const rect = surface.current?.getBoundingClientRect();
    if (d && rect) {
      const x = Math.max(0, Math.round(((e.clientX - rect.left) / zoom - d.dx) / SNAP) * SNAP);
      const y = Math.max(0, Math.round(((e.clientY - rect.top) / zoom - d.dy) / SNAP) * SNAP);
      setPos((prev) => ({ ...prev, [d.id]: { x, y } }));
      return;
    }
    const p = panning.current;
    if (p) setPan({ x: p.ox + (e.clientX - p.sx), y: p.oy + (e.clientY - p.sy) });
  }

  function onPointerUp() {
    drag.current = null;
    panning.current = null;
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
      setSelected(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function onSave() {
    const nodes: DiagramNode[] = solutions.map((s) => {
      const p = positionOf(s.id);
      // Written where they were dragged, so the saved .drawio is the arrangement
      // on screen rather than a fresh grid.
      return {
        id: String(s.id),
        label: s.name,
        kind: exportKind(s.solutionType),
        x: Math.round(p.x),
        y: Math.round(p.y),
      };
    });
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

  async function onRemoveLink(id: number) {
    try {
      await unlinkSolutions(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  const nameOf = (id: number) => solutions.find((s) => s.id === id)?.name ?? `#${id}`;

  /// The agent in each Solution, if any — the same fact the Build view's lane
  /// reports, read from the same place so the two cannot disagree.
  const agentIn = useMemo(() => {
    const byId: Record<number, Run> = {};
    for (const r of runs) {
      if (r.state === "kept" || r.state === "discarded") continue;
      if (!byId[r.solutionId]) byId[r.solutionId] = r;
    }
    return byId;
  }, [runs]);

  const connected = useMemo(() => {
    const ids = new Set<number>();
    for (const l of links) {
      ids.add(l.fromSolutionId);
      ids.add(l.toSolutionId);
    }
    return ids;
  }, [links]);

  /** What is wrong with the map, judged only on what the app can see. There is
   *  deliberately no "health" here: the design coloured each module ok / warn /
   *  bad, which would be a verdict on code this app never reads. Whether a
   *  Solution has a working copy, a repository and a place in the picture are
   *  three things it does know. */
  const checks = useMemo(() => {
    const noFolder = solutions.filter((s) => !s.localPath);
    const noRepo = solutions.filter((s) => !s.githubUrl);
    const orphans = solutions.filter((s) => !connected.has(s.id));
    const list: { tone: "ok" | "warn"; text: string }[] = [];
    if (noFolder.length > 0)
      list.push({
        tone: "warn",
        text: `${noFolder.length} with no working copy on this machine — ${noFolder
          .map((s) => s.name)
          .join(", ")}.`,
      });
    if (noRepo.length > 0)
      list.push({
        tone: "warn",
        text: `${noRepo.length} with no repository linked — ${noRepo.map((s) => s.name).join(", ")}.`,
      });
    if (orphans.length > 0 && solutions.length > 1)
      list.push({
        tone: "warn",
        text: `${orphans.length} joined to nothing — ${orphans
          .map((s) => s.name)
          .join(", ")}. Connect them, or they are not really on the map.`,
      });
    if (list.length === 0 && solutions.length > 0)
      list.push({ tone: "ok", text: "Every Solution has a folder, a repository and a connection." });
    return list;
  }, [solutions, connected]);

  const counts = useMemo(() => {
    const by: Record<string, number> = {};
    for (const s of solutions) by[s.solutionType] = (by[s.solutionType] ?? 0) + 1;
    return by;
  }, [solutions]);

  const chosen = solutions.find((s) => s.id === selected) ?? null;
  const chosenLinks = chosen ? links.filter((l) => l.fromSolutionId === chosen.id || l.toSolutionId === chosen.id) : [];
  const chosenDocs = chosen ? docs.filter((d) => d.solutionId === chosen.id) : [];
  const agentsOnMap = solutions.filter((s) => agentIn[s.id]).length;

  return (
    <section className="arch-map" aria-label="Architecture map">
      {/* ── What can go on the map, and what is wrong with it ───────────── */}
      <div className="arch-palette">
        <div className="palette-head">
          <strong>Architecture</strong>
          <p className="hint">Draw it here. Agents plan against it.</p>
        </div>

        <div className="palette-group">
          <span className="palette-label">Add a Solution</span>
          {/* A box on this map is a real Solution, so adding one creates it —
              there is no such thing as a module that exists only in the
              picture, and a placeholder box would be a lie about the code. */}
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
            <button
              aria-label="Add Solution to the map"
              disabled={newName.trim() === ""}
              onClick={onAdd}
            >
              Add
            </button>
          </div>
        </div>

        <div className="palette-group">
          <span className="palette-label">On the map</span>
          <ul className="palette-counts">
            {SOLUTION_TYPES.map((t) => (
              <li key={t}>
                <span className={`type-chip type-${t}`} aria-hidden="true" />
                <span className="type-name">{t}</span>
                <span className="type-count">{counts[t] ?? 0}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="palette-group">
          <span className="palette-label">Map checks</span>
          <ul className="palette-checks">
            {checks.length === 0 && <li className="hint">Nothing on the map yet.</li>}
            {checks.map((c) => (
              <li key={c.text} className={c.tone}>
                <span aria-hidden="true">{c.tone === "ok" ? "✓" : "△"}</span>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="palette-group palette-keys">
          <span className="palette-label">Shortcuts</span>
          <dl>
            <div>
              <dt>drag</dt>
              <dd>move a Solution</dd>
            </div>
            <div>
              <dt>Connect</dt>
              <dd>click two of them</dd>
            </div>
            <div>
              <dt>Tidy</dt>
              <dd>reset zoom and pan</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* ── The canvas ───────────────────────────────────────────────────── */}
      <div className="arch-canvas">
        <div className="map-toolbar">
          <div className="zoom-group">
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - 0.1) * 10) / 10))}
            >
              −
            </button>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + 0.1) * 10) / 10))}
            >
              +
            </button>
          </div>

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
          )}

          <span className="toolbar-spacer" />

          <button
            type="button"
            aria-label="Reset the view"
            onClick={() => {
              setZoom(HOME.zoom);
              setPan({ x: HOME.panX, y: HOME.panY });
            }}
          >
            Tidy
          </button>
          <button aria-label="Save the map as a diagram" onClick={onSave}>
            Save
          </button>
        </div>

        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}

        {mode === "connect" && (
          <p className="connect-hint" role="status">
            {connectFrom === null
              ? "Click the Solution the dependency starts at."
              : `From ${nameOf(connectFrom)} — click the one it depends on.`}
          </p>
        )}

        {solutions.length === 0 ? (
          <p className="hint">
            This Product has no Solutions yet — add one on the left, or create it
            on the Solutions tab, and it appears here as a box.
          </p>
        ) : (
          <div
            className={`map-viewport ${mode === "connect" ? "connecting" : ""}`}
            onPointerDown={onSurfaceDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <div
              className="map-surface"
              ref={surface}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                backgroundSize: `${SNAP * 2}px ${SNAP * 2}px`,
              }}
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
                  const touches =
                    selected !== null &&
                    (l.fromSolutionId === selected || l.toSolutionId === selected);
                  return (
                    <g key={l.id} className={touches ? "edge-on" : undefined}>
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={touches ? "var(--accent)" : "var(--fg-muted)"}
                        strokeWidth={touches ? 2 : 1.5}
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
                const run = agentIn[s.id];
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`map-node type-${s.solutionType}${
                      connectFrom === s.id ? " map-node-picked" : ""
                    }${selected === s.id ? " map-node-selected" : ""}`}
                    style={
                      {
                        left: p.x,
                        top: p.y,
                        width: NODE_W,
                        height: NODE_H,
                        "--agent-hue": hueFor(s.id),
                      } as React.CSSProperties
                    }
                    aria-label={`${s.name} (${s.solutionType})`}
                    aria-pressed={selected === s.id}
                    onPointerDown={(e) => onPointerDown(e, s.id)}
                  >
                    <span className="node-rail" aria-hidden="true" />
                    <span className="node-top">
                      {/* Not "health" — the app does not read this code. What it
                          knows is whether there is a working copy here. */}
                      <span
                        className={s.localPath ? "node-dot here" : "node-dot"}
                        title={
                          s.localPath
                            ? "Has a working copy on this machine"
                            : "No working copy on this machine"
                        }
                      />
                      <span className="map-node-name">{s.name}</span>
                      {run && (
                        <span className="node-agent" title={`${run.workItemTitle} is in here`}>
                          {markFor(s.name)}
                        </span>
                      )}
                    </span>
                    <span className="node-meta">
                      {s.language ?? "language not recorded"}
                    </span>
                    <span className="map-node-type">{s.solutionType}</span>
                    {selected === s.id && (
                      <>
                        <span className="handle tl" aria-hidden="true" />
                        <span className="handle tr" aria-hidden="true" />
                        <span className="handle bl" aria-hidden="true" />
                        <span className="handle br" aria-hidden="true" />
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="map-status">
          <span>
            {solutions.length} Solution{solutions.length === 1 ? "" : "s"}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {links.length} link{links.length === 1 ? "" : "s"}
          </span>
          <span aria-hidden="true">·</span>
          <span className="accent">{agentsOnMap} with an agent</span>
          <span className="toolbar-spacer" />
          <span className="dim">drag to move, snaps to {SNAP}px</span>
        </div>
      </div>

      {/* ── Everything known about the selected box ───────────────────────── */}
      <aside className="arch-inspector" aria-label="Selected Solution">
        {chosen ? (
          <>
            <div className="inspect-card">
              <div className="inspect-card-head">
                <span className={`type-chip type-${chosen.solutionType}`} aria-hidden="true" />
                <span className="inspect-kind">{chosen.solutionType}</span>
              </div>
              <strong className="inspect-title">{chosen.name}</strong>
              {/* Deliberately no owner, size or coverage. The design showed all
                  three; this app reads none of them, and three confident
                  numbers nothing stands behind would be worse than a short
                  panel. */}
              <dl className="inspect-facts">
                <div>
                  <dt>Working copy</dt>
                  <dd className={chosen.localPath ? "card-mono" : "warn"}>
                    {chosen.localPath ?? "not set"}
                  </dd>
                </div>
                <div>
                  <dt>Repository</dt>
                  <dd className={chosen.githubUrl ? "card-mono" : "warn"}>
                    {chosen.githubUrl ?? "not linked"}
                  </dd>
                </div>
                <div>
                  <dt>Started as</dt>
                  <dd>{chosen.language ?? "not recorded"}</dd>
                </div>
              </dl>
            </div>

            {agentIn[chosen.id] && (
              <button
                type="button"
                className="inspect-agent"
                aria-label={`Open ${agentIn[chosen.id].workItemTitle} in Build`}
                disabled={!onOpenAgent}
                onClick={() => onOpenAgent?.(agentIn[chosen.id].workItemId)}
              >
                <span className="inspect-agent-mark" aria-hidden="true">
                  {markFor(chosen.name)}
                </span>
                <span className="inspect-agent-who">
                  <strong>An agent is in this Solution</strong>
                  <span className="card-mono">{agentIn[chosen.id].workItemTitle}</span>
                </span>
                <span aria-hidden="true">→</span>
              </button>
            )}

            <div className="inspect-group">
              <span className="palette-label">Connections</span>
              {chosenLinks.length === 0 ? (
                <p className="hint">
                  Joined to nothing. Use Connect to say what it depends on.
                </p>
              ) : (
                <ul className="link-list" aria-label="Connections">
                  {chosenLinks.map((l) => {
                    const out = l.fromSolutionId === chosen.id;
                    const other = out ? l.toSolutionId : l.fromSolutionId;
                    return (
                      <li key={l.id}>
                        <span className={out ? "arrow out" : "arrow in"} aria-hidden="true">
                          {out ? "→" : "←"}
                        </span>
                        <span className="link-name">{nameOf(other)}</span>
                        <span className="link-kind">{REPO_LINK_LABELS[l.kind]}</span>
                        <button
                          aria-label={`Remove dependency ${nameOf(l.fromSolutionId)} to ${nameOf(
                            l.toSolutionId,
                          )}`}
                          onClick={() => void onRemoveLink(l.id)}
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="inspect-group">
              <span className="palette-label">
                {chosenDocs.length > 0 ? "Decisions about this" : "No decisions about this"}
              </span>
              {/* An index, not a second copy: the documents themselves render
                  with their diagrams in the section below. */}
              <ul className="doc-index">
                {chosenDocs.map((d) => (
                  <li key={d.id}>
                    <strong>{d.name}</strong>
                    <span className="doc-kind">{ARCHITECTURE_KIND_LABELS[d.kind]}</span>
                    <span className="doc-kind">{d.format}</span>
                  </li>
                ))}
                {chosenDocs.length === 0 && (
                  <li className="hint">
                    Nothing recorded against this Solution. Draw one below.
                  </li>
                )}
              </ul>
            </div>
          </>
        ) : (
          <>
            <p className="hint">
              Pick a box to see its folder, its repository and what it is joined
              to.
            </p>

            {links.length > 0 && (
              <div className="inspect-group">
                <span className="palette-label">Dependencies</span>
                <ul className="link-list" aria-label="Dependencies">
                  {links.map((l) => (
                    <li key={l.id}>
                      <span className="link-name">
                        {nameOf(l.fromSolutionId)} → {nameOf(l.toSolutionId)}
                      </span>
                      <span className="link-kind">{REPO_LINK_LABELS[l.kind]}</span>
                      <button
                        aria-label={`Remove dependency ${nameOf(l.fromSolutionId)} to ${nameOf(
                          l.toSolutionId,
                        )}`}
                        onClick={() => void onRemoveLink(l.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {docs.length > 0 && (
              <div className="inspect-group">
                <span className="palette-label">Decision records</span>
                <ul className="doc-index">
                  {docs.map((d) => (
                    <li key={d.id}>
                      <strong>{d.name}</strong>
                      <span className="doc-kind">{ARCHITECTURE_KIND_LABELS[d.kind]}</span>
                      <span className="doc-kind">
                        {d.solutionId === null ? "whole Product" : nameOf(d.solutionId)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </aside>
    </section>
  );
}
