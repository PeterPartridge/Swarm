import { useCallback, useEffect, useMemo, useState } from "react";
import AiFeedbackPanel from "./AiFeedbackPanel";
import PreviewPanel from "../code/PreviewPanel";
import RunTerminal from "../code/RunTerminal";
import WorkItemBuildPlan from "../planning/WorkItemBuildPlan";
import WorkItemChanges from "../code/WorkItemChanges";
import { hueFor, markFor, PHASES, phaseOf, status, type Agent } from "./AgentLane";
import type { TestVerdict } from "./ReviewShipRail";
import { notifyWorkChanged, useWorkChanged } from "../../lib/workSignal";
import {
  listTestSuites,
  listWorkItemPlans,
  runSolutionTests,
  startRun,
  suggestDevCommand,
  type ChangeReview,
  type Run,
  type Solution,
  type SolutionSuites,
  type SuiteRun,
  type WorkItem,
} from "../../lib/backend";

/** One agent's sub-panels. `plan`, `scope` and `questions` exist for any agent;
 *  the rest need a checkout, so they only appear once there is a run. */
export type SubPanel =
  | "plan"
  | "changes"
  | "tests"
  | "scope"
  | "questions"
  | "preview"
  | "terminal";

/** A run that has been started here: what its terminals need to stay open. */
interface Started {
  worktreePath: string;
  command: string;
  runStart: string;
}

const LABELS: Record<SubPanel, string> = {
  plan: "Plan",
  changes: "Changes",
  tests: "Tests",
  scope: "Scope",
  questions: "AI feedback",
  preview: "Preview",
  terminal: "Run",
};

/** Which side of a diff a line is on. The `+++`/`---` headers name the file
 *  rather than changing it, so they are neither. */
function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "diff-header";
  if (line.startsWith("@@")) return "diff-hunk";
  if (line.startsWith("+")) return "diff-added";
  if (line.startsWith("-")) return "diff-removed";
  return "";
}

/** The workbench: everything about one agent, in sub-panels.
 *
 *  This is the half of the merge that made AI and Code one panel — an agent's
 *  plan, the code it changed, the tests it wrote, the running app and its shell
 *  used to be five places, and chasing one agent across all five was the actual
 *  complaint.
 *
 *  Which sub-panels exist depends on how far the agent has got, rather than
 *  showing seven tabs where four cannot work yet: a plan and its questions exist
 *  as soon as it is queued, while changes, tests, a preview and a terminal all
 *  need a checkout, which only a started run has. */
