import { useCallback, useEffect, useMemo, useState } from "react";
import FileIcon from "./FileIcon";
import { ancestors, withChanges } from "../../lib/tree";
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
  runChanges = null,
  runId,
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
  /** What the selected agent has changed, when one is selected.
   *
   *  **The agent's checkout, not the branch.** An agent works in a worktree of
   *  its own, and the Product-wide change list reads each Solution's main
   *  folder — so this pane showed the default branch and no sign that an agent
   *  had touched anything. Given a run's changes it shows those instead, and
   *  `null` (nobody selected) puts the branch back. */
  runChanges?: FileChange[] | null;
  /** The selected agent's run, so the walk reads its checkout rather than the
   *  Solution's folder. Its added files are there and nowhere else. */
  runId?: number;
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
            const tree = await readSolutionTree(s.id, runId);
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
  }, [scope, runId]);

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

  /** Whether every folder above a row has been opened.
   *
   *  **Closed by default.** A tree that arrives fully expanded is a wall of
   *  paths: a .NET project opens on `bin/Debug/net8.0/…` before anything a
   *  person wrote. Folders open on a click and stay open, which makes the shape
   *  of the repository the first thing you see and the contents the second.
   *
   *  The exception is "changed only", where the whole point is the changed
   *  files: hiding them behind folders somebody has to open one at a time would
   *  make that view answer nothing. */
  const reachable = useCallback(
    (solutionId: number, path: string, changedOnlyView: boolean, folders: Set<string>) =>
      changedOnlyView ||
      // Only the folders that are really rows: a row whose parent is not in the
      // tree has nothing to open, and hiding it would hide it for good.
      ancestors(path)
        .filter((a) => folders.has(a))
        .every((a) => open[`${solutionId}:${a}`] === true),
    [open],
  );

  /** Every visible row, in Solution order. A root is a Solution when more than
   *  one is showing; with one, its files sit at the top level because a single
   *  root you can never fold away is just an indent. */
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    // **An agent's tree is its own checkout, with its changes in it.** A flat
    // list of changed paths was the first cut and answered "what changed"
    // without answering "where" — and a .NET project's changes live under
    // `bin/` and `obj/`, which the walk skips, so those had nowhere to sit at
    // all. `withChanges` puts them back under the folders they belong to.
    if (runChanges !== null) {
      const solution = scope[0];
      if (solution === undefined) return out;
      const byPath = new Map(runChanges.map((c) => [c.path, c]));
      const merged = withChanges(
        trees[solution.id] ?? [],
        runChanges.map((c) => c.path),
      );
      const folders = new Set(merged.filter((e) => e.isDir).map((e) => e.path));
      const changedDirs = new Set<string>();
      if (changedOnly) {
        for (const c of runChanges) for (const a of ancestors(c.path)) changedDirs.add(a);
      }
      for (const entry of merged) {
        const change = byPath.get(entry.path) ?? null;
        if (changedOnly && (entry.isDir ? !changedDirs.has(entry.path) : change === null)) {
          continue;
        }
        if (!reachable(solution.id, entry.path, changedOnly, folders)) {
          continue;
        }
        out.push({ solution, entry, change });
      }
      return out;
    }
    const multi = scope.length > 1;
    for (const solution of scope) {
      if (multi && foldedRoots.includes(solution.id)) continue;
      const mine = changes[solution.id] ?? [];
      const byPath = new Map(mine.map((c) => [c.path, c]));
      const entries = trees[solution.id] ?? [];
      const folders = new Set(entries.filter((e) => e.isDir).map((e) => e.path));

      const changedDirs = new Set<string>();
      if (changedOnly) {
        for (const c of mine) for (const a of ancestors(c.path)) changedDirs.add(a);
      }

      for (const entry of entries) {
        const change = byPath.get(entry.path) ?? null;
        if (changedOnly && (entry.isDir ? !changedDirs.has(entry.path) : change === null)) {
          continue;
        }
        // Keyed by Solution so two repositories with the same folder name
        // open and close independently.
        if (!reachable(solution.id, entry.path, changedOnly, folders)) {
          continue;
        }
        out.push({ solution, entry, change });
      }
    }
    return out;
  }, [scope, trees, changes, changedOnly, open, foldedRoots, runChanges, reachable]);

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
          {runChanges !== null
            ? `${runChanges.length} changed by this agent`
            : `${changedCount} changed of ${fileCount}`}
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

      {runChanges !== null && runChanges.length === 0 && (
        <p className="hint">
          This agent has not changed anything yet. Its checkout exists and is
          empty of edits — which is what a run looks like before its agent has
          written anything.
        </p>
      )}

      {runChanges === null && scope.length > 0 && fileCount === 0 && error === null && (
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
                  // Closed until somebody opens it — except in the changed-only
                  // view, where every folder on the way to a change is open
                  // because that is the whole of what that view is for.
                  const isOpen = open[key] === true || changedOnly;
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
