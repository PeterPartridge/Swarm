import { useCallback, useEffect, useState } from "react";
import {
  discardRunWorktree,
  listAbandonedWorktrees,
  listRuns,
  removeWorktreeAt,
  startRun,
  type AbandonedWorktree,
  type Run,
} from "../../lib/backend";
import RunTerminal from "../code/RunTerminal";

/** A run started this session: its own worktree terminal and the command to run
 *  in it. Kept so several can be open at once — that is the "simultaneously". */
interface StartedRun {
  runId: number;
  solutionId: number;
  worktreePath: string;
  command: string;
  /** How to start the app in the worktree — empty when there is nothing to run.
   *  When present, a second terminal boots the app beside the agent's. */
  runStart: string;
  /** The dev-server terminal was closed on its own, without ending the run. */
  devClosed?: boolean;
  title: string;
}

/** The execution runs — one per (work item, Solution), each in its own checkout.
 *
 *  This is the far end of "have the AI execute them simultaneously". Two work
 *  items touching one Solution get two branches in two folders, so their agents
 *  never share a working copy. Start prepares a run — its own worktree and
 *  brief — and hands back the command; the agent is launched into the run's own
 *  terminal, deliberately, because an app that silently started something that
 *  writes files would be doing the one thing this design keeps as a press.
 *
 *  **Reading each plan happens on the build plan, not here.** This panel is
 *  about running them; the plan a run was built from is one click away on its
 *  work item. */
