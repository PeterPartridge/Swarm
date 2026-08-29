import { useCallback, useEffect, useState } from "react";
import Notice, { type NoticeValue } from "../ai/Notice";
import WorkItemChanges from "../code/WorkItemChanges";
import FromProduct from "./FromProduct";
import SectionTabs from "../common/SectionTabs";
import { notifyWorkChanged, useWorkChanged } from "../../lib/workSignal";
import {
  askProductQuestion,
  generateChangePlan,
  getWorkItemPolicy,
  submitForPlanning,
  listAiFeedback,
  listAiJobs,
  listWorkItemPlans,
  resolveAiFeedback,
  setPlanApproval,
  startRun,
  writeWorkItemFiles,
  type AiFeedback,
  type AiJob,
  type Solution,
  type WorkItem,
  type WorkItemPlan,
  type WorkItemPolicy,
} from "../../lib/backend";

/** Everything an AI would need that nobody has written yet, in the order it
 *  should be fixed. Empty means both buttons can be pressed.
 *
 *  **A disabled button that says nothing looks exactly like a broken one** —
 *  which is what these were: they greyed out with no Solution attached and gave
 *  no reason, so pressing produced no plan, no error and no explanation. Every
 *  reason is listed rather than only the first, so somebody fixes them in one
 *  pass instead of discovering the next one each time.
 *
 *  Pure, so the rules are testable without rendering anything. */
