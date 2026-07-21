import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createSolutionFile,
  readSolutionFile,
  readSolutionTree,
  type FileTree,
  type Solution,
} from "../lib/backend";
import CodeWindow from "./CodeWindow";

/** One file the developer has open: the working buffer and what is on disk.
 *  Held here rather than in the editor so switching tabs keeps unsaved edits. */
interface OpenFile {
  path: string;
  value: string;
  saved: string;
}

/** The Code tab: a file explorer on the left, the editor in the middle.
 *  Reached by opening a Solution from the Workspace tab.
 *
 *  Several files can be open at once, as tabs, each keeping its own unsaved
 *  edits. Path containment is enforced in the backend, so nothing here can
 *  reach outside the Solution's folder. */
export default function CodeEditor({ solution }: { solution: Solution }) {
  const [tree, setTree] = useState<FileTree | null>(null);
  const [open, setOpen] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linked = solution.localPath !== null && solution.localPath !== "";

  const refresh = useCallback(async () => {
    if (!linked) {
      setTree(null);
      return;
    }
    try {
      setTree(await readSolutionTree(solution.id));
      setError(null);
    } catch (e) {
      setTree(null);
      setError(String(e));
    }
  }, [solution.id, linked]);

  useEffect(() => {
    void refresh();
    // A different Solution is a different repository: nothing stays open.
    setOpen([]);
    setActivePath(null);
    setCollapsed(new Set());
  }, [refresh]);

  /** Entries hidden because an ancestor folder is collapsed. The tree arrives
   *  flat with a depth per entry, so "inside a collapsed folder" is a path
   *  prefix test rather than a walk. */
  const visibleEntries = useMemo(() => {
    if (!tree) return [];
    return tree.entries.filter(
      (entry) =>
        ![...collapsed].some((dir) => entry.path.startsWith(`${dir}/`)),
    );
  }, [tree, collapsed]);

  function toggleFolder(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function onOpen(path: string) {
    // Already open: just bring it forward, keeping whatever is unsaved in it.
    if (open.some((f) => f.path === path)) {
      setActivePath(path);
      return;
    }
    try {
      const contents = await readSolutionFile(solution.id, path);
      setOpen((prev) => [...prev, { path, value: contents, saved: contents }]);
      setActivePath(path);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  function onClose(path: string) {
    setOpen((prev) => prev.filter((f) => f.path !== path));
    setActivePath((current) => {
      if (current !== path) return current;
      const remaining = open.filter((f) => f.path !== path);
      return remaining.length > 0 ? remaining[remaining.length - 1].path : null;
    });
  }

  async function onCreate() {
    const name = newName.trim();
    if (name === "") return;
    setCreating(true);
    try {
      await createSolutionFile(solution.id, name);
      setNewName("");
      setError(null);
      await refresh();
      await onOpen(name);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  const active = open.find((f) => f.path === activePath) ?? null;

  if (!linked) {
    return (
      <p className="hint">
        {solution.name} has no working copy on this machine yet. Point it at a
        folder on the Workspace tab, then open it here.
      </p>
    );
  }

  return (
    <section className="code-editor" aria-label={`Code: ${solution.name}`}>
      {error && <p role="alert">{error}</p>}
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

          <ul className="file-tree" aria-label={`Files in ${solution.name}`}>
            {visibleEntries.map((entry) => (
              <li key={entry.path} style={{ paddingLeft: `${entry.depth * 0.75}rem` }}>
                {entry.isDir ? (
                  <button
                    className="tree-dir"
                    aria-label={`${collapsed.has(entry.path) ? "Expand" : "Collapse"} ${entry.path}`}
                    aria-expanded={!collapsed.has(entry.path)}
                    onClick={() => toggleFolder(entry.path)}
                  >
                    {collapsed.has(entry.path) ? "▸" : "▾"} {entry.name}/
                  </button>
                ) : (
                  <button
                    className={`tree-file${activePath === entry.path ? " tree-file-open" : ""}`}
                    aria-label={`Open ${entry.path}`}
                    onClick={() => onOpen(entry.path)}
                  >
                    {entry.name}
                    {open.some((f) => f.path === entry.path && f.value !== f.saved) && (
                      <span className="tree-dirty" aria-hidden="true"> ●</span>
                    )}
                  </button>
                )}
              </li>
            ))}
            {tree?.truncated && (
              /* A partial tree that does not say so reads as a complete one. */
              <li className="hint">…more files not shown</li>
            )}
          </ul>
        </div>

        <div className="file-view">
          {open.length > 0 && (
            <nav className="editor-tabs" aria-label="Open files">
              {open.map((f) => (
                <span
                  key={f.path}
                  className={`editor-tab${activePath === f.path ? " editor-tab-active" : ""}`}
                >
                  <button
                    aria-pressed={activePath === f.path}
                    aria-label={`Show ${f.path}`}
                    onClick={() => setActivePath(f.path)}
                  >
                    {f.path.split("/").pop()}
                    {f.value !== f.saved && " ●"}
                  </button>
                  <button aria-label={`Close ${f.path}`} onClick={() => onClose(f.path)}>
                    ×
                  </button>
                </span>
              ))}
            </nav>
          )}

          {active ? (
            <CodeWindow
              solutionId={solution.id}
              path={active.path}
              value={active.value}
              saved={active.saved}
              onChange={(next) =>
                setOpen((prev) =>
                  prev.map((f) => (f.path === active.path ? { ...f, value: next } : f)),
                )
              }
              onSaved={(savedContent) => {
                setOpen((prev) =>
                  prev.map((f) =>
                    f.path === active.path ? { ...f, saved: savedContent } : f,
                  ),
                );
                void refresh();
              }}
            />
          ) : (
            <p className="hint">Pick a file from the explorer to edit it.</p>
          )}
        </div>
      </div>
    </section>
  );
}
