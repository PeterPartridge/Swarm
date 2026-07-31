import { useCallback, useEffect, useState } from "react";
import {
  abortRunMerge,
  discardRunWorktree,
  listAbandonedWorktrees,
  listRuns,
  mergeRunBranch,
  previewRunMerge,
  removeWorktreeAt,
  startRun,
  type AbandonedWorktree,
  type MergeOutcome,
  type MergePreview,
  type Run,
} from "../../lib/backend";
import RunTerminal from "../code/RunTerminal";
import { notifyWorkChanged, useWorkChanged } from "../../lib/workSignal";

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

/** What one run's merge looks like: what the check found, and what a merge did
 *  if one has been attempted. */
interface MergeInfo {
  preview: MergePreview;
  outcome?: MergeOutcome;
  /** True while a conflicted merge is standing open in the working copy. */
  open: boolean;
}

/** The merge state of one run: what the check found, what to do next.
 *
 *  Every branch of this says something the person did not already know — how
 *  many commits are coming, which files will fight, whether a merge is sitting
 *  open right now. A control that just said "Merge" would hide all of it. */
function MergeState({
  preview,
  outcome,
  busy,
  onMerge,
  onAbort,
  label,
}: {
  preview: MergePreview;
  outcome?: MergeOutcome;
  busy: boolean;
  onMerge: () => void;
  onAbort: () => void;
  label: string;
}) {
  if (preview.commitsAhead === 0) {
    return (
      <p className="hint">
        Nothing to merge — this branch has no commits the base does not already
        have.
      </p>
    );
  }

  const commits = `${preview.commitsAhead} commit${preview.commitsAhead === 1 ? "" : "s"}`;

  // A merge left open is the most urgent thing this component can say.
  if (outcome && !outcome.merged) {
    return (
      <div className="merge-open">
        <p role="status">{outcome.message}</p>
        <ul className="merge-conflicts">
          {outcome.conflicts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <button aria-label={`Abandon the merge for ${label}`} disabled={busy} onClick={onAbort}>
          Abandon this merge
        </button>
      </div>
    );
  }

  if (outcome?.merged) {
    return <p role="status">{outcome.message}</p>;
  }

  return (
    <div className="merge-check">
      {preview.clean ? (
        <p className="hint">{commits} to merge, cleanly.</p>
      ) : (
        <>
          <p className="hint">
            {commits} to merge, but {preview.conflicts.length} file
            {preview.conflicts.length === 1 ? "" : "s"} will conflict — merging
            opens them in the Code tab's merge view.
          </p>
          <ul className="merge-conflicts">
            {preview.conflicts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      )}
      <button aria-label={`Merge ${label}`} disabled={busy} onClick={onMerge}>
        {preview.clean ? "Merge" : "Merge and resolve"}
      </button>
    </div>
  );
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
  /// What a merge would do (or did), per run id. Held per run because several
  /// runs are in flight at once and each answers the question separately.
  const [merges, setMerges] = useState<Record<number, MergeInfo>>({});

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

  // This panel used to refresh on mount and never again, so a plan approved or
  // a question answered next to it left a stale list until somebody pressed
  // Refresh — and the Start button that had just become available did not
  // appear.
  useWorkChanged(refresh);

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
      notifyWorkChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Starts every run that has not begun **and whose plan is approved**. This is
   *  the "simultaneously" of the request: each Start is a separate prepared run,
   *  and with the limit raised their agents run at once in their own folders.
   *
   *  Unapproved ones are skipped rather than attempted: `prepare_run` would
   *  refuse each in turn, and a loop of refusals leaves one error message
   *  standing for however many failed. */
  async function startAll() {
    const ready = runs.filter((r) => r.state === "notStarted" && r.planApproved);
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
      notifyWorkChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function checkMerge(run: Run) {
    setBusy(key(run));
    try {
      const preview = await previewRunMerge(run.id);
      setMerges((prev) => ({ ...prev, [run.id]: { preview, open: false } }));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function doMerge(run: Run) {
    setBusy(key(run));
    try {
      const outcome = await mergeRunBranch(run.id);
      setMerges((prev) => ({
        ...prev,
        [run.id]: { ...prev[run.id], outcome, open: !outcome.merged },
      }));
      setNotice(outcome.message);
      setError(null);
      await refresh();
      notifyWorkChanged();
    } catch (e) {
      // Most often "there are uncommitted files here" — a refusal to read, not
      // a failure to retry.
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function abortMerge(run: Run) {
    setBusy(key(run));
    try {
      await abortRunMerge(run.id);
      setMerges((prev) => ({ ...prev, [run.id]: { ...prev[run.id], open: false, outcome: undefined } }));
      setNotice("The merge was abandoned; the checkout is back as it was.");
      setError(null);
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
      notifyWorkChanged();
    } catch (e) {
      // Most often "it still holds uncommitted work", which is a refusal worth
      // reading rather than a failure to retry.
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const notStarted = runs.filter((r) => r.state === "notStarted").length;
  /// What "Start all" would actually start. Counting the unapproved ones in
  /// would offer a number that starts fewer runs than it names.
  const startable = runs.filter((r) => r.state === "notStarted" && r.planApproved).length;
  const waitingOnApproval = notStarted - startable;

  return (
    <section className="develop-card" aria-label="Runs">
      <h3>Runs</h3>
      <p className="hint">
        Each affected Solution runs in its own checkout on its own branch, so
        two work items on one repository never overwrite each other.
      </p>

      <div className="runs-actions">
        <button onClick={refresh}>Refresh</button>
        <button onClick={startAll} disabled={startable === 0 || busy !== null}>
          Start all ({startable})
        </button>
      </div>

      {/* Said once for the whole list rather than repeated per row: the fix is
          the same for all of them, and it is not here. */}
      {waitingOnApproval > 0 && (
        <p className="hint">
          {waitingOnApproval} more {waitingOnApproval === 1 ? "run is" : "runs are"}{" "}
          ready but {waitingOnApproval === 1 ? "its plan has" : "their plans have"}{" "}
          not been approved — approve on each work item's build plan.
        </p>
      )}

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

            {/* Bringing the branch home. Checking first is free and touches
                nothing, so the answer to "will this be a fight?" is available
                before anyone commits to finding out. */}
            {run.id !== 0 && run.branch.trim() !== "" && (
              <div className="run-merge">
                <button
                  aria-label={`Check merge for ${run.workItemTitle} on ${run.solutionName}`}
                  disabled={busy === key(run)}
                  onClick={() => checkMerge(run)}
                >
                  Check merge
                </button>

                {merges[run.id] && (
                  <MergeState
                    preview={merges[run.id].preview}
                    outcome={merges[run.id].outcome}
                    busy={busy === key(run)}
                    onMerge={() => doMerge(run)}
                    onAbort={() => abortMerge(run)}
                    label={`${run.workItemTitle} on ${run.solutionName}`}
                  />
                )}
              </div>
            )}

            <div className="run-buttons">
              {run.state === "notStarted" ? (
                <button
                  aria-label={`Start ${run.workItemTitle} on ${run.solutionName}`}
                  disabled={
                    busy === key(run) || run.branch.trim() === "" || !run.planApproved
                  }
                  onClick={() => start(run)}
                >
                  {busy === key(run)
                    ? "Preparing…"
                    : run.planApproved
                      ? "Start"
                      : "Needs an approved plan"}
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
