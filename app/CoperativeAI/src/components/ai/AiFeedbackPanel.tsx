import { useCallback, useEffect, useState } from "react";
import {
  clearAiJobs,
  listAiFeedback,
  listAiJobs,
  readAgentRecord,
  resolveAiFeedback,
  type AgentRecord,
  type AiFeedback,
  type AiJob,
} from "../../lib/backend";
import { groupFailures } from "../../lib/when";
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
 *  - *What the agent reported* — the round record a coding agent writes when it
 *    finishes: what it built, how it proved it, what it would say back, and the
 *    debt it left behind. This is the half that used to be missing entirely.
 *    The agent wrote its account into a terminal that closes with it, so a
 *    panel called "AI feedback" sat empty while the feedback existed on the
 *    other side of the glass.
 *
 *  Replaces `AiQuestions`, which showed only the middle third of this and
 *  called all of it "questions". */
export default function AiFeedbackPanel({
  workItemId,
  productId,
  runId,
  onResolved,
}: {
  workItemId: number;
  /** The queue is per Product, so the failed attempts are read through it and
   *  filtered to this item. Without it the panel simply has no failures half. */
  productId?: number;
  /** The run whose round record to read. A work item nobody has handed to an
   *  agent has none, and then the panel says nothing about one at all. */
  runId?: number;
  onResolved?: () => void;
}) {
  const [feedback, setFeedback] = useState<AiFeedback[]>([]);
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [record, setRecord] = useState<AgentRecord | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedFeedback, loadedJobs, loadedRecord] = await Promise.all([
        listAiFeedback(workItemId),
        productId === undefined ? Promise.resolve([]) : listAiJobs(productId),
        // Not asked for at all without a run: there is no checkout to read one
        // out of, and a panel that asked anyway would report an error about a
        // file it had no reason to expect.
        runId === undefined ? Promise.resolve(null) : readAgentRecord(runId),
      ]);
      setRecord(loadedRecord);
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
  }, [workItemId, productId, runId]);

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
  // With a run in view the record line below says where things stand, so this
  // would be a second paragraph saying the same absence twice.
  const nothing =
    jobs.length === 0 && feedback.length === 0 && record === null && runId === undefined;

  /// Forgets the settled attempts. Only on a press: they are the record of
  /// what was tried, and an app that quietly pruned history would be deciding
  /// for somebody which failures mattered.
  async function clear() {
    try {
      const gone = await clearAiJobs(workItemId);
      setNotice(
        `Cleared ${gone} attempt${gone === 1 ? "" : "s"} from the queue. Anything still running stayed, and what they cost is still in the ledger.`,
      );
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section className="ai-feedback" aria-label="AI feedback">
      {error && <p role="alert">{error}</p>}
      {notice && <p className="note" role="status">{notice}</p>}

      {nothing && (
        <p className="hint">
          The AI has not reported anything on this item — no failed attempt, and
          nothing it could not do.
        </p>
      )}

      {/* First, because it is the answer to "what happened?" — the rest of this
          panel is about attempts that did not get this far. */}
      {record !== null && (
        <div className="feedback-group" role="region" aria-label="What the agent reported">
          <span className="palette-label">What the agent reported</span>
          <dl className="agent-record">
            {(
              [
                ["What it built", record.whatIBuilt],
                ["Tests", record.tests],
                ["Feedback", record.feedback],
                ["Technical debt", record.technicalDebt],
                ["What it could not do", record.couldNotDo],
                ["Also said", record.other],
              ] as const
            )
              // A heading the agent left blank is left out. An empty "Technical
              // debt" reads as "there is none", which is a claim the app has no
              // business making on the agent's behalf.
              .filter(([, body]) => body.trim() !== "")
              .map(([heading, body]) => (
                <div key={heading} className="agent-record-part">
                  <dt>{heading}</dt>
                  <dd>{body}</dd>
                </div>
              ))}
          </dl>
        </div>
      )}

      {runId !== undefined && record === null && (
        <p className="hint">
          The agent has not written its round record yet. It is asked for one when
          it finishes — what it built, how it proved it, and the debt it left
          behind.
        </p>
      )}

      {jobs.length > 0 && (
        <div className="feedback-group">
          <div className="feedback-group-head">
            <span className="palette-label">Attempts that failed</span>
            {/* **Only a person clears history.** Nothing prunes these on its
                own — they are what was tried, and an app that tidied them away
                would be deciding which failures mattered. */}
            <button className="link-button" onClick={() => void clear()}>
              Clear the failed attempts
            </button>
          </div>
          {/* Grouped and dated. Eight presses against a policy that says no
              wrote eight identical rows, undated — which read as eight things
              going wrong now rather than one thing that went wrong then. */}
          <ul className="feedback-list" aria-label="Attempts that failed">
            {groupFailures(jobs).map((f) => (
              <li key={f.id}>
                <span className="feedback-kind">
                  {f.purpose} · {f.when}
                  {f.times > 1 && (
                    <>
                      {" · "}
                      <span className="feedback-times">{f.times} times</span>
                    </>
                  )}
                </span>
                <span className="feedback-message">{f.message}</span>
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
