import { useCallback, useEffect, useState } from "react";
import { notifyWorkChanged, useWorkChanged } from "../../lib/workSignal";
import {
  cancelAiJob,
  getAiConcurrency,
  listAiJobs,
  type AiJob,
  type Concurrency,
} from "../../lib/backend";

const STATE_LABEL: Record<AiJob["state"], string> = {
  queued: "waiting",
  running: "running",
  done: "done",
  blocked: "asked a question",
  failed: "failed",
  // Said as a choice somebody made, not as a fault — the two want different
  // reactions and only one is worth looking into.
  cancelled: "stopped",
};

/** Everything submitted to the AI, so you can queue one and carry on.
 *
 *  The queue is the point: submit a work item, watch it start, submit another
 *  while the first runs. The list is re-read on every `ai-job-changed` event
 *  rather than polled — nothing in the event is trusted, so an event that
 *  arrives out of order still shows the true current state. */
export default function JobsPanel({ productId }: { productId: number }) {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [concurrency, setConcurrency] = useState<Concurrency | null>(null);
  const [error, setError] = useState<string | null>(null);
  /// What cancelling actually did. Kept and shown rather than dropped, because
  /// "queued, so nothing was spent" and "already in flight, so it may still be
  /// charged" are different facts and only the backend knows which happened.
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loaded, limit] = await Promise.all([
        listAiJobs(productId),
        getAiConcurrency(),
      ]);
      setJobs(loaded);
      setConcurrency(limit);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useWorkChanged(refresh);

  async function cancel(job: AiJob) {
    setCancelling(job.id);
    try {
      // The backend's own words: only it knows whether this was still queued or
      // already in flight, and that is exactly the difference worth telling.
      setNotice(await cancelAiJob(job.id));
      setError(null);
      await refresh();
      // A stopped job frees a slot and may unblock a run, neither of which the
      // panels beside this one would otherwise hear about.
      notifyWorkChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setCancelling(null);
    }
  }

  const running = jobs.filter((j) => j.state === "running").length;
  const waiting = jobs.filter((j) => j.state === "queued").length;

  return (
    <section className="develop-card" aria-label="AI queue">
      <h3>AI queue</h3>
      {concurrency && (
        <p className="hint">
          {running} running, {waiting} waiting.{" "}
          {concurrency.limit === 1
            ? "One at a time — raise the limit in Admin to run more together."
            : `Up to ${concurrency.limit} at once (${concurrency.available} free).`}
        </p>
      )}

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {jobs.length === 0 && !error && (
        <p className="hint">Nothing submitted yet.</p>
      )}

      <ul className="job-list">
        {jobs.map((job) => (
          <li key={job.id} className={`job job-${job.state}`}>
            <span className={`job-state ${job.state}`}>{STATE_LABEL[job.state]}</span>
            <strong>{job.workItemTitle}</strong>
            {job.message && <span className="job-message">{job.message}</span>}
            {/* Only while there is something to stop. A finished job's button
                would do nothing but say so, which is worse than not being
                there. */}
            {(job.state === "queued" || job.state === "running") && (
              <button
                aria-label={`Stop ${job.workItemTitle}`}
                disabled={cancelling === job.id}
                onClick={() => cancel(job)}
              >
                {cancelling === job.id ? "Stopping…" : "Stop"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
