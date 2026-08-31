import { useCallback, useEffect, useState } from "react";
import { useWorkChanged } from "../../lib/workSignal";
import { listAiJobs, type AiJob } from "../../lib/backend";
import { whenStopped } from "../../lib/when";

/** Where agents got stopped — the real version.
 *
 *  The design this came from listed rule violations with outcomes like
 *  "Rewrote the plan itself, then passed" and per-rule counts like "212 checks ·
 *  4 blocks this week". **Nothing in this app counts that.** What it does hold
 *  is the job queue, and a job that came back `blocked` or `failed` is exactly
 *  an agent that stopped — with the reason it gave, in its own words.
 *
 *  So this is the same panel answering the same question from the records that
 *  exist: which agents stopped, on what, when, and what they said. A blocked job
 *  is not always a rule that bit — it is more often a missing acceptance
 *  criterion — so the panel says "stopped", not "violated". */
/** How far back to look. The design said "this week"; showing every job ever
 *  made the panel a history rather than a state of play, so a week is the
 *  default and "all" is a press away. */
const WINDOWS = [
  { id: "week", label: "Last 7 days", days: 7 },
  { id: "month", label: "Last 30 days", days: 30 },
  { id: "all", label: "All", days: 0 },
] as const;

export default function RuleEnforcement({ productId }: { productId: number }) {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [window, setWindow] = useState<(typeof WINDOWS)[number]["id"]>("week");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setJobs(await listAiJobs(productId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useWorkChanged(refresh);

  const days = WINDOWS.find((w) => w.id === window)?.days ?? 0;
  const since = days === 0 ? 0 : Date.now() - days * 24 * 60 * 60 * 1000;
  const allStopped = jobs.filter((j) => j.state === "blocked" || j.state === "failed");
  const stopped = allStopped
    .filter((j) => (j.finishedAt ?? j.submittedAt) >= since)
    .sort((a, b) => (b.finishedAt ?? b.submittedAt) - (a.finishedAt ?? a.submittedAt));
  const older = allStopped.length - stopped.length;

  return (
    <aside className="rule-enforcement" aria-label="Where agents stopped">
      <div className="enforce-head">
        <strong>Where agents stopped</strong>
        <p className="hint">
          Read from the job queue. The app does not count how often a rule
          fired, so this is what actually happened rather than a score.
        </p>
      </div>

      <div className="enforce-windows" role="group" aria-label="How far back">
        {WINDOWS.map((w) => (
          <button
            key={w.id}
            type="button"
            className={window === w.id ? "enforce-window on" : "enforce-window"}
            aria-pressed={window === w.id}
            onClick={() => setWindow(w.id)}
          >
            {w.label}
          </button>
        ))}
      </div>

      {error && <p role="alert">{error}</p>}

      {stopped.length === 0 ? (
        <p className="hint">
          {older > 0
            ? `Nothing in this window. ${older} older ${older === 1 ? "job" : "jobs"} stopped — widen it to see them.`
            : "Nothing has stopped in this Product. A job that comes back blocked or failed appears here with the reason it gave."}
        </p>
      ) : (
        <ul className="enforce-list">
          {stopped.map((job) => (
            <li key={job.id} className={job.state}>
              <div className="enforce-top">
                <span className={`enforce-state ${job.state}`}>{job.state}</span>
                <span className="enforce-item">{job.workItemTitle}</span>
                <span className="enforce-when">{whenStopped(job)}</span>
              </div>
              <p className="enforce-why">
                {job.message.trim() === "" ? "No reason recorded." : job.message}
              </p>
              <span className="enforce-purpose">{job.purpose}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
