import { useCallback, useEffect, useState } from "react";
import Notice, { type NoticeValue } from "../ai/Notice";
import HandoverPanel from "../planning/HandoverPanel";
import WorkItemChanges from "../code/WorkItemChanges";
import { notifyWorkChanged } from "../../lib/workSignal";
import {
  askProductQuestion,
  generateChangePlan,
  submitForPlanning,
  listAiFeedback,
  listWorkItemPlans,
  resolveAiFeedback,
  updateWorkItem,
  writeWorkItemFiles,
  type AiFeedback,
  type Solution,
  type WorkItem,
  type WorkItemPlan,
} from "../../lib/backend";

/** How one work item is going to be built: the Solutions it touches and what
 *  each needs, the questions Product still owes an answer to, and the schemas
 *  the AI derives from all of it.
 *
 *  **The per-Solution detail is not here any more.** It was in three places —
 *  a ticklist of affected Solutions, the list of changes, and a block of
 *  branch/tests/notes at the bottom — and all three were about the same
 *  Solution. `WorkItemChanges` is that one place now. What is left here is what
 *  is true of the whole work item: where it lands, how it is built, what is
 *  still unanswered, and the generate step that reads the lot.
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
  const [notice, setNotice] = useState<NoticeValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  /// Held locally because it grows: every "what needs to change" written below
  /// is appended as its own set, and the item prop does not come back changed.
  const [details, setDetails] = useState(item.developmentDetails);
  /// When the schemas were last written, so the panel that draws them re-reads.
  const [generatedAt, setGeneratedAt] = useState(0);
  /// What became of the last automatic write. Named rather than assumed —
  /// the pair cannot be written before the Product has a folder, and a panel
  /// that says nothing would leave somebody believing a file exists.
  const [files, setFiles] = useState<
    { written: string[] } | { blocked: string } | null
  >(null);

  useEffect(() => {
    setDetails(item.developmentDetails);
  }, [item.id, item.developmentDetails]);

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

  /** Puts the work item's `.md` and `.json` back on disk.
   *
   *  **Every save, no button.** The pair used to be written by pressing one,
   *  which meant the files on disk were whatever the last person to remember
   *  had produced — an agent handed a brief three edits out of date is an
   *  agent building the wrong thing. Writing on each save is the only version
   *  of this that is true.
   *
   *  A failure here is reported and swallowed rather than raised: the record
   *  did save, and turning "the Product has no folder yet" into a red error on
   *  a textarea would say the wrong thing about what just happened. */
  const writeFiles = useCallback(async () => {
    try {
      setFiles({ written: await writeWorkItemFiles(item.id) });
    } catch (e) {
      setFiles({ blocked: String(e) });
    }
  }, [item.id]);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
      setError(null);
      // Every mutation here moves something a run depends on — approving,
      // withdrawing, changing the branch, or editing text, which clears the
      // approval. The rail's Start button has to follow all of them, so the
      // signal goes out from the one place they all pass through.
      notifyWorkChanged();
      await writeFiles();
    } catch (e) {
      setError(String(e));
    }
  }

  /** Saves a change to the work item itself, keeping its other fields.
   *
   *  The technical ones live here rather than on Product's board: which
   *  repository the work lands in, and how it should be built, are decisions
   *  a developer makes. */
  async function saveItem(changes: Partial<WorkItem>) {
    const next = { ...item, developmentDetails: details, ...changes };
    await run(() =>
      updateWorkItem({
        id: item.id,
        assigneeId: next.assigneeId,
        sprintId: next.sprintId,
        startDate: next.startDate,
        endDate: next.endDate,
        deliverableId: next.deliverableId,
        expectedCost: next.expectedCost,
        estimatedProfit: next.estimatedProfit,
        chargeable: next.chargeable,
        customerCoverPct: next.customerCoverPct,
        risk: next.risk,
        solutionId: next.solutionId,
        developmentDetails: next.developmentDetails,
      }),
    );
  }

  /** Adds one round of changes to the development details as its own set.
   *
   *  **Appended, never replaced.** Each pass over the work item is a separate
   *  thing somebody decided, and the second one does not make the first untrue
   *  — an agent reading this wants the history, not the latest sentence. Dated
   *  and headed with the Solution and what it affected, so a set can be read
   *  on its own a month later. */
  async function appendNote(note: string) {
    const when = new Date().toISOString().slice(0, 10);
    const entry = `### ${when} — ${note}`;
    const next = details.trim() === "" ? entry : `${details.trimEnd()}\n\n${entry}`;
    setDetails(next);
    await saveItem({ developmentDetails: next });
  }

  async function onSubmit() {
    try {
      await submitForPlanning(item.id);
      setNotice("Submitted for planning — follow it in the AI queue on the Work tab.");
      setError(null);
    } catch (e) {
      setNotice(null);
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
        setNotice({ blocked: result.blocked, what: "inventing the rest" });
      } else {
        setNotice(
          `Schemas written for ${result.created.join(", ")} (${result.provider} · ${result.reason}).`,
        );
      }
      await refresh();
      setGeneratedAt(Date.now());
    } catch (e) {
      setNotice(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const openQuestions = questions.filter((q) => !q.resolved);
  const answered = questions.filter((q) => q.resolved);

  return (
    <section className="build-plan" aria-label={`Build plan for ${item.title}`}>
      {error && <p role="alert">{error}</p>}
      <Notice value={notice} />

      {/* Product's screens land here as unassigned rows; this is where they get
          pointed at a Solution, and where the APIs and tables behind them are
          added. */}
      <WorkItemChanges
        workItemId={item.id}
        mode="developer"
        solutions={solutions}
        // Without this the panel shows a Solution dropdown and no way to make
        // one — and because the prop is optional, leaving it out typechecked
        // cleanly and shipped as a feature that did nothing.
        productId={item.productId}
        // Generating writes the schemas that are drawn inside those blocks,
        // and the panel would otherwise go on showing the ones it last read.
        reloadAt={generatedAt}
        onSaved={() => {
          void writeFiles();
          // The panel owns the plans now, so this one has to hear about a
          // Solution attached or approved there — the Start gate and the
          // generate button both read them.
          void refresh();
        }}
        // Each sentence written down there becomes a set here, dated and
        // naming what it was about. The box below is the log of them, still
        // editable — nothing is appended that cannot then be corrected.
        onNote={(note) => void appendNote(note)}
      />

      {/* **"Lands in" was a second answer to a question already asked above.**
          Attaching a Solution in "What this changes" creates its plan; the
          picker here set a different field and created none, so the two could
          disagree — and the handover gate and AI-written tests read one while
          the runs and the plan read the other. Attaching is now the only way to
          say it, and it sets both. */}

      {/* Only work that has somewhere to land can be handed over — and handing
          work to a coding agent is a developer's call, not Product's. */}
      {item.solutionId !== null && <HandoverPanel item={item} />}

      {/* Above the per-Solution notes because it applies across all of them:
          the conventions and gotchas everyone knows and nobody wrote down —
          and now the running record of what each round of changes was for. */}
      <div className="field">
        <span>Development details — how this should be built</span>
        <textarea
          rows={6}
          aria-label="Development details"
          value={details}
          placeholder="conventions, gotchas, anything an agent would not work out"
          onChange={(e) => setDetails(e.target.value)}
          onBlur={(e) => saveItem({ developmentDetails: e.target.value })}
        />
      </div>

      {/* No write button. The pair is rewritten on every save above, so what
          is on disk is what is on screen — and when it cannot be, that is said
          rather than left to be assumed. */}
      <p className="hint plan-files">
        {files === null
          ? "The .md and .json for the AI are rewritten on every save."
          : "written" in files
            ? `Written on the last save: ${files.written.join(", ")}`
            : `Not written — ${files.blocked}`}
      </p>


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
        {/* Submit is the one the queue was built for: it returns at once, so
            the next work item can be written up and submitted while this one
            plans. Generate-now stays for a single item you want to watch. */}
        <button
          aria-label={`Submit ${item.title} for planning`}
          onClick={onSubmit}
          disabled={busy || plans.length === 0}
        >
          Submit for planning
        </button>
        <button
          aria-label={`Generate the code changes for ${item.title}`}
          onClick={onGenerate}
          disabled={busy || plans.length === 0}
        >
          {busy ? "Working…" : "Generate now"}
        </button>
        <span className="hint">
          Writes an API and page schema per Solution from everything above.
          Submit and carry on — the AI queue is in the Work tab — or generate
          now and watch. The brief handed to a coding agent carries the schemas.
        </span>
      </div>
    </section>
  );
}
