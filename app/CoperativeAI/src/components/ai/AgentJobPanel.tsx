import { useCallback, useEffect, useMemo, useState } from "react";
import AiQuestions from "./AiQuestions";
import PreviewPanel from "../code/PreviewPanel";
import RunTerminal from "../code/RunTerminal";
import WorkItemBuildPlan from "../planning/WorkItemBuildPlan";
import WorkItemChanges from "../code/WorkItemChanges";
import {
  listWorkItemPlans,
  startRun,
  suggestDevCommand,
  type Run,
  type Solution,
  type WorkItem,
} from "../../lib/backend";

/** One agent's sub-panels. `plan` and `questions` exist for any agent; the rest
 *  need a checkout, so they only appear once there is a run. */
export type SubPanel = "plan" | "changes" | "questions" | "preview" | "terminal";

/** A run that has been started here: what its terminals need to stay open. */
interface Started {
  worktreePath: string;
  command: string;
  runStart: string;
}

const LABELS: Record<SubPanel, string> = {
  plan: "Plan",
  changes: "Changes",
  questions: "Questions",
  preview: "Preview",
  terminal: "Terminal",
};

/** Everything about one agent, in sub-panels.
 *
 *  This is the half of the merge that made AI and Code one panel: an agent's
 *  plan, the code it changed, the questions it stopped on, the running app, and
 *  its shell used to be five places — the build plan in Work, diffs in Code,
 *  questions in AI, the app in a browser, the terminal wherever it was opened.
 *  Chasing one agent across all five was the actual complaint.
 *
 *  Which sub-panels exist depends on how far the agent has got, rather than
 *  showing five tabs where three cannot work yet: a plan and its questions exist
 *  as soon as it is queued, while changes, a preview and a terminal all need a
 *  checkout, which only a started run has. */
