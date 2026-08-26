import { useCallback, useEffect, useMemo, useState } from "react";
import { relativeTo } from "../../lib/breakpoints";
import { debugEvaluate } from "../../lib/backend";
import { useWorkChanged } from "../../lib/workSignal";
import AgentJobPanel from "./AgentJobPanel";
import AgentLane, { hueFor, markFor, status, type Agent } from "./AgentLane";
import AiLogPanel from "./AiLogPanel";
import BuildExplorer from "../code/BuildExplorer";
import CodeEditor from "../code/CodeEditor";
import BuildFileEditor from "../code/BuildFileEditor";
import ConsoleDock from "../code/ConsoleDock";
import DebugBoard from "../code/DebugBoard";
import DebugToolbar from "../code/DebugToolbar";
import RunBar, { type RunRequest } from "../code/RunBar";
import GitExplorer from "../vcs/GitExplorer";
import JobsPanel from "./JobsPanel";
import QuestionsPanel from "./QuestionsPanel";
import ReviewShipRail, { type TestVerdict } from "./ReviewShipRail";
import RunsPanel from "./RunsPanel";
import TestExplorer from "../testing/TestExplorer";
import {
  listAiJobs,
  listOpenQuestions,
  listRuns,
  listWorkItems,
  reviewSolutionChanges,
  settleChangeRun,
  type AiJob,
  type ChangeReview,
  type OpenQuestion,
  type Run,
  type Frame,
  type Solution,
  type WorkItem,
  type MySpace,
  listMySpaces,
  openMySpace,
  closeMySpace,
} from "../../lib/backend";
import { track } from "../../lib/saving";

/** The Build view: every agent down the left, the files in the middle, one
 *  agent's work in the workbench, and the decision to ship it down the right.
 *
 *  **Why the four panes.** They were four tabs describing one thing from four
 *  ends. AI knew which agents existed but could not show a line of what they
 *  wrote; Code showed the code but had no idea an agent had produced it; Tests
 *  and Git each answered across the whole Product and could not say which agent
 *  the answer belonged to. Following one agent from "queued" to "shipped" meant
 *  visiting all four and re-finding it in each. They are one screen now, and the
 *  agent you pick on the left is the subject of the other three.
 *
 *  **The change review is owned here**, not in the panes that show it. The
 *  workbench draws the diffs and the ship rail draws the totals, and if each ran
 *  git for itself the two could disagree about the same working copy.
 *
 *  **Editing by hand did not go away.** Your own workspace is the first lane
 *  card and the default — for reading a repository or a quick fix with no agent
 *  involved, which is still most of the time. */
