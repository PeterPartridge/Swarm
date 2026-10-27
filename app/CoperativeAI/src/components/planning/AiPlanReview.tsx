import { useState } from "react";
import {
  generateChangePlan,
  savePlanSchemas,
  type Blocked,
  type WorkItemPlan,
} from "../../lib/backend";
import BlockedNote from "../ai/BlockedNote";
import { formatFiles, parseFiles, type PlannedFile } from "../../lib/plan";
import { readSchema } from "../../lib/schema";
import FileIcon from "../code/FileIcon";

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
                      <span className="plan-file-count">{files.length}</span>
                    </span>
                    {/* **A file, then why.** These were a path in code type with
                        its reason run on after it, all one size, one colour and
                        one line — a list of files that read as a paragraph. The
                        folder is quiet, the name is not, and the reason sits
                        under it in a sentence. */}
                    <ul className="plan-files">
                      {files.map((file, i) => {
                        const cut = file.path.lastIndexOf("/");
                        const folder = cut < 0 ? "" : file.path.slice(0, cut + 1);
                        const name = cut < 0 ? file.path : file.path.slice(cut + 1);
                        return (
                          <li key={`${file.path}-${i}`}>
                            <span className="plan-file-path">
                              <FileIcon name={name} isDir={false} />
                              {folder && <span className="plan-file-folder">{folder}</span>}
                              <span className="plan-file-name">{name}</span>
                            </span>
                            {file.note && (
                              <span className="plan-file-note">{file.note}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                {/* **The structure is in the text; this shows it.** A generated
                    schema arrives as one long line with its shape inside it as
                    punctuation — "…: 1) Output … 2) On valid input … Validation
                    rules: - Empty input → … - Special characters → …" — and a
                    <pre> preserved it exactly, which made a paragraph nobody
                    read to the end of. Nothing is invented and nothing is
                    dropped; the markers the writer used are the markers used to
                    lay it out. */}
                {[
                  ["API schema", plan.apiSchema],
                  ["Page schema", plan.pageSchema],
                ]
                  .filter(([, body]) => body !== "")
                  .map(([heading, body]) => (
                    <div key={heading} className="plan-schema">
                      <span className="plan-generated-head">{heading}</span>
                      <div className="schema-body" aria-label={`${heading} for ${name}`}>
                        {readSchema(body).map((block, i) => {
                          if (block.kind === "text") {
                            return <p key={i}>{block.text}</p>;
                          }
                          if (block.kind === "rules") {
                            return (
                              <div key={i}>
                                {block.lead && <p>{block.lead}</p>}
                                <ul className="schema-rules">
                                  {block.items.map((rule, r) => (
                                    <li key={r}>{rule}</li>
                                  ))}
                                </ul>
                              </div>
                            );
                          }
                          return (
                            <div key={i}>
                              {block.lead && <p>{block.lead}</p>}
                              <ol className="schema-steps">
                                {block.items.map((step, s) => (
                                  <li key={s}>
                                    {step.text}
                                    {step.rules.length > 0 && (
                                      <ul className="schema-rules">
                                        {step.rules.map((rule, r) => (
                                          <li key={r}>{rule}</li>
                                        ))}
                                      </ul>
                                    )}
                                  </li>
                                ))}
                              </ol>
                            </div>
                          );
                        })}
                      </div>
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
