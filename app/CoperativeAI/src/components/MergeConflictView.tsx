import { useEffect, useState } from "react";
import {
  markConflictResolved,
  readConflictSides,
  writeSolutionFile,
  type ConflictSides,
} from "../lib/backend";

/** One conflicted file, in the three parts a merge is actually made of.
 *
 *  Mine and theirs come from git's index (stages 2 and 3), not from the file on
 *  disk — once git writes conflict markers into the working tree, the two
 *  original versions exist nowhere else. The third pane is that working-tree
 *  file: git's attempt, markers and all, and the only one that is editable,
 *  because it is the only one that becomes the result.
 *
 *  Marking resolved is refused while markers remain. Staging a file with
 *  `<<<<<<< HEAD` still in it is the classic way to commit a conflict, and the
 *  check costs one read of a file already open in front of you. */
export default function MergeConflictView({
  solutionId,
  path,
  onClose,
}: {
  solutionId: number;
  path: string;
  onClose: () => void;
}) {
  const [sides, setSides] = useState<ConflictSides | null>(null);
  const [merged, setMerged] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await readConflictSides(solutionId, path);
        if (cancelled) return;
        setSides(loaded);
        setMerged(loaded.merged);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [solutionId, path]);

  async function save() {
    setBusy(true);
    try {
      await writeSolutionFile(solutionId, path, merged);
      setNotice("Saved.");
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Save then stage, in that order: staging reads the file from disk, so
   *  staging an unsaved buffer would mark a version nobody chose. */
  async function resolve() {
    setBusy(true);
    try {
      await writeSolutionFile(solutionId, path, merged);
      await markConflictResolved(solutionId, path);
      setNotice(`${path} is marked resolved and staged.`);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const stillConflicted = merged
    .split("\n")
    .some((l) => l.startsWith("<<<<<<< ") || l === "=======" || l.startsWith(">>>>>>> "));

  return (
    <section className="merge-view" aria-label={`Merge conflict in ${path}`}>
      <div className="merge-head">
        <h3>{path}</h3>
        {stillConflicted ? (
          <span className="merge-state unresolved">conflict markers still present</span>
        ) : (
          <span className="merge-state resolved">no markers left</span>
        )}
        <button onClick={save} disabled={busy}>
          Save
        </button>
        <button onClick={resolve} disabled={busy || stillConflicted}>
          Mark resolved
        </button>
        <button onClick={onClose}>Close</button>
      </div>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {!sides && !error && <p>Reading the three versions…</p>}

      {sides && (
        <div className="merge-panes">
          <div className="merge-pane">
            <h4 id={`mine-${path}`}>My changes</h4>
            <p className="hint">The branch you are merging into.</p>
            <textarea
              readOnly
              aria-labelledby={`mine-${path}`}
              value={sides.mine}
              rows={20}
            />
          </div>

          <div className="merge-pane">
            <h4 id={`theirs-${path}`}>Their changes</h4>
            <p className="hint">The branch being merged in.</p>
            <textarea
              readOnly
              aria-labelledby={`theirs-${path}`}
              value={sides.theirs}
              rows={20}
            />
          </div>

          <div className="merge-pane merge-result">
            <h4 id={`merged-${path}`}>After the merge</h4>
            <p className="hint">
              Git's attempt. Edit this one — it is what gets saved.
            </p>
            <textarea
              aria-labelledby={`merged-${path}`}
              value={merged}
              rows={20}
              onChange={(e) => setMerged(e.target.value)}
            />
          </div>
        </div>
      )}

      {sides && !sides.base && (
        <p className="hint">
          There is no common ancestor for this file — it was added on both sides,
          so there is nothing either version started from.
        </p>
      )}
    </section>
  );
}
