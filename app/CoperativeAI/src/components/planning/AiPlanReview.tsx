import { useState } from "react";
import {
  generateChangePlan,
  savePlanSchemas,
  type Blocked,
  type WorkItemPlan,
} from "../../lib/backend";
import BlockedNote from "../ai/BlockedNote";
import { formatFiles, parseFiles, type PlannedFile } from "../../lib/plan";

/** What the AI planned, laid out to be read and argued with.
 *
 *  **Its own tab, and not a textarea.** The plan came back as three blobs of
 *  text in a `<pre>` at the bottom of the changes panel — the same information,
 *  formatted as something to scroll past. A plan is the thing a person is being
 *  asked to approve, so it gets a place of its own, a row per file, and two
 *  ways to change it:
 *
 *  - **edit it yourself**, for a wrong path or a note that misreads the ask;
 *    no model call, no waiting, and nothing else in the plan moves.
 *  - **tell the AI what to change**, for anything that needs the plan
 *    re-derived. The instruction travels with the current plan, so the model
 *    revises rather than starting again.
 *
 *  Either way approval is withdrawn — that rule lives in `set_generated`, one
 *  layer down, so both routes obey it without this screen having to remember. */
export default function AiPlanReview({
  workItemId,
  plans,
  onChanged,
}: {
  workItemId: number;
  plans: WorkItemPlan[];
  /** Called after anything is written, so the panel around this re-reads. */
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<PlannedFile[]>([]);
  const [schemas, setSchemas] = useState({ apiSchema: "", pageSchema: "" });
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const startEditing = (plan: WorkItemPlan) => {
    setEditing(plan.id);
    setDraft(parseFiles(plan.filesToChange));
    setSchemas({ apiSchema: plan.apiSchema, pageSchema: plan.pageSchema });
  };

  const save = async (plan: WorkItemPlan) => {
    setBusy(true);
    setError(null);
    try {
      await savePlanSchemas({
        id: plan.id,
        apiSchema: schemas.apiSchema,
        pageSchema: schemas.pageSchema,
        filesToChange: formatFiles(draft),
      });
      setEditing(null);
      setNotice("Saved. Approval was withdrawn, because this is a different plan now.");
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const revise = async () => {
    setBusy(true);
    setError(null);
    setBlocked(null);
    setNotice(null);
    try {
      const result = await generateChangePlan(workItemId, instruction.trim());
      if (result.blocked) {
        setBlocked(result.blocked);
        return;
      }
      setInstruction("");
      setNotice(`Revised by ${result.model}. Read it again before approving.`);
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-plan-review">
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="note" role="status">{notice}</p>}
      {blocked && <BlockedNote blocked={blocked} what="revising the plan" />}

      {plans.length === 0 && (
        <p className="empty">
          No Solution is attached yet, so there is nothing for the AI to plan
          against.
        </p>
      )}

      {plans.map((plan) => {
        const files = parseFiles(plan.filesToChange);
        const nothing =
          files.length === 0 && plan.apiSchema === "" && plan.pageSchema === "";
        const mine = editing === plan.id;
        return (
          <section
            key={plan.id}
            className="plan-solution"
            aria-label={`AI plan for ${plan.solutionName}`}
          >
            <header className="plan-solution-head">
              <h4>{plan.solutionName}</h4>
              {plan.approvedAt > 0 ? (
                <span className="plan-approved">Approved</span>
              ) : (
                <span className="plan-unapproved">Not approved yet</span>
              )}
              {!nothing && !mine && (
                <button onClick={() => startEditing(plan)} disabled={busy}>
                  Edit the plan
                </button>
              )}
            </header>

            {nothing ? (
              <p className="empty">
                The AI has nothing planned for it yet — press Plan, and what it
                works out appears here.
              </p>
            ) : mine ? (
              <div className="plan-editing">
                <span className="plan-generated-head">Files expected to change</span>
                <ul className="plan-files editing">
                  {draft.map((file, i) => (
                    <li key={i}>
                      <input
                        aria-label={`File ${i + 1} path`}
                        className="plan-file-path"
                        value={file.path}
                        onChange={(e) =>
                          setDraft(
                            draft.map((f, j) =>
                              j === i ? { ...f, path: e.target.value } : f,
                            ),
                          )
                        }
                      />
                      <textarea
                        aria-label={`File ${i + 1} — why`}
                        rows={2}
                        value={file.note}
                        onChange={(e) =>
                          setDraft(
                            draft.map((f, j) =>
                              j === i ? { ...f, note: e.target.value } : f,
                            ),
                          )
                        }
                      />
                      <button
                        aria-label={`Remove file ${i + 1}`}
                        className="link-button"
                        onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  className="link-button"
                  onClick={() => setDraft([...draft, { path: "", note: "" }])}
                >
                  Add a file
                </button>

                {[
                  ["API schema", "apiSchema"] as const,
                  ["Page schema", "pageSchema"] as const,
                ].map(([heading, key]) => (
                  <label key={key} className="field">
                    <span>{heading}</span>
                    <textarea
                      rows={4}
                      value={schemas[key]}
                      onChange={(e) =>
                        setSchemas({ ...schemas, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}

                <div className="row-actions">
                  <button
                    className="primary"
                    onClick={() => void save(plan)}
                    disabled={busy}
                  >
                    Save the plan
                  </button>
                  <button onClick={() => setEditing(null)} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {files.length > 0 && (
                  <>
                    <span className="plan-generated-head">
                      Files expected to change
                    </span>
                    <ul className="plan-files">
                      {files.map((file, i) => (
                        <li key={`${file.path}-${i}`}>
                          <code>{file.path}</code>
                          {file.note && <span className="plan-file-note">{file.note}</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {[
                  ["API schema", plan.apiSchema],
                  ["Page schema", plan.pageSchema],
                ]
                  .filter(([, body]) => body !== "")
                  .map(([heading, body]) => (
                    <div key={heading} className="plan-schema">
                      <span className="plan-generated-head">{heading}</span>
                      <pre>{body}</pre>
                    </div>
                  ))}
              </>
            )}
          </section>
        );
      })}

      {plans.length > 0 && (
        <div className="plan-revise">
          <label className="field">
            <span>Tell the AI what to change about this plan</span>
            <textarea
              rows={3}
              placeholder="e.g. use anyhow rather than a custom error type, and drop the integration test"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </label>
          <button
            className="primary"
            onClick={() => void revise()}
            disabled={busy || instruction.trim() === ""}
          >
            {busy ? "Asking…" : "Ask the AI to revise it"}
          </button>
          {/* Said before the press: a revision is another paid call, and it
              rewrites every Solution's plan, not only the one being read. */}
          <p className="hint">
            It is shown the plan above and asked to change only what you name.
            Approval is withdrawn either way.
          </p>
        </div>
      )}
    </div>
  );
}
