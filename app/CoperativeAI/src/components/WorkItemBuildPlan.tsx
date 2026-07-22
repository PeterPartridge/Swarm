import { useCallback, useEffect, useState } from "react";
import WorkItemChanges from "./WorkItemChanges";
import {
  askProductQuestion,
  attachSolutionToWorkItem,
  detachWorkItemPlan,
  generateChangePlan,
  listAiFeedback,
  listWorkItemPlans,
  pickImages,
  resolveAiFeedback,
  saveWorkItemPlan,
  type AiFeedback,
  type Solution,
  type WorkItem,
  type WorkItemPlan,
} from "../lib/backend";

function parseMockups(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** How one work item is going to be built: which Solutions it touches, what
 *  each needs, what proves it, which branch it lands on — and the API and page
 *  schemas the AI derives from all of that.
 *
 *  The questions are the point. Everything Product answers here becomes a
 *  clarification on the work item, so it reaches the generation prompt without
 *  anyone re-typing it — which is what makes "we have asked enough to generate"
 *  true rather than hopeful. */
export default function WorkItemBuildPlan({
  item,
  solutions,
}: {
  item: WorkItem;
  /** The Product's Solutions — the candidates this work can affect. */
  solutions: Solution[];
}) {
  const [plans, setPlans] = useState<WorkItemPlan[]>([]);
  const [questions, setQuestions] = useState<AiFeedback[]>([]);
  const [newQuestion, setNewQuestion] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedPlans, loadedFeedback] = await Promise.all([
        listWorkItemPlans(item.id),
        listAiFeedback(item.id),
      ]);
      setPlans(loadedPlans);
      setQuestions(loadedFeedback);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [item.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onSave(plan: WorkItemPlan, changes: Partial<WorkItemPlan>) {
    const next = { ...plan, ...changes };
    await run(() =>
      saveWorkItemPlan({
        id: plan.id,
        changesRequired: next.changesRequired,
        unitTests: next.unitTests,
        branchName: next.branchName,
        cloneFrom: next.cloneFrom,
        mockups: next.mockups,
      }),
    );
  }

  async function onAddMockups(plan: WorkItemPlan) {
    try {
      const picked = await pickImages();
      if (picked.length === 0) return;
      const merged = [...new Set([...parseMockups(plan.mockups), ...picked])];
      await onSave(plan, { mockups: JSON.stringify(merged) });
    } catch (e) {
      setError(String(e));
    }
  }

  async function onGenerate() {
    setBusy(true);
    setNotice("Turning what you have written into schemas…");
    try {
      const result = await generateChangePlan(item.id);
      if (result.blocked) {
        // Not a failure: it asked instead of inventing the missing half, and
        // the question is now on the item with the others.
        setNotice(
          `Stopped rather than inventing the rest: ${result.blocked.reason} ` +
            `${result.blocked.whatIsNeeded}`,
        );
      } else {
        setNotice(
          `Schemas written for ${result.created.join(", ")} (${result.provider} · ${result.reason}).`,
        );
      }
      await refresh();
    } catch (e) {
      setNotice(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const unaffected = solutions.filter((s) => !plans.some((p) => p.solutionId === s.id));
  const openQuestions = questions.filter((q) => !q.resolved);
  const answered = questions.filter((q) => q.resolved);

  return (
    <section className="build-plan" aria-label={`Build plan for ${item.title}`}>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {/* Product's screens land here as unassigned rows; this is where they get
          pointed at a Solution, and where the APIs and tables behind them are
          added. */}
      <WorkItemChanges workItemId={item.id} mode="developer" solutions={solutions} />

      <section aria-label="Affected solutions">
        <h4>Solutions affected</h4>
        {unaffected.length > 0 && (
          <select
            aria-label="Add an affected solution"
            value=""
            onChange={(e) =>
              run(() => attachSolutionToWorkItem(item.id, Number(e.target.value)))
            }
          >
            <option value="">Add a Solution…</option>
            {unaffected.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {plans.length === 0 && (
          <p className="hint">
            Nothing affected yet. Add the Solutions this work touches, then say
            what each one needs.
          </p>
        )}
      </section>

      {plans.map((plan) => {
        const mockups = parseMockups(plan.mockups);
        return (
          <section
            key={plan.id}
            className="plan-solution"
            aria-label={`Plan for ${plan.solutionName}`}
          >
            <div className="plan-head">
              <strong>{plan.solutionName}</strong>
              <button
                aria-label={`Remove ${plan.solutionName} from this work item`}
                onClick={() => run(() => detachWorkItemPlan(plan.id))}
              >
                Remove
              </button>
            </div>

            <div className="field">
              <span>What has to change here</span>
              <textarea
                rows={3}
                aria-label={`Changes required in ${plan.solutionName}`}
                defaultValue={plan.changesRequired}
                onBlur={(e) => onSave(plan, { changesRequired: e.target.value })}
              />
            </div>

            <div className="field">
              <span>Unit tests — what must be proved</span>
              <textarea
                rows={2}
                aria-label={`Unit tests for ${plan.solutionName}`}
                defaultValue={plan.unitTests}
                onBlur={(e) => onSave(plan, { unitTests: e.target.value })}
              />
            </div>

            <div className="plan-branch">
              <div className="field">
                <span>Branch name</span>
                <input
                  aria-label={`Branch name for ${plan.solutionName}`}
                  defaultValue={plan.branchName}
                  onBlur={(e) => onSave(plan, { branchName: e.target.value })}
                />
              </div>
              <div className="field">
                <span>Cut from</span>
                <input
                  aria-label={`Clone from for ${plan.solutionName}`}
                  defaultValue={plan.cloneFrom}
                  onBlur={(e) => onSave(plan, { cloneFrom: e.target.value })}
                />
              </div>
            </div>

            <div className="plan-mockups">
              <button
                aria-label={`Add UI pictures for ${plan.solutionName}`}
                onClick={() => onAddMockups(plan)}
              >
                Add UI pictures
              </button>
              {mockups.length > 0 && (
                <ul aria-label={`UI pictures for ${plan.solutionName}`}>
                  {mockups.map((path) => (
                    <li key={path}>
                      <span>{path.split(/[\\/]/).pop()}</span>
                      <button
                        aria-label={`Remove picture ${path}`}
                        onClick={() =>
                          onSave(plan, {
                            mockups: JSON.stringify(mockups.filter((m) => m !== path)),
                          })
                        }
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {(plan.apiSchema || plan.pageSchema || plan.filesToChange) && (
              // <section>, not <div>: an aria-label on a div is not a region.
              <section className="plan-generated" aria-label={`Schemas for ${plan.solutionName}`}>
                {[
                  ["API schema", plan.apiSchema],
                  ["Page schema", plan.pageSchema],
                  ["Files expected to change", plan.filesToChange],
                ]
                  .filter(([, body]) => body !== "")
                  .map(([heading, body]) => (
                    <div key={heading}>
                      <span className="plan-generated-head">{heading}</span>
                      <pre>{body}</pre>
                    </div>
                  ))}
              </section>
            )}
          </section>
        );
      })}

      <section aria-label="Questions for Product">
        <h4>Questions for Product</h4>
        <p className="hint">
          Answers become clarifications on this work item, so they reach the AI
          without anyone re-typing them.
        </p>
        <div className="ask-product">
          <input
            aria-label="Question for Product"
            placeholder="What should happen when payment fails?"
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
          />
          <button
            aria-label="Ask Product"
            disabled={newQuestion.trim() === ""}
            onClick={() =>
              run(async () => {
                await askProductQuestion(item.id, newQuestion);
                setNewQuestion("");
              })
            }
          >
            Ask
          </button>
        </div>

        {openQuestions.length > 0 && (
          <ul className="open-questions" aria-label="Waiting on an answer">
            {openQuestions.map((q) => (
              <li key={q.id}>
                <span>{q.message}</span>
                <input
                  aria-label={`Answer: ${q.message}`}
                  placeholder="Answer…"
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                />
                <button
                  aria-label={`Save answer to: ${q.message}`}
                  disabled={(answers[q.id] ?? "").trim() === ""}
                  onClick={() => run(() => resolveAiFeedback(q.id, answers[q.id] ?? ""))}
                >
                  Answer
                </button>
              </li>
            ))}
          </ul>
        )}
        {answered.length > 0 && (
          <ul className="answered-questions" aria-label="Answered">
            {answered.map((q) => (
              <li key={q.id}>
                <strong>{q.message}</strong> — {q.resolvedNote}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="plan-generate">
        <button
          aria-label={`Generate the code changes for ${item.title}`}
          onClick={onGenerate}
          disabled={busy || plans.length === 0}
        >
          {busy ? "Working…" : "AI: generate the code changes"}
        </button>
        <span className="hint">
          Writes an API and page schema per Solution from everything above. The
          brief handed to a coding agent carries them.
        </span>
      </div>
    </section>
  );
}
