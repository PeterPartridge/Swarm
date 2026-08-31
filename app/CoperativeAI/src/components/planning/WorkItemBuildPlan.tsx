import { useCallback, useEffect, useRef, useState } from "react";
import Notice, { type NoticeValue } from "../ai/Notice";
import WorkItemChanges from "../code/WorkItemChanges";
import AiPlanReview from "./AiPlanReview";
import FromProduct from "./FromProduct";
import SolutionRepo from "../vcs/SolutionRepo";
import WorkItemLifecycle from "./WorkItemLifecycle";
import SectionTabs from "../common/SectionTabs";
import { reportFailure } from "../../lib/failures";
import { logEvent } from "../../lib/backend";
import { isPlanned } from "../../lib/plan";
import { notifyWorkChanged, useWorkChanged } from "../../lib/workSignal";
import {
  askProductQuestion,
  generateChangePlan,
  checkItemAiPermission,
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
  type AiPermission,
  type WorkItem,
  type WorkItemPlan,
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
  permission: AiPermission | null,
): string[] {
  const missing: string[] = [];
  if ((item.description ?? "").trim() === "") {
    missing.push(
      "Nobody has described what this is — Product writes that on the item.",
    );
  }
  // **Deny-by-default, said before the press rather than after it.** Asked of
  // the same walk the backend gate uses — Solution override, then Product —
  // so the button and the backend cannot disagree about what is permitted.
  if (permission !== null && !permission.allowed) {
    missing.push(permission.reason);
  } else if (permission !== null && !permission.hasProvider) {
    missing.push(
      "The AI is permitted here but no provider is named to send to — name one on the policy that permits it, in Admin → AI.",
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
  /// Whether the AI may touch this item at all — the same walk the backend
  /// gate uses, so the button cannot disagree with what would happen.
  const [permission, setPermission] = useState<AiPermission | null>(null);
  /// Which side is showing. Develop first: this panel is opened from the
  /// Develop area, and what a developer came here to do is the default.
  const [view, setView] = useState("develop");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeValue | null>(null);
  /// Why the panel could not read itself. Cleared by the next successful read,
  /// because it is a statement about the load that just happened.
  const [loadError, setLoadError] = useState<string | null>(null);
  /// Why the last press failed.
  ///
  /// **Held apart from the one above, and this is not tidiness.** They shared a
  /// state, and `refresh` cleared it on every successful read — which happens
  /// on every work-changed signal: a job finishing anywhere in the Product, a
  /// save in the changes block below, this panel's own reload. So "Execute
  /// failed because that folder is not a git repository" was erased within a
  /// second of appearing, and the button looked like it did nothing at all.
  /// Only another press clears this.
  const [actionError, setActionError] = useState<string | null>(null);
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
      const [loadedPlans, loadedFeedback, loadedJobs, loadedPermission] = await Promise.all([
        listWorkItemPlans(item.id),
        listAiFeedback(item.id),
        listAiJobs(item.productId),
        checkItemAiPermission(item.id),
      ]);
      setPlans(loadedPlans);
      setQuestions(loadedFeedback);
      // Only this item's, newest first — the queue is per Product.
      setJobs(
        loadedJobs
          .filter((j) => j.workItemId === item.id)
          .sort((a, b) => b.submittedAt - a.submittedAt),
      );
      setPermission(loadedPermission);
      setLoadError(null);
    } catch (e) {
      setLoadError(String(e));
    }
  }, [item.id, item.productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /// The last job this panel has already shouted about, so a reload does not
  /// report the same failure again.
  const reported = useRef<number | null>(null);

  // **Planning runs in the queue, so its failure is nobody's press.** Nothing
  // catches it here, so nothing reported it, and the rail stayed empty while
  // the job that was meant to produce the plan had failed. Reported once, when
  // the job comes back — the ref is what makes it once rather than on every
  // refresh.
  useEffect(() => {
    const finished = jobs.find((j) => j.state !== "queued" && j.state !== "running");
    if (!finished || (finished.state !== "failed" && finished.state !== "blocked")) return;
    if (reported.current === finished.id) return;
    reported.current = finished.id;
    reportFailure(
      finished.state === "blocked" ? "The AI declined" : "Planning",
      finished.message,
    );
  }, [jobs]);

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
      setActionError(null);
      // Every mutation here moves something a run depends on — approving,
      // withdrawing, changing the branch, or editing text, which clears the
      // approval. The rail's Start button has to follow all of them, so the
      // signal goes out from the one place they all pass through.
      notifyWorkChanged();
      await writeFiles();
    } catch (e) {
      setActionError(String(e));
      reportFailure("Saving", String(e));
    }
  }

  /* **Nothing here writes to the work item any more.** The two fields this
     panel owned have both gone: "Lands in" (round 52 — attaching a Solution
     says it, and said it twice) and "Development details" (removed 2026-08-21
     — the Developer Rules hold the standing conventions and "What this
     changes" holds the specifics). What is left reads the item and writes to
     its plans. */

  async function onSubmit() {
    setActionError(null);
    void logEvent("plan", `pressed on work item ${item.id}`, item.title);
    if (nothingToPlan) {
      const why = missing.join(" · ");
      setActionError(why);
      reportFailure("Plan", why);
      void logEvent("plan", "refused before starting", why);
      return;
    }
    try {
      await submitForPlanning(item.id);
      setNotice("Submitted for planning — follow it in the AI queue on the Work tab.");
      setActionError(null);
    } catch (e) {
      setNotice(null);
      setActionError(String(e));
      reportFailure("Plan", String(e));
    }
  }

  /** Approves what is planned and starts an agent on it — planning first only
   *  if there is nothing planned yet.
   *
   *  **The approval is this press.** `start_run` refuses an unapproved plan and
   *  both generating and editing clear the approval, so a chain that ran
   *  straight through would be refused unless somebody said go — pressing
   *  Execute is saying go. What it must never do is carry on past a decline: an
   *  AI that said it could not write the plan is not an AI whose plan should be
   *  handed to an agent.
   *
   *  **And it does not re-plan what is already planned.** It used to generate
   *  unconditionally, which threw away the plan somebody had just read — and
   *  possibly corrected by hand — and charged for the privilege. Re-planning is
   *  a deliberate act now, on the AI planning tab. */
  async function onExecute() {
    void logEvent("execute", `pressed on work item ${item.id}`, item.title);
    // **A press that cannot run says so; it is not swallowed.** These buttons
    // used to be disabled when something was missing, and a disabled button
    // eats the click — which is what "I press Execute and nothing happens" has
    // meant every time it has been reported. Now the press always lands and
    // the refusal is the answer.
    if (nothingToPlan) {
      const why = missing.join(" · ");
      setActionError(why);
      reportFailure("Execute", why);
      void logEvent("execute", "refused before starting", why);
      return;
    }
    if (planning !== undefined) {
      const why = `There is already a ${planning.state} job on this item. Wait for it, or clear it under "AI feedback".`;
      setActionError(why);
      reportFailure("Execute", why);
      void logEvent("execute", "refused before starting", why);
      return;
    }
    // Read once: `plans` is refreshed part-way through, and the message at the
    // end should describe what this press actually did.
    const planned = isPlanned(plans);
    setBusy(true);
    setActionError(null);
    setNotice(
      planned
        ? "Approving the plan and starting an agent…"
        : "Planning, then starting an agent…",
    );
    try {
      if (!planned) {
        const result = await generateChangePlan(item.id);
        if (result.blocked) {
          setNotice({ blocked: result.blocked, what: "inventing the rest" });
          // **A decline is the AI error.** It comes back as a result rather
          // than an exception, so it reached the notice in this panel and
          // nothing else — the one failure that is entirely the AI's, missing
          // from the box built for showing failures.
          reportFailure(
            "The AI declined",
            [result.blocked.reason, result.blocked.whatIsNeeded]
              .filter((part) => part.trim() !== "")
              .join(" — "),
          );
          await refresh();
          setGeneratedAt(Date.now());
          return;
        }
      }
      const fresh = await listWorkItemPlans(item.id);
      // **Every Solution is attempted, and both halves are reported.** One work
      // item can touch three repositories, and this loop used to stop at the
      // first refusal — so a Solution that started fine went unmentioned, the
      // ones after it were never tried, and a partial result read as a total
      // failure. A Solution with no folder on this machine is exactly that
      // case, and it says which one.
      const started: string[] = [];
      const refused: string[] = [];
      for (const p of fresh) {
        try {
          await setPlanApproval(item.id, p.solutionId, true);
          await startRun(item.id, p.solutionId);
          started.push(p.solutionName);
        } catch (e) {
          refused.push(`${p.solutionName}: ${String(e)}`);
        }
      }
      setNotice(
        started.length === 0
          ? null
          : `${planned ? "Approved and started" : "Planned, approved and started"} on ${started.join(", ")}. The agent is working in its own checkout — follow it on the Runs panel.`,
      );
      if (refused.length > 0) {
        const message = refused.join(" · ");
        setActionError(message);
        reportFailure("Execute", message);
      void logEvent("execute", "some Solutions refused", message);
      }
      await refresh();
      setGeneratedAt(Date.now());
      notifyWorkChanged();
    } catch (e) {
      setNotice(null);
      setActionError(String(e));
      // Said on the rail as well as here. This panel can be scrolled, tabbed
      // away from, or four components deep inside the Build view — "Execute
      // failed and nothing appeared" was all three at once.
      reportFailure("Execute", String(e));
      void logEvent("execute", "threw", String(e));
    } finally {
      setBusy(false);
    }
  }

  const openQuestions = questions.filter((q) => !q.resolved);
  const missing = whatIsMissing(item, plans, permission);
  /// The planning job in flight for this item, if any. Both buttons wait on it:
  /// a second submission while one is running would plan the same item twice
  /// and pay for it twice.
  const planning = jobs.find((j) => j.state === "queued" || j.state === "running");
  /// The last one that finished, so the panel can say how it went rather than
  /// going quiet and leaving somebody to guess.
  const lastJob = jobs.find((j) => j.state !== "queued" && j.state !== "running");
  const nothingToPlan = missing.length > 0;
  /// Whether the AI has already planned every Solution. Once it has, Plan is
  /// not offered and Execute stops re-planning.
  const planned = isPlanned(plans);

  return (
    <section className="build-plan" aria-label={`Build plan for ${item.title}`}>
      {loadError && <p role="alert">{loadError}</p>}
      {actionError && <p role="alert">{actionError}</p>}
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
      {/* **Both outcomes, not only the bad one.** A run that finished and said
          nothing is indistinguishable from one that never happened. And a
          failed run is reported as *the last attempt* rather than as the
          current state, because Plan is available again the moment it ends —
          the message is history, not a block. */}
      {!planning && lastJob && (
        <p
          className={`plan-status ${lastJob.state === "done" ? "plan-passed" : "plan-stopped"}`}
          role="status"
        >
          {lastJob.state === "done"
            ? "Planning passed — the plan is below, per Solution."
            : lastJob.state === "blocked"
              ? `The last planning attempt stopped and asked a question: ${lastJob.message} — answer it under "From Product", then plan again.`
              : lastJob.state === "cancelled"
                ? "The last planning attempt was cancelled. Plan again when you are ready."
                : `The last planning attempt failed: ${lastJob.message} — fix that and plan again.`}
        </p>
      )}

      {/* **Three sides, three tabs.** Product sets what customers get; Develop
          decides how it is built; and what the AI worked out from the two of
          them is a third thing, which somebody has to read before it is built.
          Product's half is read-only here — a requirement reworded by the
          person implementing it stops being a requirement — and the questions
          are the way across the line. */}
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
          { id: "ai", label: "AI planning" },
          // **The one assumption everything else on this panel makes.** A
          // branch cut from `main`, a worktree for an agent, a run at all —
          // none of it works if the Solution's folder is not a git repository,
          // and the only way to discover that was to press Execute and read a
          // red box with no way forward in it.
          { id: "git", label: "Git" },
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

      {view === "git" && (
        <div className="build-git">
          {plans.length === 0 ? (
            <p className="hint">
              Nothing to set up yet — attach a Solution under "What this
              changes" and its repository appears here.
            </p>
          ) : (
            plans.map((p) => {
              const sol = solutions.find((s) => s.id === p.solutionId);
              return sol ? (
                <SolutionRepo
                  key={p.id}
                  solution={sol}
                  onChange={() => void refresh()}
                />
              ) : (
                <p key={p.id} className="hint">
                  {p.solutionName} is attached but is not in this Product's
                  Solutions any more.
                </p>
              );
            })
          )}
        </div>
      )}

      {view === "ai" && (
        <AiPlanReview
          workItemId={item.id}
          plans={plans}
          onChanged={() => {
            void refresh();
            // The blocks in "What this changes" draw these schemas too; without
            // this they would keep showing the version before the edit.
            setGeneratedAt(Date.now());
          }}
        />
      )}

      {/* Product's screens land here as unassigned rows; this is where they get
          pointed at a Solution, and where the APIs and tables behind them are
          added. Kept mounted rather than unmounted when the other tab is
          showing: it holds unsaved edits in its own boxes, and switching tabs
          must not throw away something half-typed. */}
      <div hidden={view !== "develop"}>
      {/* **Develop's bit of the item's life.** The steps before it is ready
          for QA, ticked by the people doing them. Product sees all three gates
          on its own board; here there is one, because a checklist you cannot
          act on is noise on the screen of somebody trying to work. */}
      <WorkItemLifecycle
        workItemId={item.id}
        productId={item.productId}
        area="develop"
        onChanged={notifyWorkChanged}
      />

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
        {/* **Gone once there is a plan.** Planning again is a real thing to
            want, but it is a decision about the plan you are looking at, so it
            lives on the AI planning tab beside it. Left here it offered to pay
            for the same schemas twice, one press away from Execute. */}
        {!planned && (
          <button
            aria-label={`Plan ${item.title}`}
            aria-describedby={nothingToPlan ? "plan-blocked" : undefined}
            onClick={onSubmit}
            disabled={busy}
          >
            {planning ? "Planning…" : busy ? "Working…" : "Plan"}
          </button>
        )}
        <button
          aria-label={`Execute ${item.title}`}
          aria-describedby={nothingToPlan ? "plan-blocked" : undefined}
          onClick={onExecute}
          disabled={busy}
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
            {planned ? (
              <>
                It is planned. <strong>Execute</strong> approves the plan as it
                stands and starts an agent on it in its own checkout — read it
                under <strong>AI planning</strong> first, which is also where
                you change it or ask the AI to redo it.
              </>
            ) : (
              <>
                <strong>Plan</strong> queues it and returns at once, so you can
                write up the next item while this one plans — watch it in the AI
                queue on the Work tab. <strong>Execute</strong> plans it now,
                approves it, and starts an agent on it in its own checkout.
              </>
            )}
          </span>
        )}
      </div>
    </section>
  );
}