export function whatIsMissing(
  item: WorkItem,
  plans: WorkItemPlan[],
  policy: WorkItemPolicy | null,
): string[] {
  const missing: string[] = [];
  if ((item.description ?? "").trim() === "") {
    missing.push(
      "Nobody has described what this is — Product writes that on the item.",
    );
  }
  // **Deny-by-default, said before the press rather than after it.** The
  // backend refuses an item with no policy, which is the rule working — but
  // finding out by pressing Plan and reading a failure in the job queue is the
  // long way round to "nobody has said the AI may touch this".
  if (policy === null) {
    missing.push(
      'The AI has no permission on this item — go to Admin → AI, pick this item under "What the AI may do, per work item", and allow reading with a provider named. Nothing is allowed until somebody says so.',
    );
  } else if (!policy.allowRead) {
    missing.push(
      'Its AI policy does not allow reading, so nothing can be sent — turn that on in Admin → AI.',
    );
  } else if (policy.providerId === null) {
    missing.push(
      'Its AI policy names no provider — choose one in Admin → AI, adding one there first if the list is empty.',
    );
  }
  if (plans.length === 0) {
    missing.push(
      'No Solution is attached — add one under "What this changes", or there is no repository for a plan to be about.',
    );
  } else if (plans.every((p) => p.changesRequired.trim() === "")) {
    missing.push(
      "Nothing is written about what has to change, so an AI would be planning from the title alone.",
    );
  }
  return missing;
}

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
  /// This item's planning jobs, newest first — what the panel needs to say
  /// whether one is in flight and how the last one went.
  const [jobs, setJobs] = useState<AiJob[]>([]);
  /// Whether the AI may touch this item at all. Deny-by-default, so `null`
  /// means nobody has said and nothing is permitted.
  const [policy, setPolicy] = useState<WorkItemPolicy | null>(null);
  /// Which side is showing. Develop first: this panel is opened from the
  /// Develop area, and what a developer came here to do is the default.
  const [view, setView] = useState("develop");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  /// When the schemas were last written, so the panel that draws them re-reads.
  const [generatedAt, setGeneratedAt] = useState(0);
  /// What became of the last automatic write. Named rather than assumed —
  /// the pair cannot be written before the Product has a folder, and a panel
  /// that says nothing would leave somebody believing a file exists.
  const [files, setFiles] = useState<
    { written: string[] } | { blocked: string } | null
  >(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedPlans, loadedFeedback, loadedJobs, loadedPolicy] = await Promise.all([
        listWorkItemPlans(item.id),
        listAiFeedback(item.id),
        listAiJobs(item.productId),
        getWorkItemPolicy(item.id),
      ]);
      setPlans(loadedPlans);
      setQuestions(loadedFeedback);
      // Only this item's, newest first — the queue is per Product.
      setJobs(
        loadedJobs
          .filter((j) => j.workItemId === item.id)
          .sort((a, b) => b.submittedAt - a.submittedAt),
      );
      setPolicy(loadedPolicy);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [item.id, item.productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // **This is what "I clicked Plan and nothing happened" needed.** Planning is
  // queued and runs elsewhere, so without listening the panel showed the same
  // thing before, during and after — and the plan appeared only if somebody
  // happened to reopen the item. The backend already emits on every job move;
  // this panel just had nobody listening.
  useWorkChanged(() => {
    void refresh();
  });

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

  /* **Nothing here writes to the work item any more.** The two fields this
     panel owned have both gone: "Lands in" (round 52 — attaching a Solution
     says it, and said it twice) and "Development details" (removed 2026-08-21
     — the Developer Rules hold the standing conventions and "What this
     changes" holds the specifics). What is left reads the item and writes to
     its plans. */

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

  /** Plans it now, approves what came back, and starts an agent on it.
   *
   *  **The approval is this press.** `start_run` refuses an unapproved plan and
   *  generating clears the approval, so a chain that ran straight through would
   *  be refused unless somebody said go — pressing Execute is saying go. What it
   *  must never do is carry on past a decline: an AI that said it could not
   *  write the plan is not an AI whose plan should be handed to an agent. */
  async function onExecute() {
    setBusy(true);
    setNotice("Planning, then starting an agent…");
    try {
      const result = await generateChangePlan(item.id);
      if (result.blocked) {
        setNotice({ blocked: result.blocked, what: "inventing the rest" });
        await refresh();
        setGeneratedAt(Date.now());
        return;
      }
      const fresh = await listWorkItemPlans(item.id);
      const started: string[] = [];
      for (const p of fresh) {
        await setPlanApproval(item.id, p.solutionId, true);
        await startRun(item.id, p.solutionId);
        started.push(p.solutionName);
      }
      setNotice(
        `Planned, approved and started on ${started.join(", ")}. The agent is working in its own checkout — follow it on the Runs panel.`,
      );
      await refresh();
      setGeneratedAt(Date.now());
      notifyWorkChanged();
    } catch (e) {
      setNotice(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const openQuestions = questions.filter((q) => !q.resolved);
  const missing = whatIsMissing(item, plans, policy);
  /// The planning job in flight for this item, if any. Both buttons wait on it:
  /// a second submission while one is running would plan the same item twice
  /// and pay for it twice.
  const planning = jobs.find((j) => j.state === "queued" || j.state === "running");
  /// The last one that finished, so the panel can say how it went rather than
  /// going quiet and leaving somebody to guess.
  const lastJob = jobs.find((j) => j.state !== "queued" && j.state !== "running");
  const nothingToPlan = missing.length > 0;

  return (
    <section className="build-plan" aria-label={`Build plan for ${item.title}`}>
      {error && <p role="alert">{error}</p>}
      <Notice value={notice} />

      {/* **What the queued job is doing, said here rather than only in the
          queue.** Planning runs elsewhere and returns at once, so this panel
          used to look identical before, during and after — which is what
          "I clicked Plan and nothing happened" was. A `status` and not an
          `alert`: a job that is running is not a problem, and a job that
          declined is the framework working. */}
      {planning && (
        <p className="plan-status planning" role="status">
          {planning.state === "queued"
            ? "Queued for planning — it starts when the AI queue reaches it."
            : "Planning now… the plan appears below when it lands."}
        </p>
      )}
      {!planning && lastJob && lastJob.state !== "done" && (
        <p className="plan-status plan-stopped" role="status">
          {lastJob.state === "blocked"
            ? `Planning stopped and asked a question: ${lastJob.message} — answer it under "From Product".`
            : lastJob.state === "cancelled"
              ? "The last planning run was cancelled."
              : `Planning failed: ${lastJob.message}`}
        </p>
      )}

      {/* **Two sides, two tabs.** Product sets what customers get; Develop
          decides how it is built. Product's half is read-only here — a
          requirement reworded by the person implementing it stops being a
          requirement — and the questions are the way across the line. */}
      <SectionTabs
        label="Build plan view"
        as="buttons"
        options={[
          { id: "develop", label: "What this changes" },
          {
            id: "product",
            label: openQuestions.length > 0
              ? `From Product (${openQuestions.length} unanswered)`
              : "From Product",
          },
        ]}
        active={view}
        onSelect={setView}
      />

      {view === "product" && (
        <FromProduct
          item={item}
          questions={questions}
          onAsk={(question) => run(() => askProductQuestion(item.id, question))}
          onAnswer={(id, answer) => run(() => resolveAiFeedback(id, answer))}
        />
      )}

      {/* Product's screens land here as unassigned rows; this is where they get
          pointed at a Solution, and where the APIs and tables behind them are
          added. Kept mounted rather than unmounted when the other tab is
          showing: it holds unsaved edits in its own boxes, and switching tabs
          must not throw away something half-typed. */}
      <div hidden={view !== "develop"}>
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
      />
      </div>

      {/* **"Lands in" was a second answer to a question already asked above.**
          Attaching a Solution in "What this changes" creates its plan; the
          picker here set a different field and created none, so the two could
          disagree — and the handover gate and AI-written tests read one while
          the runs and the plan read the other. Attaching is now the only way to
          say it, and it sets both. */}

      {/* **No manual handover here.** There were two routes to an agent side
          by side: this panel wrote a brief and offered a command to paste, and
          the Runs panel's Start writes the brief, makes a worktree, opens a
          terminal and types the command itself. Two routes that look like
          alternatives is a choice nobody made — Start is the one, and it
          prepares its own run, so nothing was lost by dropping this. The Code
          tab keeps its own hand-over, which is a different thing: it sends the
          command to a shell already open beside the editor. */}

      {/* **No "Development details" box.** The standing conventions are the
          Developer Rules, and the specifics are "What this changes" per
          Solution — which is also the only one of the two that is about the
          repository an agent is standing in. One box holding both was a third
          place to write the same thing, and it doubled as an append-only log
          nobody could tidy. */}

      {/* **One sentence about what is on disk**, not two next to each other
          describing different files. No write button either: the pair is
          rewritten on every save above, so what is on disk is what is on
          screen — and when it cannot be, that is said rather than assumed. */}
      <p className="hint plan-files">
        {files === null
          ? "This work item's .md and .json are rewritten on every save. The agent's brief is written by Start, on the Runs panel."
          : "written" in files
            ? `Written on the last save: ${files.written.join(", ")}. The agent's brief is written by Start, on the Runs panel.`
            : `Not written — ${files.blocked}`}
      </p>



      <div className="plan-generate">
        {/* **Two presses, and the second one is the approval.** `start_run`
            refuses a plan nobody has approved, and generating a plan clears
            the approval — so anything that ran straight after generating would
            be refused unless a person said go. Execute is a person saying go,
            knowingly, rather than the app approving on their behalf. */}
        <button
          aria-label={`Plan ${item.title}`}
          aria-describedby={nothingToPlan ? "plan-blocked" : undefined}
          onClick={onSubmit}
          disabled={busy || nothingToPlan || planning !== undefined}
        >
          {planning ? "Planning…" : busy ? "Working…" : "Plan"}
        </button>
        <button
          aria-label={`Execute ${item.title}`}
          aria-describedby={nothingToPlan ? "plan-blocked" : undefined}
          onClick={onExecute}
          disabled={busy || nothingToPlan || planning !== undefined}
        >
          {busy ? "Working…" : "Execute"}
        </button>

        {/* **The reason, not just the disabled state.** These greyed out
            silently when no Solution was attached, which is indistinguishable
            from a broken button — and was. */}
        {nothingToPlan ? (
          <div className="hint plan-missing" id="plan-blocked">
            <p>Not ready to plan yet:</p>
            <ul>
              {missing.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : (
          <span className="hint">
            <strong>Plan</strong> queues it and returns at once, so you can write
            up the next item while this one plans — watch it in the AI queue on
            the Work tab. <strong>Execute</strong> plans it now, approves it, and
            starts an agent on it in its own checkout.
          </span>
        )}
      </div>
    </section>
  );
}
