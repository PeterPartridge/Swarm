import { useCallback, useEffect, useState } from "react";
import {
  discardRunWorktree,
  listRuns,
  startRun,
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

  const refresh = useCallback(async () => {
    try {
      setRuns(await listRuns(productId));
      setError(null);
    } catch (e) {
      setError(String(e));
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
          title: `${run.workItemTitle} → ${run.solutionName}`,
        },
      ]);
      setNotice(
        `Prepared ${run.workItemTitle} on ${prepared.branch} — its terminal is open below.`,
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

      {/* One terminal per run started this session, side by side — this is the
          "simultaneously": each is a separate agent in its own worktree, and
          they run at the same time. */}
      {started.length > 0 && (
        <div className="run-terminals">
          {started.map((s) => (
            <RunTerminal
              key={s.runId}
              solutionId={s.solutionId}
              worktreePath={s.worktreePath}
              command={s.command}
              title={s.title}
              onClose={() =>
                setStarted((prev) => prev.filter((r) => r.runId !== s.runId))
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