export default function RunsPanel({ productId }: { productId: number }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [started, setStarted] = useState<StartedRun[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /// Checkouts on disk that no run claims — the pile that used to be invisible.
  const [abandoned, setAbandoned] = useState<AbandonedWorktree[]>([]);

  const refresh = useCallback(async () => {
    try {
      setRuns(await listRuns(productId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
    // Separately, and never fatal: leftovers are a tidiness question, and
    // failing to read them must not blank the runs this panel is actually for.
    try {
      setAbandoned(await listAbandonedWorktrees(productId));
    } catch {
      setAbandoned([]);
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const key = (r: Run) => `${r.workItemId}-${r.solutionId}`;

  async function start(run: Run) {
    setBusy(key(run));
    try {
      const prepared = await startRun(run.workItemId, run.solutionId);
      // Kept so its terminal stays open alongside the others: two started runs
      // means two terminals, which is what running them at once looks like.
      setStarted((prev) => [
        ...prev.filter((s) => s.runId !== prepared.runId),
        {
          runId: prepared.runId,
          solutionId: run.solutionId,
          worktreePath: prepared.worktreePath,
          command: prepared.command,
          runStart: prepared.runStart,
          title: `${run.workItemTitle} → ${run.solutionName}`,
        },
      ]);
      setNotice(
        prepared.runStart
          ? `Started ${run.workItemTitle} on ${prepared.branch} — its agent and the app are running below.`
          : `Prepared ${run.workItemTitle} on ${prepared.branch} — its terminal is open below.`,
      );
      setError(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Starts every run that has not begun. This is the "simultaneously" of the
   *  request: each Start is a separate prepared run, and with the limit raised
   *  their agents run at once in their own folders. */
  async function startAll() {
    const ready = runs.filter((r) => r.state === "notStarted");
    for (const run of ready) {
      // Sequential *preparation* — the worktrees are made one after another to
      // keep git calm — but the agents they open run concurrently.
      // eslint-disable-next-line no-await-in-loop
      await start(run);
    }
  }

  async function discard(run: Run) {
    setBusy(key(run));
    try {
      await discardRunWorktree(run.id);
      setNotice(`Removed the worktree for ${run.workItemTitle}.`);
      setError(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function removeAbandoned(left: AbandonedWorktree) {
    setBusy(left.path);
    try {
      await removeWorktreeAt(left.solutionId, left.path);
      setNotice(`Removed the leftover checkout in ${left.solutionName}.`);
      setError(null);
      await refresh();
    } catch (e) {
      // Most often "it still holds uncommitted work", which is a refusal worth
      // reading rather than a failure to retry.
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const notStarted = runs.filter((r) => r.state === "notStarted").length;

  return (
    <section className="develop-card" aria-label="Runs">
      <h3>Runs</h3>
      <p className="hint">
        Each affected Solution runs in its own checkout on its own branch, so
        two work items on one repository never overwrite each other.
      </p>

      <div className="runs-actions">
        <button onClick={refresh}>Refresh</button>
        <button onClick={startAll} disabled={notStarted === 0 || busy !== null}>
          Start all ({notStarted})
        </button>
      </div>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {runs.length === 0 && !error && (
        <p className="hint">
          No runs yet — a run appears for each Solution ticked as affected on a
          work item's build plan.
        </p>
      )}

      <ul className="run-list">
        {runs.map((run) => (
          <li key={key(run)} className={`run run-${run.state}`}>
            <div className="run-head">
              <strong>{run.workItemTitle}</strong>
              <span className="run-solution">→ {run.solutionName}</span>
              <span className="run-branch">{run.branch || "no branch set"}</span>
              <span className={`run-state ${run.state}`}>
                {run.state === "notStarted" ? "ready" : run.state}
              </span>
            </div>

            {run.worktreePath && (
              <p className="hint run-path">{run.worktreePath}</p>
            )}

            <div className="run-buttons">
              {run.state === "notStarted" ? (
                <button
                  aria-label={`Start ${run.workItemTitle} on ${run.solutionName}`}
                  disabled={busy === key(run) || run.branch.trim() === ""}
                  onClick={() => start(run)}
                >
                  {busy === key(run) ? "Preparing…" : "Start"}
                </button>
              ) : (
                <button
                  aria-label={`Remove worktree for ${run.workItemTitle}`}
                  disabled={busy === key(run) || run.worktreePath === ""}
                  onClick={() => discard(run)}
                >
                  Remove worktree
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Leftovers. A run somebody walked away from keeps its checkout — that
          is deliberate, because removing one under a working agent is worse
          than the disk it costs — but until now nothing ever mentioned them
          again, so the only way to find the pile was to run out of space. */}
      {abandoned.length > 0 && (
        <section className="abandoned" aria-label="Leftover checkouts">
          <h4>
            Leftover checkouts ({abandoned.length})
          </h4>
          <p className="hint">
            These belong to no run any more. Removing one is refused while it
            still holds uncommitted work.
          </p>
          <ul className="abandoned-list">
            {abandoned.map((left) => (
              <li key={left.path}>
                <span className="abandoned-solution">{left.solutionName}</span>
                <span className="abandoned-path">{left.path}</span>
                <button
                  aria-label={`Remove leftover checkout ${left.path}`}
                  disabled={busy === left.path}
                  onClick={() => removeAbandoned(left)}
                >
                  {busy === left.path ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Per run started this session: the agent's terminal, and — when the
          Solution has something to run — a second terminal that boots the app
          in the same worktree. Several runs side by side is the
          "simultaneously"; the app running beside each agent is the "boots the
          app without a click". */}
      {started.length > 0 && (
        <div className="run-terminals">
          {started.map((s) => (
            <div key={s.runId} className="run-terminal-pair">
              <RunTerminal
                key={`${s.runId}-agent`}
                solutionId={s.solutionId}
                worktreePath={s.worktreePath}
                command={s.command}
                title={s.title}
                onClose={() =>
                  setStarted((prev) => prev.filter((r) => r.runId !== s.runId))
                }
              />
              {s.runStart && !s.devClosed && (
                <RunTerminal
                  key={`${s.runId}-dev`}
                  solutionId={s.solutionId}
                  worktreePath={s.worktreePath}
                  command={s.runStart}
                  title={`${s.title} — app`}
                  // Closing the app's terminal leaves the agent running: the two
                  // are the same run, but you may want to stop the server and
                  // keep working.
                  onClose={() =>
                    setStarted((prev) =>
                      prev.map((r) =>
                        r.runId === s.runId ? { ...r, devClosed: true } : r,
                      ),
                    )
                  }
                />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
