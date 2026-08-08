import { useCallback, useEffect, useMemo, useState } from "react";
import FileIcon from "./FileIcon";
import { hueFor, markFor } from "../ai/AgentLane";
import {
  productChangedFiles,
  readSolutionTree,
  type FileChange,
  type Solution,
  type TreeEntry,
} from "../../lib/backend";

/** Where a file sits in the tree, with whatever git says about it attached. */
interface Row {
  entry: TreeEntry;
  change: FileChange | null;
}

/** Every folder above a path, so a row can ask whether its ancestors are open. */
function ancestors(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** The Build view's file tree: one Solution's files, marked with what has
 *  changed in the working copy.
 *
 *  It is beside the agent lane rather than inside the editor because the two
 *  answer different halves of one question — the lane says who is working, the
 *  tree says where they have been. Clicking a changed file opens its diff in the
 *  workbench, which is the whole reason the two panes sit together. */
export default function BuildExplorer({
  productId,
  solutions,
  solutionId,
  selectedPath,
  onSelectFile,
}: {
  productId: number;
  /** The Product's Solutions, for naming and colouring the changed marks. */
  solutions: Solution[];
  /** Which Solution's tree to show. Null when nothing is open. */
  solutionId: number | null;
  /** The path currently open in the workbench, highlighted here. */
  selectedPath: string | null;
  /** Called with a repository-relative path. */
  onSelectFile: (solutionId: number, path: string) => void;
}) {
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [changes, setChanges] = useState<Record<number, FileChange[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  /// Show the whole tree, or only what has changed. Changed-only is what a
  /// reviewer wants and the whole tree is what someone exploring wants, and
  /// neither is right often enough to be the only option.
  const [changedOnly, setChangedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTree = useCallback(async () => {
    if (solutionId === null) {
      setEntries([]);
      setTruncated(false);
      return;
    }
    try {
      const tree = await readSolutionTree(solutionId);
      setEntries(tree.entries);
      setTruncated(tree.truncated);
      setError(null);
    } catch (e) {
      setEntries([]);
      setError(String(e));
    }
  }, [solutionId]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  // Across the Product, not just this Solution: the marks in the tree and the
  // counts in the header are the same numbers the lane and the ship rail use,
  // and fetching them once here keeps them from disagreeing.
  const loadChanges = useCallback(async () => {
    try {
      const groups = await productChangedFiles(productId);
      const byId: Record<number, FileChange[]> = {};
      for (const g of groups) byId[g.solutionId] = g.changes;
      setChanges(byId);
    } catch {
      // A tree that cannot say what changed is still a usable tree — the marks
      // are an addition to it, not the point of it.
      setChanges({});
    }
  }, [productId]);

  useEffect(() => {
    void loadChanges();
  }, [loadChanges]);

  const mine = useMemo(
    () => (solutionId === null ? [] : (changes[solutionId] ?? [])),
    [changes, solutionId],
  );

  const rows: Row[] = useMemo(() => {
    const byPath = new Map(mine.map((c) => [c.path, c]));
    const all = entries.map((entry) => ({ entry, change: byPath.get(entry.path) ?? null }));
    if (!changedOnly) return all;
    // A folder stays only when something under it changed, or the filter leaves
    // a tree of empty branches.
    const changedDirs = new Set<string>();
    for (const c of mine) for (const a of ancestors(c.path)) changedDirs.add(a);
    return all.filter((r) => (r.entry.isDir ? changedDirs.has(r.entry.path) : r.change !== null));
  }, [entries, mine, changedOnly]);

  const visible = rows.filter((r) =>
    ancestors(r.entry.path).every((a) => open[a] !== false),
  );

  const solution = solutions.find((s) => s.id === solutionId) ?? null;
  const fileCount = entries.filter((e) => !e.isDir).length;

  return (
    <section className="build-explorer" aria-label="Files">
      <header className="explorer-head">
        <span className="explorer-title">Files</span>
        <span className="explorer-count">
          {mine.length} changed of {fileCount}
        </span>
        <button
          type="button"
          className="explorer-scope"
          aria-pressed={changedOnly}
          onClick={() => setChangedOnly((v) => !v)}
        >
          {changedOnly ? "Changed only" : "Whole tree"}
        </button>
      </header>

      {error && <p role="alert">{error}</p>}

      {solutionId === null && (
        <p className="hint">
          Pick an agent with a Solution, or open one from your workspace, and its
          files appear here.
        </p>
      )}

      {solutionId !== null && entries.length === 0 && error === null && (
        <p className="hint">
          {solution?.localPath
            ? "Nothing to show in this working copy."
            : "This Solution has no folder on this machine yet — point it at one in Map."}
        </p>
      )}

      <ul className="explorer-tree">
        {visible.map(({ entry, change }) => {
          const isOpen = open[entry.path] !== false;
          return (
            <li key={entry.path}>
              <button
                type="button"
                className={`tree-row ${
                  selectedPath === entry.path ? "tree-selected" : ""
                }`}
                style={{ paddingLeft: `${0.5 + entry.depth * 0.8}rem` }}
                aria-label={entry.isDir ? `Folder ${entry.name}` : entry.path}
                aria-expanded={entry.isDir ? isOpen : undefined}
                onClick={() =>
                  entry.isDir
                    ? setOpen((o) => ({ ...o, [entry.path]: !isOpen }))
                    : solutionId !== null && onSelectFile(solutionId, entry.path)
                }
              >
                <span className="tree-caret" aria-hidden="true">
                  {entry.isDir ? (isOpen ? "▾" : "▸") : ""}
                </span>
                <FileIcon name={entry.name} isDir={entry.isDir} />
                <span className="tree-name">{entry.name}</span>
                {change && solution && (
                  <span
                    className="tree-mark"
                    style={{ "--agent-hue": hueFor(solution.id) } as React.CSSProperties}
                    title={`${change.status} in ${solution.name}`}
                  >
                    {markFor(solution.name)}
                  </span>
                )}
                {change && (
                  <span className={`tree-status ${change.status}`}>
                    {change.status.charAt(0).toUpperCase()}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {truncated && (
        <p className="hint">
          Only part of this tree was read — it is larger than the walk goes.
        </p>
      )}
    </section>
  );
}
