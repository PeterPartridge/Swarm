import { useCallback, useEffect, useState } from "react";
import { notifyWorkChanged, useWorkChanged } from "../../lib/workSignal";
import {
  listOpenQuestions,
  resolveAiFeedback,
  type OpenQuestion,
} from "../../lib/backend";

/** What the AI is waiting on you for, across the whole Product.
 *
 *  The escape hatch only pays for itself if the question is easy to find. Per
 *  work item, an agent that declined and asked something is indistinguishable
 *  from one that has not run yet until you open the item — so with several
 *  agents planning at once, the questions have to be in one list.
 *
 *  **The answer is not just an acknowledgement.** It becomes a clarification on
 *  the work item, carried into the next prompt for it, which is what makes
 *  answering worth doing rather than a box to dismiss. */
export default function QuestionsPanel({ productId }: { productId: number }) {
  const [questions, setQuestions] = useState<OpenQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setQuestions(await listOpenQuestions(productId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A job finishing is how a question arrives, so the list follows the signal
  // rather than being polled.
  useWorkChanged(refresh);

  async function answer(question: OpenQuestion) {
    const note = (answers[question.id] ?? "").trim();
    if (note === "") return;
    setBusy(question.id);
    try {
      await resolveAiFeedback(question.id, note);
      setAnswers((prev) => ({ ...prev, [question.id]: "" }));
      setNotice(
        `Answered. It travels with ${question.workItemTitle} the next time the AI is asked about it.`,
      );
      setError(null);
      await refresh();
      // An answered question is what unblocks that work item, so the queue and
      // the agent rail want to hear about it too.
      notifyWorkChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="develop-card" aria-label="Questions">
      <h3>
        Questions{questions.length > 0 ? ` (${questions.length})` : ""}
      </h3>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {questions.length === 0 ? (
        <p className="hint">
          Nothing is waiting on you. An agent that finds a work item too vague to
          build stops and asks here rather than guessing.
        </p>
      ) : (
        <ul className="question-list">
          {questions.map((q) => (
            <li key={q.id} className="question">
              <div className="question-head">
                <strong>{q.workItemTitle}</strong>
                <span className="question-kind">{q.kind}</span>
              </div>
              <p className="question-message">{q.message}</p>
              {q.whatIsNeeded && (
                // The actionable half: what would unblock it.
                <p className="question-needed">{q.whatIsNeeded}</p>
              )}
              <div className="question-answer">
                <input
                  aria-label={`Answer to: ${q.message}`}
                  placeholder="Your answer…"
                  value={answers[q.id] ?? ""}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                  }
                />
                <button
                  aria-label={`Send answer for ${q.workItemTitle}`}
                  disabled={busy === q.id || (answers[q.id] ?? "").trim() === ""}
                  onClick={() => answer(q)}
                >
                  {busy === q.id ? "Sending…" : "Answer"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