export default function AgentJobPanel({
  item,
  run,
  solutions,
  onRunChanged,
}: {
  /** The work item the agent is working on. */
  item: WorkItem;
  /** Its execution run, when there is one. Null for an agent still planning. */
  run: Run | null;
  /** The Product's Solutions, for the plan and changes panels. */
  solutions: Solution[];
  /** Called after starting a run, so the rail's state catches up. */
  onRunChanged: () => void;
}) {
  const [panel, setPanel] = useState<SubPanel>("plan");
  const [started, setStarted] = useState<Started | null>(null);
  const [runCommand, setRunCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// Whether this run's plan has been approved. The backend refuses to start
  /// without it either way — this is so the button can say so before the press
  /// rather than after it.
  const [planApproved, setPlanApproved] = useState<boolean | null>(null);

  // `started` counts as prepared on its own, and not only because it is quicker
  // than a refresh: the run row this panel was handed is a snapshot from before
  // the press, so waiting for the list to catch up would take the terminal that
  // was just opened away again and drop the selection back to the plan.
  const prepared =
    started !== null ||
    (run !== null && run.state !== "notStarted" && run.worktreePath !== "");

  const available: SubPanel[] = useMemo(
    () =>
      prepared
        ? ["plan", "changes", "questions", "preview", "terminal"]
        : ["plan", "questions"],
    [prepared],
  );

  // A sub-panel that stops being available must not stay selected, or switching
  // agents would land on a blank pane.
  useEffect(() => {
    if (!available.includes(panel)) setPanel("plan");
  }, [available, panel]);

  /// Read for the preview's port guess only — a wrong guess is corrected in the
  /// preview itself, so failing to read it is not worth an error.
  const loadRunCommand = useCallback(async () => {
    if (run === null) return;
    try {
      const dev = await suggestDevCommand(run.solutionId);
      setRunCommand(dev.start ?? "");
    } catch {
      setRunCommand("");
    }
  }, [run]);

  useEffect(() => {
    void loadRunCommand();
  }, [loadRunCommand]);

  /// Reloaded whenever the plan panel might have changed it, so approving on
  /// the Plan tab and coming back to Start does not need a refresh.
  const loadApproval = useCallback(async () => {
    if (run === null) return;
    try {
      const plans = await listWorkItemPlans(run.workItemId);
      const mine = plans.find((p) => p.solutionId === run.solutionId);
      setPlanApproved(mine ? mine.approvedAt > 0 : false);
    } catch {
      // Unknown rather than false: refusing to offer Start because a lookup
      // failed would be a worse guess than letting the backend answer.
      setPlanApproved(null);
    }
  }, [run]);

  useEffect(() => {
    void loadApproval();
  }, [loadApproval, panel]);

  // Starting is still a press. An app that silently launched something which
  // writes files would be doing the one thing this design keeps deliberate.
  async function start() {
    if (run === null) return;
    setBusy(true);
    try {
      const p = await startRun(run.workItemId, run.solutionId);
      setStarted({
        worktreePath: p.worktreePath,
        command: p.command,
        runStart: p.runStart,
      });
      setPanel("terminal");
      setError(null);
      onRunChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="agent-job" aria-label={`Agent for ${item.title}`}>
      <header className="agent-job-head">
        <div>
          <strong>{item.title}</strong>
          {run && <span className="run-solution">→ {run.solutionName}</span>}
        </div>
        {run && (
          <div className="agent-job-meta">
            <span className="run-branch">{run.branch || "no branch set"}</span>
            <span className={`run-state ${run.state}`}>
              {run.state === "notStarted" ? "ready" : run.state}
            </span>
          </div>
        )}
      </header>

      <nav role="tablist" aria-label="Agent sub-panels" className="agent-subtabs">
        {available.map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={panel === p}
            className={panel === p ? "view-active" : ""}
            onClick={() => setPanel(p)}
          >
            {LABELS[p]}
          </button>
        ))}
      </nav>

      {error && <p role="alert">{error}</p>}

      {/* Said where the missing sub-panels would be, rather than leaving their
          absence to be worked out. */}
      {run !== null && !prepared && (
        <div className="agent-not-started">
          <p className="hint">
            Changes, preview and a terminal appear once this run has its own
            checkout. Starting makes one on <code>{run.branch || "its branch"}</code>.
          </p>
          {planApproved === false && (
            <p className="hint">
              The plan needs approving first — read it on the Plan tab and press
              Approve there. Editing it afterwards asks again.
            </p>
          )}
          <button
            aria-label={`Start ${item.title} on ${run.solutionName}`}
            // `null` means the lookup failed, and refusing on a failed lookup
            // would be a worse guess than letting the backend answer.
            disabled={busy || run.branch.trim() === "" || planApproved === false}
            onClick={start}
          >
            {busy ? "Preparing…" : "Start this run"}
          </button>
        </div>
      )}

      {run === null && (
        <p className="hint">
          This agent is planning. Tick the affected Solutions on the plan below
          and a run appears for each.
        </p>
      )}

      <div className="agent-subpanel">
        {panel === "plan" && <WorkItemBuildPlan item={item} solutions={solutions} />}

        {panel === "questions" && (
          <div className="agent-questions">
            <AiQuestions workItemId={item.id} />
            <p className="hint">
              An answer is stored against this work item and travels with the next
              prompt for it, so the same question is not asked — or paid for —
              twice.
            </p>
          </div>
        )}

        {panel === "changes" && (
          <WorkItemChanges workItemId={item.id} mode="developer" solutions={solutions} />
        )}

        {panel === "preview" && run !== null && (
          <PreviewPanel
            solutionId={run.solutionId}
            runCommand={runCommand}
            label={`${item.title} → ${run.solutionName}`}
          />
        )}

        {panel === "terminal" && run !== null && (
          started ? (
            <div className="run-terminal-pair">
              <RunTerminal
                solutionId={run.solutionId}
                worktreePath={started.worktreePath}
                command={started.command}
                title={`${item.title} → ${run.solutionName}`}
                onClose={() => setStarted(null)}
              />
              {started.runStart && (
                <RunTerminal
                  solutionId={run.solutionId}
                  worktreePath={started.worktreePath}
                  command={started.runStart}
                  title={`${item.title} → ${run.solutionName} — app`}
                  onClose={() =>
                    setStarted({ ...started, runStart: "" })
                  }
                />
              )}
            </div>
          ) : (
            <p className="hint">
              This run has a checkout at <code>{run.worktreePath}</code>, but no
              shell open in this window. Start it again to open one — the checkout
              and its commits are kept either way.
            </p>
          )
        )}
      </div>
    </section>
  );
}
