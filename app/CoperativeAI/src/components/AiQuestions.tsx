import { useCallback, useEffect, useState } from "react";
import {
  listAiFeedback,
  resolveAiFeedback,
  type AiFeedback,
} from "../lib/backend";

/** Questions the AI raised against a work item instead of guessing at it.
 *  Answering one stores the clarification, which then travels with the next
 *  prompt for this item — so the same question is not asked, and paid for,
 *  twice. */
export default function AiQuestions({
  workItemId,
  onResolved,
}: {
  workItemId: number;
  onResolved?: () => void;
}) {
  const [feedback, setFeedback] = useState<AiFeedback[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setFeedback(await listAiFeedback(workItemId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [workItemId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const open = feedback.filter((f) => !f.resolved);
  const answered = feedback.filter((f) => f.resolved);

  if (feedback.length === 0) return null;

  return (
    <section className="ai-questions" aria-label="AI questions">
      {error && <p role="alert">{error}</p>}

      {open.map((item) => (
        <div key={item.id} className="ai-question open" aria-label={`AI question ${item.id}`}>
          <p className="question-message">
            <strong>The AI stopped rather than guessing:</strong> {item.message}
          </p>
          {item.whatIsNeeded && (
            <p className="question-needed">{item.whatIsNeeded}</p>
          )}
          <div className="question-answer">
            <input
              aria-label={`Answer AI question ${item.id}`}
              placeholder="Answer it — this goes into the next attempt"
              value={answers[item.id] ?? ""}
              onChange={(e) =>
                setAnswers({ ...answers, [item.id]: e.target.value })
              }
            />
            <button
              aria-label={`Save answer to AI question ${item.id}`}
              onClick={() => onAnswer(item)}
            >
              Save answer
            </button>
          </div>
        </div>
      ))}

      {answered.length > 0 && (
        <details className="answered-questions">
          <summary>Answered ({answered.length})</summary>
          <ul>
            {answered.map((item) => (
              <li key={item.id}>
                <em>{item.message}</em> — {item.resolvedNote}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
