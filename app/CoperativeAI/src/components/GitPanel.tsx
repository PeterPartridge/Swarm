import { useCallback, useEffect, useState } from "react";
import {
  commitSolution,
  getCommitPolicy,
  productChangedFiles,
  pushSolution,
  setCommitPolicy,
  type CommitMode,
  type CommitPolicy,
  type FileChange,
  type Solution,
} from "../lib/backend";

const MODE_LABELS: Record<CommitMode, string> = {
  off: "Never — I commit myself",
  onSave: "Every time I save a file",
  interval: "On a timer",
};

/** Manual commits, and the rules for automatic ones.
 *
 *  Lives beside the file explorer as a tab because committing is part of
 *  writing code, not a separate errand — the Git tab up in Develop answers
 *  "where does everything stand", and this answers "ship what I just did".
 *
 *  **Committing and pushing are separate choices**, in the settings and on the
 *  button. A local commit is a restore point: a bad one is a `git reset` and
 *  nobody else saw it. A pushed one is on the branch other people pull, where
 *  undoing it means rewriting history everyone already has. */
export default function GitPanel({
  solution,
  onCommitted,
}: {
  solution: Solution;
  /** So the explorer can refresh its changed-files view after a commit. */
  onCommitted?: () => void;
}) {
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [policy, setPolicy] = useState<CommitPolicy | null>(null);
  const [message, setMessage] = useState("");
  const [pushWithCommit, setPushWithCommit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [groups, loadedPolicy] = await Promise.all([
        productChangedFiles(solution.productId),
        getCommitPolicy(solution.id),
      ]);
      setChanges(
        groups.find((g) => g.solutionId === solution.id)?.changes ?? [],
      );
      setPolicy(loadedPolicy);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [solution.id, solution.productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function commit() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await commitSolution(solution.id, message, pushWithCommit);
      if (!result.committed) {
        setNotice("Nothing to commit.");
      } else {
        // A commit that landed and a push that did not is a real state, and
        // saying only "committed" would leave someone believing it was sent.
        const pushed =
          result.pushed && "Err" in result.pushed
            ? ` — committed, but the push failed: ${result.pushed.Err}`
            : result.pushed
              ? " and pushed"
              : "";
        setNotice(
          `Committed ${result.files.length} file${result.files.length === 1 ? "" : "s"}${pushed}.`,
        );
        setMessage("");
      }
      setError(null);
      await refresh();
      onCommitted?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function push() {
    setBusy(true);
    try {
      await pushSolution(solution.id);
      setNotice("Pushed.");
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy(next: Partial<CommitPolicy>) {
    if (!policy) return;
    const merged = { ...policy, ...next };
    try {
      await setCommitPolicy(
        solution.id,
        merged.mode,
        merged.push,
        merged.intervalMinutes,
      );
      setPolicy(merged);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section className="git-panel" aria-label="Git">
      <div className="git-panel-head">
        <strong>{changes.length} changed</strong>
        <button onClick={refresh}>Refresh</button>
        <button onClick={() => setShowSettings(!showSettings)}>
          {showSettings ? "Hide auto-commit" : "Auto-commit"}
        </button>
      </div>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {showSettings && policy && (
        <div className="commit-policy">
          <label>
            Commit automatically
            <select
              aria-label="Automatic commit"
              value={policy.mode}
              onChange={(e) => savePolicy({ mode: e.target.value as CommitMode })}
            >
              {(Object.keys(MODE_LABELS) as CommitMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>

          {policy.mode === "interval" && (
            <label>
              Every
              <input
                type="number"
                min={2}
                max={60}
                aria-label="Minutes between commits"
                value={policy.intervalMinutes}
                onChange={(e) =>
                  savePolicy({ intervalMinutes: Number(e.target.value) })
                }
              />
              minutes
            </label>
          )}

          {policy.mode !== "off" && (
            <>
              <label>
                <input
                  type="checkbox"
                  aria-label="Push automatic commits"
                  checked={policy.push}
                  onChange={(e) => savePolicy({ push: e.target.checked })}
                />{" "}
                …and push them
              </label>
              <p className="hint">
                {policy.push
                  ? "Each automatic commit goes to the branch other people pull. Undoing one there means rewriting history everybody already has."
                  : "Automatic commits stay on this machine until you push. A bad one is a local reset that nobody else ever saw."}
              </p>
              <p className="hint">
                The message is only the list of files that changed — an
                automatic commit is a restore point, and a sentence pretending
                to explain it would be believed by whoever read it later.
              </p>
            </>
          )}
        </div>
      )}

      {changes.length === 0 ? (
        <p className="hint">Nothing changed in {solution.name}.</p>
      ) : (
        <>
          <ul className="git-panel-files">
            {changes.map((change) => (
              <li key={change.path}>
                <span className={`change-status ${change.status}`}>
                  {change.status.charAt(0).toUpperCase()}
                </span>{" "}
                {change.path}{" "}
                <span className="change-lines">
                  +{change.addedLines} −{change.removedLines}
                </span>
              </li>
            ))}
          </ul>

          <label className="commit-message">
            Message
            <textarea
              rows={2}
              aria-label="Commit message"
              placeholder="what this change does"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <p className="hint">
            Left empty, the message becomes the list of files — same as an
            automatic commit.
          </p>

          <div className="commit-actions">
            <label>
              <input
                type="checkbox"
                aria-label="Push after committing"
                checked={pushWithCommit}
                onChange={(e) => setPushWithCommit(e.target.checked)}
              />{" "}
              Push after committing
            </label>
            <button onClick={commit} disabled={busy}>
              {busy ? "Working…" : pushWithCommit ? "Commit and push" : "Commit"}
            </button>
            <button onClick={push} disabled={busy}>
              Push
            </button>
          </div>
        </>
      )}
    </section>
  );
}
