import { useCallback, useEffect, useState } from "react";
import WorkItemLifecycle from "../planning/WorkItemLifecycle";
import AiFeedbackPanel from "../ai/AiFeedbackPanel";
import {
  askProductQuestion,
  listWorkItems,
  updateWorkItemStatus,
  STATUSES,
  TYPE_LABELS,
  type WorkItem,
} from "../../lib/backend";
import { notifyWorkChanged, useWorkChanged } from "../../lib/workSignal";

/** The work in front of QA, and the part of each item's life QA owns.
 *
 *  **QA had no work items at all.** The area held a testing strategy and a list
 *  of test cases, which is what to test and how — but not *what is waiting*. So
 *  the one question somebody standing here asks first, "what has Develop
 *  handed me?", was answered on another team's screen.
 *
 *  **What QA may change is deliberately narrow.** The status, because moving
 *  work along is QA's to do; the release checklist, because those steps are
 *  theirs; and a question to Product, which is how this app has always crossed
 *  a boundary. Not the description: a requirement reworded by the person
 *  testing it stops being a requirement, which is the same rule that makes
 *  Product's half read-only in the build plan. */
export default function TestWorkItems({ productId }: { productId: number }) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listWorkItems(productId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useWorkChanged(refresh);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
      notifyWorkChanged();
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  const chosen = items.find((i) => i.id === open) ?? null;

  return (
    <section className="test-work-items" aria-label="Work waiting for QA">
      <header>
        <h3>Work waiting for QA</h3>
        <p className="hint">
          Every work item in this Product, with the checks QA signs off before
          it can be released.
        </p>
      </header>

      {error && <p role="alert">{error}</p>}
      {notice && <p className="note" role="status">{notice}</p>}

      {items.length === 0 ? (
        <p className="hint">No work items in this Product yet.</p>
      ) : (
        <ul className="test-item-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={open === item.id ? "test-item on" : "test-item"}
                aria-pressed={open === item.id}
                aria-label={`Open ${item.title}`}
                onClick={() => setOpen(open === item.id ? null : item.id)}
              >
                <span className="test-item-title">
                  <span className="card-mono">#{item.id}</span>
                  <strong>{item.title}</strong>
                </span>
                <span className="test-item-meta">
                  {TYPE_LABELS[item.itemType] ?? item.itemType} · {item.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {chosen && (
        <div className="test-item-open" aria-label={`QA view of ${chosen.title}`}>
          {/* Read-only: what the work is belongs to Product, and this app has
              said so everywhere else it shows this text. */}
          <p className="briefing-text">
            {chosen.description?.trim() || "Product has not described this yet."}
          </p>

          <label className="field">
            <span>Status</span>
            <select
              aria-label={`Status of ${chosen.title}`}
              value={chosen.status}
              onChange={(e) => void run(() => updateWorkItemStatus(chosen.id, e.target.value))}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <WorkItemLifecycle
            workItemId={chosen.id}
            productId={productId}
            area="test"
            onChanged={notifyWorkChanged}
          />

          {/* The way across the boundary, the same one Develop uses. */}
          <div className="ask-product">
            <input
              aria-label={`Ask Product about ${chosen.title}`}
              placeholder="Ask Product something about this"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button
              disabled={question.trim() === ""}
              onClick={() =>
                void run(async () => {
                  await askProductQuestion(chosen.id, question.trim());
                  setQuestion("");
                  setNotice("Asked. It appears on the item for Product to answer.");
                })
              }
            >
              Ask Product
            </button>
          </div>

          {/* What the AI has said about this item, read-only for QA's purposes
              — the same panel Develop reads, without a Product id so it shows
              the feedback rather than a developer's failed runs. */}
          <AiFeedbackPanel workItemId={chosen.id} />
        </div>
      )}
    </section>
  );
}
