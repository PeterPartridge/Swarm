import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkChanged } from "../../lib/workSignal";
import AgentJobPanel from "./AgentJobPanel";
import AgentLane, { hueFor, markFor, status, type Agent } from "./AgentLane";
import AiLogPanel from "./AiLogPanel";
import BuildExplorer from "../code/BuildExplorer";
import CodeEditor from "../code/CodeEditor";
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
  type Solution,
  type WorkItem,
} from "../../lib/backend";

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

  /// Which Solution the file tree is showing. Follows the selected agent's run;
  /// on your own workspace it is whichever Solution tab is picked.
  const [browsing, setBrowsing] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

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

  // Something has to be browsing, or the tree and the ship rail open blank and
  // the first thing anybody does is pick a Solution the view could have picked
  // for them. The first one is as good an opening guess as exists.
  useEffect(() => {
    if (browsing === null && solutions.length > 0) setBrowsing(solutions[0].id);
  }, [browsing, solutions]);

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

  const browsingSolution = solutions.find((s) => s.id === browsing) ?? null;
  const selectedChange =
    review?.changes.find((c) => c.path === selectedFile) ?? null;

  return (
    <section className="build-view" aria-label="Build">
      {/* The Solutions across the top, each saying how many agents are inside
          it — the one thing you cannot see from a lane sorted by work item. */}
      <div className="solution-bar" role="tablist" aria-label="Solutions">
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
          unassigned={unassigned}
          onOpenWork={onOpenWork}
        />

        {/* The tree is out here rather than inside a pane because it belongs to
            the Solution, not to whichever agent happens to be selected. */}
        {selected !== "all" && (
          <BuildExplorer
            productId={productId}
            solutions={solutions}
            solutionId={browsing}
            selectedPath={selectedFile}
            onSelectFile={(solutionId, path) => {
              setBrowsing(solutionId);
              setSelectedFile(path);
            }}
          />
        )}

        <div className="build-main">
          {selected === "code" && <CodeEditor solutions={solutions} opened={opened} />}

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
                setBrowsing(solutionId);
                setSelectedFile(path);
              }}
              onTests={setTests}
            />
          )}
        </div>

        {selected !== "all" && (
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
