import { useCallback, useEffect, useState } from "react";
import { useWorkChanged } from "../../lib/workSignal";
import { listAiJobs, type AiJob } from "../../lib/backend";

/** When a job stopped, in the shortest form that is still unambiguous. */
function when(job: AiJob): string {
  const at = job.finishedAt ?? job.startedAt ?? job.submittedAt;
  if (!at) return "—";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

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
export default function RuleEnforcement({ productId }: { productId: number }) {
  const [jobs, setJobs] = useState<AiJob[]>([]);
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

  const stopped = jobs
    .filter((j) => j.state === "blocked" || j.state === "failed")
    .sort((a, b) => (b.finishedAt ?? b.submittedAt) - (a.finishedAt ?? a.submittedAt));

  return (
    <aside className="rule-enforcement" aria-label="Where agents stopped">
      <div className="enforce-head">
        <strong>Where agents stopped</strong>
        <p className="hint">
          Read from the job queue. The app does not count how often a rule
          fired, so this is what actually happened rather than a score.
        </p>
      </div>

      {error && <p role="alert">{error}</p>}

      {stopped.length === 0 ? (
        <p className="hint">
          Nothing has stopped in this Product. A job that comes back blocked or
          failed appears here with the reason it gave.
        </p>
      ) : (
        <ul className="enforce-list">
          {stopped.map((job) => (
            <li key={job.id} className={job.state}>
              <div className="enforce-top">
                <span className={`enforce-state ${job.state}`}>{job.state}</span>
                <span className="enforce-item">{job.workItemTitle}</span>
                <span className="enforce-when">{when(job)}</span>
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