export default function AgentJobPanel({
  agent,
  item,
  run,
  solutions,
  onRunChanged,
  review,
  reviewing,
  onReview,
  selectedPath,
  onSelectFile,
  onTests,
}: {
  /** The lane row this workbench is showing, for the header. */
  agent: Agent | null;
  /** The work item the agent is working on. */
  item: WorkItem;
  /** Its execution run, when there is one. Null for an agent still planning. */
  run: Run | null;
  /** The Product's Solutions, for the plan and scope panels. */
  solutions: Solution[];
  /** Called after starting a run, so the lane's state catches up. */
  onRunChanged: () => void;
  /** The change review, owned by the Build view so the workbench and the ship
   *  rail read the same one rather than each running git for itself. */
  review: ChangeReview | null;
  reviewing: boolean;
  onReview: () => void;
  /** The file picked in the tree, whose diff opens first. */
  selectedPath: string | null;
  onSelectFile: (solutionId: number, path: string) => void;
  /** Reports what the tests said, so the ship rail can read it back. */
  onTests: (verdict: TestVerdict) => void;
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
  const [suites, setSuites] = useState<SolutionSuites | null>(null);
  const [suiteRuns, setSuiteRuns] = useState<SuiteRun[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [openSuite, setOpenSuite] = useState<string | null>(null);

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
        ? ["plan", "changes", "tests", "preview", "terminal", "scope", "questions"]
        : ["plan", "questions"],
    [prepared],
  );

  // A sub-panel that stops being available must not stay selected, or switching
  // agents would land on a blank pane.
  useEffect(() => {
    if (!available.includes(panel)) setPanel("plan");
  }, [available, panel]);

  // Picking a file in the tree is a request to see its diff — that linkage is
  // the reason the tree and the workbench sit side by side.
  useEffect(() => {
    if (selectedPath !== null && available.includes("changes")) setPanel("changes");
  }, [selectedPath, available]);

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
  }, [loadApproval]);

  // Was keyed to `panel`, which meant a query on every sub-panel switch and
  // still nothing when approval changed while the Plan tab was open. Following
  // the signal is both fewer reads and more correct.
  useWorkChanged(loadApproval);

  /// This Solution's test suites, so the Tests panel can say what it would run
  /// before anybody runs it.
  const loadSuites = useCallback(async () => {
    if (run === null) return;
    try {
      const groups = await listTestSuites(item.productId);
      setSuites(groups.find((g) => g.solutionId === run.solutionId) ?? null);
    } catch {
      setSuites(null);
    }
  }, [run, item.productId]);

  useEffect(() => {
    if (panel === "tests") void loadSuites();
  }, [panel, loadSuites]);

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
      notifyWorkChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runTests() {
    if (run === null) return;
    setTesting(true);
    try {
      const results = await runSolutionTests(run.solutionId);
      setSuiteRuns(results);
      setError(null);
      // Counts only when they were read. A run known solely by its exit code
      // reports pass or fail and no numbers — an invented test count would be
      // worse than none.
      const counted = results.every((r) => r.counted);
      onTests({
        passed: results.reduce((n, r) => n + r.passed, 0),
        failed: counted
          ? results.reduce((n, r) => n + r.failed, 0)
          : results.filter((r) => !r.exitOk).length,
        counted,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setTesting(false);
    }
  }

  const solution = solutions.find((s) => s.id === run?.solutionId) ?? null;
  const badge = agent ? status(agent) : null;
  const phase = agent ? phaseOf(agent) : 0;
  const hue = hueFor(run?.solutionId ?? null);
  const files = review?.changes ?? [];
  const activeFile =
    files.find((f) => f.path === selectedPath) ?? files[0] ?? null;

  return (
    <section className="workbench" aria-label={`Agent for ${item.title}`}>
      <header className="workbench-head" style={{ "--agent-hue": hue } as React.CSSProperties}>
        <span className="workbench-avatar">
          {run ? markFor(run.solutionName) : "··"}
        </span>
        <div className="workbench-who">
          <div className="workbench-title">
            <span className="workbench-ticket">#{item.id}</span>
            <strong>{item.title}</strong>
          </div>
          <div className="workbench-meta">
            <span>{run ? run.solutionName : "no Solution yet"}</span>
            <span aria-hidden="true">·</span>
            <span>{PHASES[phase]}</span>
            {run?.worktreePath && (
              <>
                <span aria-hidden="true">·</span>
                <span className="card-mono">{run.worktreePath}</span>
              </>
            )}
          </div>
        </div>
        {badge && <span className={`card-status ${badge.tone}`}>{badge.text}</span>}
      </header>

      <div className="workbench-tabs" role="tablist" aria-label="Agent sub-panels">
        {available.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={panel === p}
            className={panel === p ? "workbench-tab on" : "workbench-tab"}
            style={{ "--agent-hue": hue } as React.CSSProperties}
            onClick={() => setPanel(p)}
          >
            {LABELS[p]}
            {p === "changes" && review && (
              <span className="tab-badge">{review.report.filesChanged}</span>
            )}
            {p === "questions" && agent && agent.questions > 0 && (
              <span className="tab-badge">{agent.questions}</span>
            )}
          </button>
        ))}
      </div>

      {error && <p role="alert">{error}</p>}


      <div className="workbench-panel">
        {panel === "plan" && <WorkItemBuildPlan item={item} solutions={solutions} />}

        {panel === "changes" && (
          <div className="changes-pane">
            <div className="changes-files">
              {files.length === 0 ? (
                <p className="hint">
                  {review === null
                    ? "Nothing read yet — press Review what changed in the rail."
                    : "Nothing has changed in this working copy."}
                </p>
              ) : (
                files.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    className={`change-chip ${activeFile?.path === f.path ? "on" : ""}`}
                    aria-pressed={activeFile?.path === f.path}
                    onClick={() => run && onSelectFile(run.solutionId, f.path)}
                  >
                    <span className={`change-status ${f.status}`}>
                      {f.status.charAt(0).toUpperCase()}
                    </span>
                    <span className="card-mono">{f.path.split("/").pop()}</span>
                    <span className="ok">+{f.addedLines}</span>
                    <span className="bad">−{f.removedLines}</span>
                  </button>
                ))
              )}
            </div>

            {activeFile && (
              <>
                <p className="changes-path card-mono">{activeFile.path}</p>
                {/* Coloured by line, not syntax-highlighted: what a reviewer
                    needs first is which lines arrived and which left, and that
                    is a per-line fact. */}
                <pre className="change-diff">
                  {activeFile.diff.split("\n").map((line, n) => (
                    <span key={n} className={diffLineClass(line)}>
                      {line}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              </>
            )}

            <button type="button" onClick={onReview} disabled={reviewing || run === null}>
              {reviewing ? "Reading…" : review === null ? "Review what changed" : "Read it again"}
            </button>
          </div>
        )}

        {panel === "tests" && run !== null && (
          <div className="tests-pane">
            <div className="tests-head">
              <strong>
                {suiteRuns === null
                  ? "Not run in this session"
                  : suiteRuns.every((r) => r.counted)
                    ? `${suiteRuns.reduce((n, r) => n + r.passed, 0)} passed · ${suiteRuns.reduce(
                        (n, r) => n + r.failed,
                        0,
                      )} failed`
                    : suiteRuns.every((r) => r.exitOk)
                      ? "Passed — by exit code"
                      : "Failed — by exit code"}
              </strong>
              <button type="button" onClick={runTests} disabled={testing}>
                {testing ? "Running…" : "Run the tests"}
              </button>
            </div>

            {suites?.unavailable && <p className="hint">{suites.unavailable}</p>}
            {suites && suites.suites.length === 0 && !suites.unavailable && (
              <p className="hint">
                Nothing here looks like a test suite. Set a command for this
                Solution in Tests if detection is wrong.
              </p>
            )}

            <ul className="test-list">
              {(suiteRuns ?? []).map((r, i) => {
                const key = `${r.suite.kind}-${r.suite.directory}-${i}`;
                const open = openSuite === key;
                return (
                  <li key={key} className={r.exitOk ? "suite pass" : "suite fail"}>
                    <button
                      type="button"
                      className="suite-head"
                      aria-expanded={open}
                      onClick={() => setOpenSuite(open ? null : key)}
                    >
                      <span className="suite-mark" aria-hidden="true">
                        {r.exitOk ? "✓" : "✕"}
                      </span>
                      <span className="card-mono suite-name">{r.suite.commandLine}</span>
                      <span className="suite-tag">{r.suite.kind}</span>
                      {/* Counts appear only when they were read. */}
                      {r.counted && (
                        <span className="suite-counts">
                          {r.passed}/{r.passed + r.failed + r.skipped}
                        </span>
                      )}
                      <span className="suite-ms">{r.durationMs}ms</span>
                    </button>
                    {open && (
                      <div className="suite-body">
                        {r.tests.length > 0 && (
                          <ul className="test-outcomes">
                            {r.tests.map((t) => (
                              <li key={t.name} className={t.state}>
                                <span aria-hidden="true">
                                  {t.state === "passed" ? "✓" : t.state === "failed" ? "✕" : "·"}
                                </span>
                                <span className="card-mono">{t.name}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <pre className="suite-output">{r.output}</pre>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* The Product goes down here too. Without it this panel shows the
            Solution dropdown and no way to make one — the same dead end the
            build plan had, in the other place the same component is used. */}
        {panel === "scope" && (
          <WorkItemChanges
            workItemId={item.id}
            mode="developer"
            solutions={solutions}
            productId={item.productId}
          />
        )}

        {panel === "questions" && (
          <div className="agent-questions">
            {/* The run, so this shows the round record the agent wrote in its
                own checkout — the account that used to stay in its terminal. */}
            <AiFeedbackPanel
              workItemId={item.id}
              productId={item.productId}
              runId={run?.id}
            />
            <p className="hint">
              An answer is stored against this work item and travels with the next
              prompt for it, so the same question is not asked — or paid for —
              twice.
            </p>
          </div>
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
              {solution?.name ? ` It belongs to ${solution.name}.` : ""}
            </p>
          )
        )}
      </div>

      {/* Said where the missing sub-panels would be, rather than leaving their
          absence to be worked out. */}
      {run !== null && !prepared && (
        <div className="agent-not-started">
          <p className="hint">
            Changes, tests, preview and a terminal appear once this run has its own
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
          This agent is planning. Tick the affected Solutions on the plan above
          and a run appears for each.
        </p>
      )}
    </section>
  );
}
