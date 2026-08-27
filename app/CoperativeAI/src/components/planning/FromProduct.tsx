import { useEffect, useState } from "react";
import {
  changeKinds,
  kindLabel,
  listWorkItemChanges,
  type AiFeedback,
  type ChangeKindInfo,
  type WorkItem,
  type WorkItemChange,
} from "../../lib/backend";

/** What Product asked for, as a developer sees it — read-only — and the
 *  conversation with them about it.
 *
 *  **Read-only because Product owns this side.** Product sets what customers
 *  get: what the work is, what it is worth, which screens they want. Develop
 *  decides how it is built. A developer needs every word of the first and must
 *  not be able to quietly reword it — a requirement edited by the person
 *  implementing it stops being a requirement.
 *
 *  **The questions are the way across that line.** Rather than a form at the
 *  bottom of the build plan, they read as a conversation: what was asked, and
 *  what came back. Each answer becomes a clarification on the work item, so it
 *  reaches the AI without anyone re-typing it. */
export default function FromProduct({
  item,
  questions,
  onAsk,
  onAnswer,
}: {
  item: WorkItem;
  questions: AiFeedback[];
  onAsk: (question: string) => void;
  onAnswer: (id: number, answer: string) => void;
}) {
  const [wanted, setWanted] = useState<WorkItemChange[]>([]);
  const [vocabulary, setVocabulary] = useState<ChangeKindInfo[]>([]);
  const [asking, setAsking] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});

  useEffect(() => {
    // Read, never written, from here. A failure leaves the list empty and the
    // rest of the panel working — the conversation is the part that matters.
    void Promise.all([listWorkItemChanges(item.id), changeKinds()])
      .then(([changes, kinds]) => {
        setWanted(changes);
        setVocabulary(kinds);
      })
      .catch(() => setWanted([]));
  }, [item.id]);

  const described = (item.description ?? "").trim();

  return (
    <section className="from-product" aria-label={`What Product asked for on ${item.title}`}>
      <h3>What Product asked for</h3>

      <div className="field">
        <span>What it is</span>
        {described === "" ? (
          // Said out loud. Silence here reads as "Product had nothing to say",
          // which is a different and much more comfortable thing than "nobody
          // has written this down yet".
          <p className="hint">Product has not described this yet.</p>
        ) : (
          <p className="product-said">{described}</p>
        )}
      </div>

      {item.risk.trim() !== "" && (
        <div className="field">
          <span>What could go wrong</span>
          <p className="product-said">{item.risk}</p>
        </div>
      )}

      <div className="field">
        <span>Asked for</span>
        {wanted.length === 0 ? (
          <p className="hint">Nothing has been asked for on this item yet.</p>
        ) : (
          <ul className="product-wanted">
            {wanted.map((c) => (
              <li key={c.id}>
                <strong>{kindLabel(vocabulary, c.kind)}: {c.name}</strong>
                {c.detail.trim() !== "" && <span> — {c.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* `log` rather than `list`: it is a conversation that grows, and a
          screen reader should read new entries as they arrive. */}
      <div className="product-chat" role="log" aria-label="Questions for Product">
        {questions.length === 0 && (
          <p className="hint">
            Nothing has been asked yet. A question here becomes a clarification
            on the work item, so the answer reaches the AI without anyone
            re-typing it.
          </p>
        )}
        {questions.map((q) => (
          <div key={q.id} className="chat-exchange">
            <p className="chat-asked">{q.message}</p>
            {q.resolved ? (
              <p className="chat-answered">{q.resolvedNote}</p>
            ) : (
              <div className="chat-reply">
                <input
                  aria-label={`Answer: ${q.message}`}
                  placeholder="Product's answer"
                  value={answers[q.id] ?? ""}
                  onChange={(e) =>
                    setAnswers({ ...answers, [q.id]: e.target.value })
                  }
                />
                <button
                  aria-label={`Save answer to: ${q.message}`}
                  disabled={(answers[q.id] ?? "").trim() === ""}
                  onClick={() => {
                    onAnswer(q.id, answers[q.id] ?? "");
                    setAnswers({ ...answers, [q.id]: "" });
                  }}
                >
                  Answer
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="ask-product">
        <input
          aria-label={`Ask Product about ${item.title}`}
          placeholder="What should happen when payment fails?"
          value={asking}
          onChange={(e) => setAsking(e.target.value)}
        />
        <button
          aria-label="Ask Product"
          disabled={asking.trim() === ""}
          onClick={() => {
            onAsk(asking);
            setAsking("");
          }}
        >
          Ask
        </button>
      </div>
    </section>
  );
}
