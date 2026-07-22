import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createSolutionFile,
  productChangedFiles,
  readSolutionFile,
  readSolutionTree,
  type FileChange,
  type FileTree,
  type Solution,
} from "../lib/backend";
import CodeWindow from "./CodeWindow";

/** The diff for the open file, coloured by line.
 *
 *  Rendered from the unified diff rather than recomputed: git already worked
 *  out what changed, and a second opinion from the app would only ever be a
 *  worse one that could disagree with the git tab. */
function ChangedFileDiff({ change }: { change: FileChange | undefined }) {
  if (!change) {
    return <p className="hint">This file has no uncommitted changes.</p>;
  }
  return (
    <section className="file-diff" aria-label={`Changes to ${change.path}`}>
      <h4>
        What changed{" "}
        <span className="change-lines">
          +{change.addedLines} −{change.removedLines}
        </span>
      </h4>
      <pre>
        {change.diff.split("\n").map((line, i) => {
          const kind = line.startsWith("+++") || line.startsWith("---")
            ? "diff-meta"
            : line.startsWith("+")
              ? "diff-added"
              : line.startsWith("-")
                ? "diff-removed"
                : line.startsWith("@@")
                  ? "diff-hunk"
                  : "";
          return (
            <span key={i} className={kind}>
              {line}
              {"\n"}
            </span>
          );
        })}
      </pre>
    </section>
  );
}

/** One file the developer has open: the working buffer and what is on disk.
 *  Held here rather than in the editor so switching tabs keeps unsaved edits. */
interface OpenFile {
  path: string;
  value: string;
  saved: string;
}

/** Everything one open Solution is holding. Several can be open at once —
 *  a change that spans an API and the web app in front of it is one job, and
 *  making the developer close one to look at the other would hide that. */
interface SolutionSession {
  solution: Solution;
  tree: FileTree | null;
  error: string | null;
  collapsed: Set<string>;
  open: OpenFile[];
  activePath: string | null;
}

function newSession(solution: Solution): SolutionSession {
  return {
    solution,
    tree: null,
    error: null,
    collapsed: new Set(),
    open: [],
    activePath: null,
  };
}

/** The Code tab: a file explorer on the left, the editor in the middle.
 *
 *  The explorer is itself tabbed — one tab per open Solution of this Product,
 *  each keeping its own tree, folds and open files, so cross-repo work is one
 *  screen rather than a sequence of them. */
