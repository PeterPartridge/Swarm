import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getAiConcurrency, listAiJobs, type AiJob, type Concurrency } from "../lib/backend";

const STATE_LABEL: Record<AiJob["state"], string> = {
  queued: "waiting",
  running: "running",
  done: "done",
  blocked: "asked a question",
  failed: "failed",
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

  useEffect(() => {
    const off = listen("ai-job-changed", () => void refresh());
    return () => {
      void off.then((f) => f());
    };
  }, [refresh]);

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
      {jobs.length === 0 && !error && (
        <p className="hint">Nothing submitted yet.</p>
      )}

      <ul className="job-list">
        {jobs.map((job) => (
          <li key={job.id} className={`job job-${job.state}`}>
            <span className={`job-state ${job.state}`}>{STATE_LABEL[job.state]}</span>
            <strong>{job.workItemTitle}</strong>
            {job.message && <span className="job-message">{job.message}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
