import { useCallback, useEffect, useState } from "react";
import {
  readSolutionFile,
  readSolutionTree,
  reviewSolutionChanges,
  setSolutionPath,
  type ChangeReview,
  type FileTree,
  type Solution,
} from "../lib/backend";
import FolderField from "./FolderField";

/** Open a Solution: its working copy, and what has changed in it.
 *
 *  Read-only. Nothing here writes to the repository — this is the panel that
 *  shows you what is there and what an agent (or a person) just did to it.
 *
 *  The change review is the part that earns its keep: a diff checked against
 *  the Developer Rules, so an agent's output is reviewed rather than merely
 *  accepted. */
export default function SolutionBox({
  solution,
  onPathChanged,
}: {
  solution: Solution;
  onPathChanged: () => void;
}) {
  const [tree, setTree] = useState<FileTree | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [contents, setContents] = useState<string>("");
  const [review, setReview] = useState<ChangeReview | null>(null);
  const [busy, setBusy] = useState(false);
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
  }, [refresh]);

  async function onOpen(path: string) {
    try {
      setContents(await readSolutionFile(solution.id, path));
      setOpenPath(path);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onReview() {
    setBusy(true);
    try {
      setReview(await reviewSolutionChanges(solution.id));
      setError(null);
    } catch (e) {
      setReview(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSetPath(path: string) {
    try {
      await setSolutionPath(solution.id, path === "" ? null : path);
      setError(null);
      onPathChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    // No heading: whatever renders this already names the Solution, and
    // repeating it puts the same words on screen twice.
    <section className="solution-box" aria-label={`Open ${solution.name}`}>
      {error && <p role="alert">{error}</p>}

      <FolderField
        label="Working copy"
        value={solution.localPath ?? ""}
        onChange={onSetPath}
      />
      {!linked && (
        <p className="hint">
          A linked GitHub repository is not a checkout — point this at the
          folder on your machine to open it.
        </p>
      )}

      {tree && (
        <div className="solution-panes">
          <ul className="file-tree" aria-label={`Files in ${solution.name}`}>
            {tree.entries.map((entry) => (
              <li key={entry.path} style={{ paddingLeft: `${entry.depth * 0.75}rem` }}>
                {entry.isDir ? (
                  <span className="tree-dir">{entry.name}/</span>
                ) : (
                  <button
                    className="tree-file"
                    aria-label={`Open ${entry.path}`}
                    onClick={() => onOpen(entry.path)}
                  >
                    {entry.name}
                  </button>
                )}
              </li>
            ))}
            {tree.truncated && (
              /* A partial tree that does not say so reads as a complete one. */
              <li className="hint">…more files not shown</li>
            )}
          </ul>

          <div className="file-view">
            {openPath ? (
              <>
                <p className="file-path">{openPath}</p>
                <pre aria-label={`Contents of ${openPath}`}>{contents}</pre>
              </>
            ) : (
              <p className="hint">Pick a file to read it.</p>
            )}
          </div>
        </div>
      )}

      {linked && (
        <section className="change-review" aria-label={`Changes in ${solution.name}`}>
          <div className="review-head">
            <h4>Change review</h4>
            <button aria-label={`Review changes in ${solution.name}`} onClick={onReview} disabled={busy}>
              {busy ? "Reading…" : "Review what changed"}
            </button>
          </div>

          {review && (
            <>
              <p className="review-totals">
                {review.report.filesChanged === 0
                  ? "Nothing has changed in this working copy."
                  : `${review.report.filesChanged} file${
                      review.report.filesChanged === 1 ? "" : "s"
                    } changed · +${review.report.addedLines} −${review.report.removedLines}`}
              </p>

              {/* Silence for want of rules reads exactly like silence for want
                  of problems, so the difference is stated. */}
              {review.noRules && review.report.filesChanged > 0 && (
                <p className="hint" role="status">
                  This Product has no Developer Rules, so nothing was checked
                  against them. Set them in Admin.
                </p>
              )}

              {review.report.violations.length > 0 && (
                <ul className="review-violations" aria-label="Rules broken">
                  {review.report.violations.map((f, i) => (
                    <li key={`${f.path}-${i}`}>
                      <strong>{f.path}</strong> — {f.detail}
                    </li>
                  ))}
                </ul>
              )}
              {review.report.notices.length > 0 && (
                <ul className="review-notices" aria-label="Worth a look">
                  {review.report.notices.map((f, i) => (
                    <li key={`notice-${i}`}>{f.detail}</li>
                  ))}
                </ul>
              )}

              {review.changes.length > 0 && (
                <ul className="change-list">
                  {review.changes.map((c) => (
                    <li key={c.path}>
                      <div className="change-head">
                        <span className={`change-status ${c.status}`}>{c.status}</span>
                        <strong>{c.path}</strong>
                        <span className="change-counts">
                          +{c.addedLines} −{c.removedLines}
                        </span>
                      </div>
                      <pre className="change-diff">{c.diff}</pre>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}
