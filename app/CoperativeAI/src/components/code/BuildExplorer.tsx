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

/** One row: a file or folder in a Solution, with whatever git says attached. */
interface Row {
  solution: Solution;
  entry: TreeEntry;
  change: FileChange | null;
}

/** Every folder above a path, so a row can ask whether its ancestors are open. */
function ancestors(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** The Build view's file tree: the whole Product, or one Solution.
 *
 *  **One pane, not two.** Picking a Solution to open and then browsing its files
 *  were two steps for one intention, and the first was a dropdown that had to be
 *  found before the second could start. With no Solution picked this shows every
 *  Solution in the Product, each as a root you can fold; picking one on the
 *  Solution bar scopes it to that repository. Either way a file is one click from
 *  the editor.
 *
 *  It sits beside the agent lane rather than inside the editor because the two
 *  answer different halves of one question — the lane says who is working, the
 *  tree says where they have been. */
export default function BuildExplorer({
  productId,
  solutions,
  solutionId,
  selectedPath,
  onSelectFile,
}: {
  productId: number;
  /** The Product's Solutions. All of them are shown when none is picked. */
  solutions: Solution[];
  /** Which Solution to scope to. Null shows the whole Product. */
  solutionId: number | null;
  /** The path currently open, highlighted here. */
  selectedPath: string | null;
  /** Called with a repository-relative path. */
  onSelectFile: (solutionId: number, path: string) => void;
}) {
  const [trees, setTrees] = useState<Record<number, TreeEntry[]>>({});
  const [truncated, setTruncated] = useState<number[]>([]);
  const [changes, setChanges] = useState<Record<number, FileChange[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  /// Which Solution roots are folded, when the whole Product is showing.
  const [foldedRoots, setFoldedRoots] = useState<number[]>([]);
  /// Show the whole tree, or only what has changed. Changed-only is what a
  /// reviewer wants and the whole tree is what someone exploring wants, and
  /// neither is right often enough to be the only option.
  const [changedOnly, setChangedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The Solutions this pane is showing: one, or all the ones with a folder. */
  const scope = useMemo(
    () =>
      solutionId === null
        ? solutions.filter((s) => s.localPath)
        : solutions.filter((s) => s.id === solutionId),
    [solutions, solutionId],
  );

  const loadTrees = useCallback(async () => {
    const found: Record<number, TreeEntry[]> = {};
    const cut: number[] = [];
    let failure: string | null = null;
    await Promise.all(
      scope
        .filter((s) => s.localPath)
        .map(async (s) => {
          try {
            const tree = await readSolutionTree(s.id);
            found[s.id] = tree.entries;
            if (tree.truncated) cut.push(s.id);
          } catch (e) {
            // One unreadable repository must not blank the others — the whole
            // point of showing the Product at once is that it keeps working
            // when one of its parts does not.
            failure = String(e);
          }
        }),
    );
    setTrees(found);
    setTruncated(cut);
    setError(failure);
  }, [scope]);

  useEffect(() => {
    void loadTrees();
  }, [loadTrees]);

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

  /** Every visible row, in Solution order. A root is a Solution when more than
   *  one is showing; with one, its files sit at the top level because a single
   *  root you can never fold away is just an indent. */
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const multi = scope.length > 1;
    for (const solution of scope) {
      if (multi && foldedRoots.includes(solution.id)) continue;
      const mine = changes[solution.id] ?? [];
      const byPath = new Map(mine.map((c) => [c.path, c]));
      const entries = trees[solution.id] ?? [];

      const changedDirs = new Set<string>();
      if (changedOnly) {
        for (const c of mine) for (const a of ancestors(c.path)) changedDirs.add(a);
      }

      for (const entry of entries) {
        const change = byPath.get(entry.path) ?? null;
        if (changedOnly && (entry.isDir ? !changedDirs.has(entry.path) : change === null)) {
          continue;
        }
        // A folded ancestor hides everything under it. Keyed by Solution so two
        // repositories with the same folder name fold independently.
        if (ancestors(entry.path).some((a) => open[`${solution.id}:${a}`] === false)) {
          continue;
        }
        out.push({ solution, entry, change });
      }
    }
    return out;
  }, [scope, trees, changes, changedOnly, open, foldedRoots]);

  const changedCount = scope.reduce((n, s) => n + (changes[s.id]?.length ?? 0), 0);
  const fileCount = scope.reduce(
    (n, s) => n + (trees[s.id] ?? []).filter((e) => !e.isDir).length,
    0,
  );
  const multi = scope.length > 1;

  return (
    <section className="build-explorer" aria-label="Files">
      <header className="explorer-head">
        <span className="explorer-title">Files</span>
        <span className="explorer-count">
          {changedCount} changed of {fileCount}
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

      {scope.length === 0 && (
        <p className="hint">
          No Solution in this Product has a folder on this machine yet — point
          one at a working copy on the Map tab and its files appear here.
        </p>
      )}

      {scope.length > 0 && fileCount === 0 && error === null && (
        <p className="hint">Nothing to show in these working copies.</p>
      )}

      <ul className="explorer-tree">
        {scope.map((solution) => {
          const folded = multi && foldedRoots.includes(solution.id);
          const mine = rows.filter((r) => r.solution.id === solution.id);
          return (
            <li key={solution.id}>
              {/* A Solution heading only when there is more than one to tell
                  apart. Scoped to one, a root nobody can fold away is an
                  indent that costs a column and says nothing. */}
              {multi && (
                <button
                  type="button"
                  className="tree-row tree-root"
                  style={{ "--agent-hue": hueFor(solution.id) } as React.CSSProperties}
                  aria-label={`Solution ${solution.name}`}
                  aria-expanded={!folded}
                  onClick={() =>
                    setFoldedRoots((prev) =>
                      folded ? prev.filter((id) => id !== solution.id) : [...prev, solution.id],
                    )
                  }
                >
                  <span className="tree-caret" aria-hidden="true">
                    {folded ? "▸" : "▾"}
                  </span>
                  <span className="tree-mark">{markFor(solution.name)}</span>
                  <span className="tree-name">{solution.name}</span>
                  <span className="tree-status">
                    {changes[solution.id]?.length || ""}
                  </span>
                </button>
              )}

              <ul>
                {mine.map(({ entry, change }) => {
                  const key = `${solution.id}:${entry.path}`;
                  const isOpen = open[key] !== false;
                  const on = selectedPath === entry.path && solutionId === solution.id;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className={`tree-row ${on ? "tree-selected" : ""}`}
                        style={{
                          paddingLeft: `${0.5 + (multi ? 0.8 : 0) + entry.depth * 0.8}rem`,
                        }}
                        aria-label={entry.isDir ? `Folder ${entry.name}` : entry.path}
                        aria-expanded={entry.isDir ? isOpen : undefined}
                        onClick={() =>
                          entry.isDir
                            ? setOpen((o) => ({ ...o, [key]: !isOpen }))
                            : onSelectFile(solution.id, entry.path)
                        }
                      >
                        <span className="tree-caret" aria-hidden="true">
                          {entry.isDir ? (isOpen ? "▾" : "▸") : ""}
                        </span>
                        <FileIcon name={entry.name} isDir={entry.isDir} />
                        <span className="tree-name">{entry.name}</span>
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
            </li>
          );
        })}
      </ul>

      {truncated.length > 0 && (
        <p className="hint">
          {truncated.length === 1 ? "One tree was" : `${truncated.length} trees were`} only
          partly read — larger than the walk goes.
        </p>
      )}
    </section>
  );
}