export default function CodeEditor({
  solutions,
  opened,
}: {
  /** The Product's Solutions — the candidates the explorer can add. */
  solutions: Solution[];
  /** The Solution just opened from the Workspace tab, if any. */
  opened: Solution | null;
}) {
  const [sessions, setSessions] = useState<SolutionSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  /// The git toggle: show the whole tree, or only what has changed.
  const [changedOnly, setChangedOnly] = useState(false);
  /// Changed files per Solution id, fetched once per toggle rather than per
  /// keystroke — a git call per render would make typing in the editor crawl.
  const [changed, setChanged] = useState<Record<number, FileChange[]>>({});
  const [changedError, setChangedError] = useState<string | null>(null);

  const updateSession = useCallback(
    (id: number, change: (s: SolutionSession) => SolutionSession) =>
      setSessions((prev) => prev.map((s) => (s.solution.id === id ? change(s) : s))),
    [],
  );

  const loadTree = useCallback(
    async (solution: Solution) => {
      const linked = solution.localPath !== null && solution.localPath !== "";
      if (!linked) return;
      try {
        const tree = await readSolutionTree(solution.id);
        updateSession(solution.id, (s) => ({ ...s, tree, error: null }));
      } catch (e) {
        updateSession(solution.id, (s) => ({ ...s, tree: null, error: String(e) }));
      }
    },
    [updateSession],
  );

  const addSolution = useCallback(
    (solution: Solution) => {
      setActiveId(solution.id);
      setSessions((prev) =>
        prev.some((s) => s.solution.id === solution.id)
          ? prev
          : [...prev, newSession(solution)],
      );
      void loadTree(solution);
    },
    [loadTree],
  );

  // Opening from the Workspace tab adds a Solution here; opening one already
  // open just brings it forward, keeping whatever is unsaved in it.
  useEffect(() => {
    if (opened) addSolution(opened);
  }, [opened, addSolution]);

  const active = sessions.find((s) => s.solution.id === activeId) ?? null;
  const addable = useMemo(
    () => solutions.filter((s) => !sessions.some((open) => open.solution.id === s.id)),
    [solutions, sessions],
  );

  /** Entries hidden because an ancestor folder is collapsed. The tree arrives
   *  flat with a depth per entry, so "inside a collapsed folder" is a path
   *  prefix test rather than a walk. */
  const visibleEntries = useMemo(() => {
    if (!active?.tree) return [];
    return active.tree.entries.filter(
      (entry) => ![...active.collapsed].some((dir) => entry.path.startsWith(`${dir}/`)),
    );
  }, [active]);

  /** The changed files of whichever Solution is in front. Flat, not a tree:
   *  when the question is "what did I touch", folder structure is noise. */
  const activeChanges = active ? (changed[active.solution.id] ?? []) : [];

  /** Loads the whole Product's changes at once. Per-Solution would be a git
   *  call every time the explorer tab changed; the toggle is a deliberate act,
   *  so paying for all of them once is the cheaper trade. */
  const loadChanges = useCallback(async () => {
    const productId = solutions[0]?.productId;
    if (productId === undefined) return;
    try {
      const groups = await productChangedFiles(productId);
      const byId: Record<number, FileChange[]> = {};
      for (const group of groups) byId[group.solutionId] = group.changes;
      setChanged(byId);
      setChangedError(null);
    } catch (e) {
      setChangedError(String(e));
    }
  }, [solutions]);

  useEffect(() => {
    if (changedOnly) void loadChanges();
  }, [changedOnly, loadChanges]);

  function closeSolution(id: number) {
    const remaining = sessions.filter((s) => s.solution.id !== id);
    setSessions(remaining);
    if (activeId === id) {
      setActiveId(remaining.length > 0 ? remaining[remaining.length - 1].solution.id : null);
    }
  }

  function toggleFolder(path: string) {
    if (!active) return;
    updateSession(active.solution.id, (s) => {
      const collapsed = new Set(s.collapsed);
      if (collapsed.has(path)) collapsed.delete(path);
      else collapsed.add(path);
      return { ...s, collapsed };
    });
  }

  async function onOpenFile(path: string) {
    if (!active) return;
    const id = active.solution.id;
    if (active.open.some((f) => f.path === path)) {
      updateSession(id, (s) => ({ ...s, activePath: path }));
      return;
    }
    try {
      const contents = await readSolutionFile(id, path);
      updateSession(id, (s) => ({
        ...s,
        open: [...s.open, { path, value: contents, saved: contents }],
        activePath: path,
        error: null,
      }));
    } catch (e) {
      updateSession(id, (s) => ({ ...s, error: String(e) }));
    }
  }

  function closeFile(path: string) {
    if (!active) return;
    updateSession(active.solution.id, (s) => {
      const open = s.open.filter((f) => f.path !== path);
      return {
        ...s,
        open,
        activePath:
          s.activePath === path
            ? open.length > 0
              ? open[open.length - 1].path
              : null
            : s.activePath,
      };
    });
  }

  async function onCreate() {
    const name = newName.trim();
    if (name === "" || !active) return;
    const id = active.solution.id;
    setCreating(true);
    try {
      await createSolutionFile(id, name);
      setNewName("");
      updateSession(id, (s) => ({ ...s, error: null }));
      await loadTree(active.solution);
      await onOpenFile(name);
    } catch (e) {
      updateSession(id, (s) => ({ ...s, error: String(e) }));
    } finally {
      setCreating(false);
    }
  }

  if (sessions.length === 0) {
    return (
      <p className="hint">
        No Solution open. Pick one on the Workspace tab and press Open.
      </p>
    );
  }

  const activeFile = active?.open.find((f) => f.path === active.activePath) ?? null;
  const activeLinked =
    active !== null &&
    active.solution.localPath !== null &&
    active.solution.localPath !== "";

  return (
    <section className="code-editor" aria-label="Code">
      {/* One tab per open Solution: cross-repo work is one screen. */}
      <nav className="solution-tabs" aria-label="Open solutions">
        {sessions.map((s) => (
          <span
            key={s.solution.id}
            className={`solution-tab${activeId === s.solution.id ? " solution-tab-active" : ""}`}
          >
            <button
              aria-pressed={activeId === s.solution.id}
              aria-label={`Show ${s.solution.name}`}
              onClick={() => setActiveId(s.solution.id)}
            >
              {s.solution.name}
              {s.open.some((f) => f.value !== f.saved) && " ●"}
            </button>
            <button
              aria-label={`Close ${s.solution.name}`}
              onClick={() => closeSolution(s.solution.id)}
            >
              ×
            </button>
          </span>
        ))}

        {addable.length > 0 && (
          <select
            aria-label="Add a solution"
            value=""
            onChange={(e) => {
              const picked = solutions.find((s) => s.id === Number(e.target.value));
              if (picked) addSolution(picked);
            }}
          >
            <option value="">Add a solution…</option>
            {addable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </nav>

      {active && active.error && <p role="alert">{active.error}</p>}

      {!activeLinked ? (
        <p className="hint">
          {active?.solution.name} has no working copy on this machine yet. Point
          it at a folder on the Workspace tab, then open it here.
        </p>
      ) : (
        <div className="code-editor-panes">
          <div className="explorer">
            <div className="new-file">
              <input
                aria-label="New file path"
                placeholder="src/new-file.rs"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button
                aria-label="Create file"
                disabled={creating || newName.trim() === ""}
                onClick={onCreate}
              >
                New
              </button>
            </div>

            {/* The git toggle. Off, this is the repository; on, it is the work
                in progress — which is the question being asked far more often
                once a change is under way. */}
            <div className="explorer-git-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={changedOnly}
                  onChange={(e) => setChangedOnly(e.target.checked)}
                />{" "}
                Changed files only
              </label>
              {changedOnly && (
                <button aria-label="Refresh changed files" onClick={loadChanges}>
                  Refresh
                </button>
              )}
            </div>

            {changedOnly && changedError && <p role="alert">{changedError}</p>}

            {changedOnly ? (
              <ul
                className="changed-tree"
                aria-label={`Changed files in ${active?.solution.name}`}
              >
                {activeChanges.length === 0 && !changedError && (
                  <li className="hint">Nothing changed in this Solution.</li>
                )}
                {activeChanges.map((change) => (
                  <li key={change.path}>
                    <button
                      className={`tree-file${active?.activePath === change.path ? " tree-file-open" : ""}`}
                      aria-label={`Open ${change.path}`}
                      onClick={() => onOpenFile(change.path)}
                    >
                      <span className={`change-status ${change.status}`}>
                        {change.status.charAt(0).toUpperCase()}
                      </span>{" "}
                      {change.path}{" "}
                      <span className="change-lines">
                        +{change.addedLines} −{change.removedLines}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
            <ul className="file-tree" aria-label={`Files in ${active?.solution.name}`}>
              {visibleEntries.map((entry) => (
                <li key={entry.path} style={{ paddingLeft: `${entry.depth * 0.75}rem` }}>
                  {entry.isDir ? (
                    <button
                      className="tree-dir"
                      aria-label={`${active?.collapsed.has(entry.path) ? "Expand" : "Collapse"} ${entry.path}`}
                      aria-expanded={!active?.collapsed.has(entry.path)}
                      onClick={() => toggleFolder(entry.path)}
                    >
                      {active?.collapsed.has(entry.path) ? "▸" : "▾"} {entry.name}/
                    </button>
                  ) : (
                    <button
                      className={`tree-file${active?.activePath === entry.path ? " tree-file-open" : ""}`}
                      aria-label={`Open ${entry.path}`}
                      onClick={() => onOpenFile(entry.path)}
                    >
                      {entry.name}
                      {active?.open.some((f) => f.path === entry.path && f.value !== f.saved) && (
                        <span className="tree-dirty" aria-hidden="true"> ●</span>
                      )}
                    </button>
                  )}
                </li>
              ))}
              {active?.tree?.truncated && (
                /* A partial tree that does not say so reads as a complete one. */
                <li className="hint">…more files not shown</li>
              )}
            </ul>
            )}
          </div>

          <div className="file-view">
            {active && active.open.length > 0 && (
              <nav className="editor-tabs" aria-label="Open files">
                {active.open.map((f) => (
                  <span
                    key={f.path}
                    className={`editor-tab${active.activePath === f.path ? " editor-tab-active" : ""}`}
                  >
                    <button
                      aria-pressed={active.activePath === f.path}
                      aria-label={`Show ${f.path}`}
                      onClick={() =>
                        updateSession(active.solution.id, (s) => ({ ...s, activePath: f.path }))
                      }
                    >
                      {f.path.split("/").pop()}
                      {f.value !== f.saved && " ●"}
                    </button>
                    <button aria-label={`Close ${f.path}`} onClick={() => closeFile(f.path)}>
                      ×
                    </button>
                  </span>
                ))}
              </nav>
            )}

            {active && activeFile ? (
              <CodeWindow
                key={`${active.solution.id}:${activeFile.path}`}
                solutionId={active.solution.id}
                path={activeFile.path}
                value={activeFile.value}
                saved={activeFile.saved}
                onChange={(next) =>
                  updateSession(active.solution.id, (s) => ({
                    ...s,
                    open: s.open.map((f) =>
                      f.path === activeFile.path ? { ...f, value: next } : f,
                    ),
                  }))
                }
                onSaved={(savedContent) => {
                  updateSession(active.solution.id, (s) => ({
                    ...s,
                    open: s.open.map((f) =>
                      f.path === activeFile.path ? { ...f, saved: savedContent } : f,
                    ),
                  }));
                  void loadTree(active.solution);
                }}
              />
            ) : (
              <p className="hint">Pick a file from the explorer to edit it.</p>
            )}

            {/* What changed, beside the file itself. Only while the toggle is
                on: a diff permanently under the editor would be noise for the
                nine times out of ten someone is just reading code. */}
            {changedOnly && activeFile && (
              <ChangedFileDiff
                change={activeChanges.find((c) => c.path === activeFile.path)}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