export default function AgentWorkspace({
  productId,
  solutions,
  opened,
  onOpenWork,
  requestedAgent,
}: {
  productId: number;
  /** This Product's Solutions. */
  solutions: Solution[];
  /** A Solution opened from the Map tab, which lands in the editor. */
  opened: Solution | null;
  /** A work item whose agent the Map asked for. Carries a timestamp so asking
   *  twice for the same one still moves. */
  requestedAgent?: { workItemId: number; at: number } | null;
  /** Opens a work item in the Work tab. The lane links there for items with no
   *  agent on them — starting a run stays a press on the item's build plan. */
  onOpenWork?: (workItemId: number) => void;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [selected, setSelected] = useState<string>("code");
  const [error, setError] = useState<string | null>(null);
  /// Whether Debug has been opened at all. Nothing of it exists until it has:
  /// mounting the board on arrival would read every Solution's run command for
  /// somebody who never pressed the button.
  const [debugUsed, setDebugUsed] = useState(false);
  /// What the Debug board has been asked to start, and when the Debug button
  /// last asked the picker to start whatever it holds.
  const [runRequest, setRunRequest] = useState<RunRequest | null>(null);
  const [startNow, setStartNow] = useState(0);

  /// Which Solution the file tree is showing. Follows the selected agent's run;
  /// on your own workspace it is whichever Solution tab is picked.
  const [browsing, setBrowsing] = useState<number | null>(null);
  /// Your own worktrees on the Solution being browsed.
  ///
  /// **Read from git rather than remembered.** A worktree removed by hand is
  /// gone, and a lane still offering it would be offering a folder that is not
  /// there — the same rule the debugger's thread list follows.
  const [mySpaces, setMySpaces] = useState<MySpace[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  /// Which Solution the open file belongs to. Held apart from `browsing`
  /// because the Files pane can show the whole Product, so the file being
  /// edited need not come from the Solution the bar has selected.
  const [fileFrom, setFileFrom] = useState<number | null>(null);
  /// Where a debugger has stopped, when one has. Held here rather than in the
  /// Debug board because two panes need it: the editor draws the line, and the
  /// stepping toolbar has to stay reachable while you are looking at it.
  const [stop, setStop] = useState<{
    session: string;
    threadId: number;
    frame: Frame;
    solutionId: number;
    path: string;
    /** Whether this debugger answers a hover. Carried with the stop rather than
     *  asked for per pointer movement — it is settled when the session starts
     *  and does not change while one runs. */
    hovers: boolean;
  } | null>(null);

  /// One change review per Solution, read here so the workbench and the ship
  /// rail cannot disagree about the same working copy.
  const [review, setReview] = useState<ChangeReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [settled, setSettled] = useState<"kept" | "discarded" | null>(null);
  const [tests, setTests] = useState<TestVerdict>(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedItems, runs, jobs, questions] = await Promise.all([
        listWorkItems(productId),
        listRuns(productId),
        listAiJobs(productId),
        listOpenQuestions(productId),
      ]);

      const byItem = new Map<number, WorkItem>(loadedItems.map((i) => [i.id, i]));
      const openPerItem = questions.reduce<Record<number, number>>((counts, q: OpenQuestion) => {
        counts[q.workItemId] = (counts[q.workItemId] ?? 0) + 1;
        return counts;
      }, {});
      // The newest job per work item — an item replanned three times has three
      // rows, and only the current one is its state.
      const latestJob = new Map<number, AiJob>();
      for (const job of jobs) {
        const held = latestJob.get(job.workItemId);
        if (!held || job.submittedAt >= held.submittedAt) latestJob.set(job.workItemId, job);
      }

      const rows: Agent[] = [];
      for (const run of runs) {
        const item = byItem.get(run.workItemId);
        if (!item) continue;
        rows.push({
          key: `run-${run.workItemId}-${run.solutionId}`,
          item,
          run,
          job: latestJob.get(run.workItemId) ?? null,
          questions: openPerItem[run.workItemId] ?? 0,
        });
      }
      // A job with no run yet is still an agent at work — it is exactly the
      // "submitted and waiting" case, and leaving it out would make the lane go
      // empty at the moment there is most to watch.
      const itemsWithRuns = new Set(runs.map((r: Run) => r.workItemId));
      for (const job of latestJob.values()) {
        if (itemsWithRuns.has(job.workItemId)) continue;
        const item = byItem.get(job.workItemId);
        if (!item) continue;
        rows.push({
          key: `job-${job.workItemId}`,
          item,
          run: null,
          job,
          questions: openPerItem[job.workItemId] ?? 0,
        });
      }

      setAgents(rows);
      setItems(loadedItems);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The lane follows both halves without polling: the runner's own state
  // changes, and anything a person does in the panes beside it.
  useWorkChanged(refresh);

  const active = agents.find((a) => a.key === selected) ?? null;

  // Picking an agent moves the tree to its worktree's Solution, because "where
  // has this one been?" is the next question after "what is it doing?".
  useEffect(() => {
    if (active?.run) {
      setBrowsing(active.run.solutionId);
      setSelectedFile(null);
    }
  }, [active]);

  // A Solution opened from Map lands in your own workspace, with its tree beside
  // it — the point of Open is to be looking at that repository.
  useEffect(() => {
    if (opened) {
      setSelected("code");
      setBrowsing(opened.id);
    }
  }, [opened]);

  // An agent asked for from the Map. Matched against the lane's own keys rather
  // than rebuilt from the id, so a request that names an agent this Product no
  // longer has leaves the selection where it was instead of blanking it.
  useEffect(() => {
    if (!requestedAgent) return;
    const found = agents.find((a) => a.item.id === requestedAgent.workItemId);
    if (found) setSelected(found.key);
  }, [requestedAgent, agents]);

  // Deliberately no default Solution. "Nothing picked" is a real state now — it
  // means the Files pane shows the whole Product — so choosing one for somebody
  // would be choosing a narrower view than they asked for.

  // A review belongs to one working copy. Carrying one Solution's diffs onto
  // another's screen would be worse than showing nothing.
  useEffect(() => {
    setReview(null);
    setSettled(null);
    setTests(null);
  }, [browsing]);

  const onReview = useCallback(async () => {
    if (browsing === null) return;
    setReviewing(true);
    try {
      setReview(await reviewSolutionChanges(browsing));
      setSettled(null);
      setError(null);
    } catch (e) {
      setReview(null);
      setError(String(e));
    } finally {
      setReviewing(false);
    }
  }, [browsing]);

  const onSettle = useCallback(
    async (state: "kept" | "discarded") => {
      if (review?.runId == null) return;
      try {
        await settleChangeRun(review.runId, state);
        setSettled(state);
        setError(null);
        void refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [review, refresh],
  );

  /// How many agents are live in each Solution — the badge on its tab.
  const perSolution = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const a of agents) {
      if (!a.run) continue;
      const tone = status(a).tone;
      if (tone === "queued" || tone === "running" || tone === "prepared" || tone === "asking") {
        counts[a.run.solutionId] = (counts[a.run.solutionId] ?? 0) + 1;
      }
    }
    return counts;
  }, [agents]);

  const live = agents.filter((a) => {
    const tone = status(a).tone;
    return tone === "queued" || tone === "running" || tone === "prepared";
  }).length;

  /// Work items nobody has handed to an agent yet — what the lane's link card
  /// offers, and a real list rather than a guess.
  const withAgents = new Set(agents.map((a) => a.item.id));
  const unassigned = items.filter((i) => !withAgents.has(i.id));

  /** Opens the file a stop happened in, if it is one of ours, and comes back
   *  to it.
   *
   *  **A stop is the moment you want the code, not the board.** Pressing Debug
   *  leaves you on the process board, and the breakpoint then hits somewhere
   *  else entirely — the panel that mattered was rendered under the board you
   *  were still looking at. Coming back to the file is the whole point of
   *  having stopped there.
   *
   *  A frame in the Go runtime or in a dependency is a real frame at a real
   *  path that no Solution here can open — so the toolbar still appears and the
   *  stack still lists it, but no file is opened, nothing is highlighted and
   *  the view does not move. Jumping to a blank editor would be worse than
   *  staying put. */
  const onDebugStopped = useCallback(
    (at: { session: string; threadId: number; frame: Frame; hovers: boolean }) => {
      const owner = solutions.find(
        (s) => s.localPath && relativeTo(s.localPath, at.frame.path) !== null,
      );
      const relative = owner?.localPath
        ? relativeTo(owner.localPath, at.frame.path)
        : null;
      if (owner && relative) {
        setFileFrom(owner.id);
        setSelectedFile(relative);
        setStop({ ...at, solutionId: owner.id, path: relative });
        // The board keeps running behind this — it is hidden, not unmounted, so
        // the shells and the session survive the trip.
        setSelected("code");
        setBrowsing(owner.id);
      } else {
        setStop({ ...at, solutionId: -1, path: "" });
      }
    },
    [solutions],
  );

  /// Works out a name hovered in the editor, in the frame that is selected.
  ///
  /// **Only where it would mean something.** Nothing is offered unless a
  /// debugger is stopped in *this* file — a value from a program stopped
  /// somewhere else, or from a file the stop has nothing to do with, would be
  /// an answer to a question nobody asked. A refusal comes back as null so the
  /// editor simply shows nothing, which is what a hover over an ordinary word
  /// should do anyway.
  const hoverHere = useCallback(
    async (expression: string) => {
      if (!stop || !stop.hovers || stop.solutionId !== fileFrom || stop.path !== selectedFile) {
        return null;
      }
      try {
        const answer = await debugEvaluate(stop.session, expression, stop.frame.id, "hover");
        // An adapter answers an unknown name with an empty result rather than
        // an error, and a tooltip reading `total = ` is worse than none.
        return answer.value === "" ? null : { value: answer.value, kind: answer.kind };
      } catch {
        // Not in scope, not a variable, or a word that is not an expression at
        // all — hovering `func` should say nothing, not raise anything.
        return null;
      }
    },
    [stop, fileFrom, selectedFile],
  );

  const browsingSolution = solutions.find((s) => s.id === browsing) ?? null;

  /// Reloads your spaces whenever the Solution changes.
  ///
  /// Failure is quiet: a Solution with no repository, or one whose folder has
  /// gone, is a reason to have no spaces rather than a reason to put an error
  /// over the whole Build view.
  const refreshSpaces = useCallback(async (solutionId: number | null) => {
    if (solutionId === null) {
      setMySpaces([]);
      return;
    }
    try {
      setMySpaces(await listMySpaces(solutionId));
    } catch {
      setMySpaces([]);
    }
  }, []);

  useEffect(() => {
    void refreshSpaces(browsing);
  }, [browsing, refreshSpaces]);

  /// Opens another worktree of your own.
  ///
  /// The name is asked for rather than generated: two spaces called "space 2"
  /// and "space 3" are no easier to tell apart than two called nothing, and the
  /// name becomes a branch somebody will read again later.
  async function addSpace() {
    if (browsing === null) return;
    const name = window.prompt("What is this space for? It becomes a branch name.");
    if (name === null || name.trim() === "") return;
    try {
      const opened = await track("Your space", () => openMySpace(browsing, name.trim()));
      await refreshSpaces(browsing);
      // Selected straight away: somebody who just made one meant to work in it.
      setSelected(`space:${opened.path}`);
    } catch (e) {
      setError(String(e));
    }
  }

  /// Closes one. The checkout goes; the branch and its commits stay.
  async function dropSpace(path: string) {
    if (browsing === null) return;
    try {
      await track("Closing the space", () => closeMySpace(browsing, path));
      await refreshSpaces(browsing);
      // Back to the main copy if the one being watched is the one that went.
      setSelected((was) => (was === `space:${path}` ? "code" : was));
    } catch (e) {
      setError(String(e));
    }
  }
  const openFileSolution = solutions.find((s) => s.id === fileFrom) ?? null;
  const selectedChange =
    review?.changes.find((c) => c.path === selectedFile) ?? null;

  return (
    <section className="build-view" aria-label="Build">
      {/* The Solutions across the top, each saying how many agents are inside
          it — the one thing you cannot see from a lane sorted by work item. */}
      <div className="solution-bar" role="tablist" aria-label="Solutions">
        {/* "All" is a real choice, not the absence of one: it scopes the Files
            pane to the whole Product, which is where you start when you do not
            yet know which repository the thing you are looking for is in. */}
        <button
          type="button"
          role="tab"
          aria-selected={browsing === null}
          className={browsing === null ? "solution-tab on all" : "solution-tab all"}
          onClick={() => {
            setBrowsing(null);
            setSelectedFile(null);
          }}
        >
          <span className="solution-name">All Solutions</span>
          <span className="solution-badge">{solutions.length}</span>
        </button>
        {solutions.map((s) => {
          const count = perSolution[s.id] ?? 0;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={browsing === s.id}
              className={browsing === s.id ? "solution-tab on" : "solution-tab"}
              style={{ "--agent-hue": hueFor(s.id) } as React.CSSProperties}
              onClick={() => {
                setBrowsing(s.id);
                setSelectedFile(null);
              }}
            >
              <span className="solution-mark" aria-hidden="true">
                {markFor(s.name)}
              </span>
              <span className="solution-name">{s.name}</span>
              <span className={count > 0 ? "solution-badge live" : "solution-badge"}>
                {count > 0 ? `${count} live` : "idle"}
              </span>
            </button>
          );
        })}
        <span className="solution-bar-spacer" />
        {/* In the middle, in line with Debug: which Solutions to run, what to
            run in each, and the two presses. */}
        <RunBar
          solutions={solutions}
          browsing={browsing}
          startNow={startNow}
          onRun={setRunRequest}
        />
        <span className="solution-bar-spacer" />
        {/* Debug is a Product-wide thing, not an agent's — it runs the real
            Solutions in their own working copies — so it sits up here with the
            Solutions rather than inside one agent's workbench. */}
        <button
          type="button"
          className={selected === "debug" ? "debug-button on" : "debug-button"}
          // Named for what it opens, not just "Debug": the board it opens
          // holds a Debug button per Solution, and two controls called the
          // same thing is ambiguous to anyone reading by label.
          aria-label="Open the Debug board"
          aria-pressed={selected === "debug"}
          onClick={() => {
            if (selected === "debug") {
              setSelected("code");
              return;
            }
            setDebugUsed(true);
            setSelected("debug");
            // **Debug starts the thing.** It used to open a board of Solutions
            // that each then needed attaching and running — three presses to
            // get to the state the word "Debug" already promised. What runs is
            // whatever the picker says, which defaults to the Solution you are
            // on and can be any number of them.
            setStartNow(Date.now());
          }}
        >
          <span aria-hidden="true">▶</span> Debug
        </button>
        <span className="global-agents">
          <span className={live > 0 ? "pulse on" : "pulse"} aria-hidden="true" />
          <strong>
            {live}/{agents.length}
          </strong>
          <span>agents working</span>
        </span>
      </div>

      {error && <p role="alert">{error}</p>}

      <div className="build-body">
        <AgentLane
          agents={agents}
          selected={selected}
          onSelect={setSelected}
          yourFolder={browsingSolution?.localPath ?? null}
          mySpaces={mySpaces}
          // Only where there is somewhere to make one: no Solution, or one with
          // no working copy here, means no button rather than one that could
          // only fail.
          onOpenSpace={browsingSolution?.localPath ? addSpace : undefined}
          onCloseSpace={browsingSolution?.localPath ? dropSpace : undefined}
          unassigned={unassigned}
          onOpenWork={onOpenWork}
        />

        {/* The tree is out here rather than inside a pane because it belongs to
            the Solution, not to whichever agent happens to be selected. Both
            the Product-wide panes want the width instead. */}
        {selected !== "all" && selected !== "debug" && (
          <BuildExplorer
            productId={productId}
            solutions={solutions}
            solutionId={browsing}
            selectedPath={selectedFile}
            onSelectFile={(solutionId, path) => {
              setFileFrom(solutionId);
              setSelectedFile(path);
            }}
          />
        )}

        <div className="build-main">
          {/* Above the pane rather than inside one: the whole point is that
              stepping stays reachable while you are looking at the line it
              acts on. */}
          {stop && (
            <DebugToolbar
              session={stop.session}
              threadId={stop.threadId}
              frame={stop.frame}
              onResumed={() => setStop(null)}
            />
          )}
          {/* A file picked in the Files pane wins the pane: clicking a file is
              a request to look at it, whatever else was showing. Closing it
              puts the previous pane back. */}
          {openFileSolution && selectedFile ? (
            <BuildFileEditor
              solution={openFileSolution}
              path={selectedFile}
              stoppedLine={
                stop && stop.solutionId === openFileSolution.id && stop.path === selectedFile
                  ? stop.frame.line
                  : null
              }
              onHover={
                stop?.hovers && stop.solutionId === openFileSolution.id ? hoverHere : undefined
              }
              onClose={() => {
                setSelectedFile(null);
                setFileFrom(null);
              }}
            />
          ) : (
            selected === "code" && <CodeEditor solutions={solutions} opened={opened} />
          )}

          {/* **The console lives with the code**, because output belongs beside
              the line that produced it — a console on another tab means
              alt-tabbing between the thing that broke and the reason. Drag its
              header to pull it onto the other monitor.

              Only where there is a working copy to run in, and not while the
              Debug board is up: that board has its own shells per Solution, and
              two panels adopting the same PTY would fight over its size. */}
          {selected !== "debug" && browsingSolution?.localPath && (
            <ConsoleDock
              // Keyed per Solution so switching tabs does not carry one
              // Solution's shell under another one's name.
              key={browsingSolution.id}
              solution={browsingSolution}
              active={selected !== "debug"}
            />
          )}

          {/* Mounted on first use and then hidden rather than unmounted, so a
              dev server survives a trip to a diff and back. Unmounting it was
              the honest first cut — a shell is a real child process — but it
              meant every look at another pane killed everything that was up.
              The boundary is the Build view itself: leaving Develop's Build tab
              unmounts this whole component, and the shells close with it. */}
          {debugUsed && (
            <div hidden={selected !== "debug"}>
              <DebugBoard
                solutions={solutions}
                active={selected === "debug"}
                // Pressing Debug, Run or Hot reload lands here as one request:
                // attach a shell to each and type its command into it.
                run={runRequest}
                onStopped={onDebugStopped}
                onResumed={() => setStop(null)}
              />
            </div>
          )}

          {selected === "all" && (
            <div className="agent-overview">
              <JobsPanel productId={productId} />
              <QuestionsPanel productId={productId} />
              <RunsPanel productId={productId} />
              {/* Tests and Git across every Solution moved in here when they
                  stopped being tabs of their own. The workbench answers them
                  for one agent; this is the same two questions asked of the
                  whole Product, which is the only thing a per-agent view
                  cannot do. */}
              <TestExplorer productId={productId} />
              <GitExplorer productId={productId} />
              {/* Last, because it is the record rather than the work: what has
                  already happened, for when something reads wrong and you want to
                  see what was actually asked. */}
              <AiLogPanel productId={productId} />
            </div>
          )}

          {active && (
            <AgentJobPanel
              // Remounted per agent so no sub-panel state leaks between them —
              // agent A's open terminal must not appear under agent B.
              key={active.key}
              agent={active}
              item={active.item}
              run={active.run}
              solutions={solutions}
              onRunChanged={refresh}
              review={review}
              reviewing={reviewing}
              onReview={onReview}
              selectedPath={selectedFile}
              onSelectFile={(solutionId, path) => {
                setFileFrom(solutionId);
                setSelectedFile(path);
              }}
              onTests={setTests}
            />
          )}
        </div>

        {selected !== "all" && selected !== "debug" && (
          <ReviewShipRail
            agentLabel={active ? active.item.title : "your workspace"}
            run={active?.run ?? null}
            solution={browsingSolution}
            review={review}
            reviewing={reviewing}
            onReview={onReview}
            onSettle={onSettle}
            settled={settled}
            tests={tests}
            selectedPath={selectedFile}
            selectedChange={selectedChange}
          />
        )}
      </div>
    </section>
  );
}
