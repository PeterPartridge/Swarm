import { useCallback, useEffect, useState } from "react";
import {
  listAiFeedback,
  listAiJobs,
  resolveAiFeedback,
  type AiFeedback,
  type AiJob,
} from "../../lib/backend";
import { useWorkChanged } from "../../lib/workSignal";

/** Everything the AI has said about one work item, and what it was told back.
 *
 *  **Three different things, and only one of them is a question.**
 *
 *  - *Attempts that failed* — a run that broke, in the words it broke with.
 *    These lived only in the queue on another tab, so the panel about this
 *    item's AI could not say that its AI had failed.
 *  - *What it could not do* — `cantImplement`. A record of what happened, so it
 *    is a list and not a set of boxes: something you can type into invites
 *    correcting the account rather than answering it. What a developer adds is
 *    a separate field beside it — **how to solve it** — which is stored as the
 *    resolution and travels into the next attempt.
 *  - *Questions it asked* — `needsInformation` and the rest. A question wants an
 *    answer; a refusal wants a decision. Two lists, because they are two jobs.
 *
 *  Replaces `AiQuestions`, which showed only the middle third of this and
 *  called all of it "questions". */
export default function AiFeedbackPanel({
  workItemId,
  productId,
  onResolved,
}: {
  workItemId: number;
  /** The queue is per Product, so the failed attempts are read through it and
   *  filtered to this item. Without it the panel simply has no failures half. */
  productId?: number;
  onResolved?: () => void;
}) {
  const [feedback, setFeedback] = useState<AiFeedback[]>([]);
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedFeedback, loadedJobs] = await Promise.all([
        listAiFeedback(workItemId),
        productId === undefined ? Promise.resolve([]) : listAiJobs(productId),
      ]);
      setFeedback(loadedFeedback);
      setJobs(
        loadedJobs
          .filter((j) => j.workItemId === workItemId)
          .filter((j) => j.state === "failed" || j.state === "blocked")
          .sort((a, b) => b.submittedAt - a.submittedAt),
      );
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [workItemId, productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A job that fails while this is open should appear without being asked for.
  useWorkChanged(refresh);

  async function onAnswer(item: AiFeedback) {
    const note = (answers[item.id] ?? "").trim();
    if (!note) return;
    try {
      await resolveAiFeedback(item.id, note);
      setAnswers({ ...answers, [item.id]: "" });
      await refresh();
      onResolved?.();
    } catch (e) {
      setError(String(e));
    }
  }

  const cannot = feedback.filter((f) => f.kind === "cantImplement");
  const asked = feedback.filter((f) => f.kind !== "cantImplement");
  const nothing = jobs.length === 0 && feedback.length === 0;

  return (
    <section className="ai-feedback" aria-label="AI feedback">
      {error && <p role="alert">{error}</p>}

      {nothing && (
        <p className="hint">
          The AI has not reported anything on this item — no failed attempt, and
          nothing it could not do.
        </p>
      )}

      {jobs.length > 0 && (
        <div className="feedback-group">
          <span className="palette-label">Attempts that failed</span>
          <ul className="feedback-list" aria-label="Attempts that failed">
            {jobs.map((j) => (
              <li key={j.id}>
                <span className="feedback-kind">{j.purpose}</span>
                <span className="feedback-message">{j.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cannot.length > 0 && (
        <div className="feedback-group">
          <span className="palette-label">What the AI could not do</span>
          <ul className="feedback-list cannot" aria-label="What the AI could not do">
            {cannot.map((f) => (
              <li key={f.id}>
                {/* Read-only, deliberately: this is what it reported, and the
                    developer's half goes in the field below rather than over
                    the top of it. */}
                <span className="feedback-message">{f.message}</span>
                {f.whatIsNeeded && (
                  <span className="feedback-needed">{f.whatIsNeeded}</span>
                )}
                {f.resolved ? (
                  <span className="feedback-answer">
                    <strong>How to solve it: </strong>
                    {f.resolvedNote}
                  </span>
                ) : (
                  <span className="feedback-reply">
                    <input
                      aria-label={`How to solve: ${f.message}`}
                      placeholder="How to solve it — this goes into the next attempt"
                      value={answers[f.id] ?? ""}
                      onChange={(e) =>
                        setAnswers({ ...answers, [f.id]: e.target.value })
                      }
                    />
                    <button
                      aria-label={`Save how to solve: ${f.message}`}
                      onClick={() => void onAnswer(f)}
                    >
                      Save
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {asked.length > 0 && (
        <div className="feedback-group">
          <span className="palette-label">Questions the AI asked</span>
          <ul className="feedback-list" aria-label="Questions the AI asked">
            {asked.map((f) => (
              <li key={f.id}>
                <span className="feedback-message">{f.message}</span>
                {f.whatIsNeeded && (
                  <span className="feedback-needed">{f.whatIsNeeded}</span>
                )}
                {f.resolved ? (
                  <span className="feedback-answer">
                    <strong>Answered: </strong>
                    {f.resolvedNote}
                  </span>
                ) : (
                  <span className="feedback-reply">
                    <input
                      aria-label={`Answer AI question ${f.id}`}
                      placeholder="Answer it — this goes into the next attempt"
                      value={answers[f.id] ?? ""}
                      onChange={(e) =>
                        setAnswers({ ...answers, [f.id]: e.target.value })
                      }
                    />
                    <button
                      aria-label={`Save answer to AI question ${f.id}`}
                      onClick={() => void onAnswer(f)}
                    >
                      Save answer
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
