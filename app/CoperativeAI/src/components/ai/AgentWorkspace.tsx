import { useCallback, useEffect, useState } from "react";
import { useWorkChanged } from "../../lib/workSignal";
import AgentJobPanel from "./AgentJobPanel";
import AiLogPanel from "./AiLogPanel";
import CodeEditor from "../code/CodeEditor";
import JobsPanel from "./JobsPanel";
import QuestionsPanel from "./QuestionsPanel";
import RunsPanel from "./RunsPanel";
import {
  listAiJobs,
  listOpenQuestions,
  listRuns,
  listWorkItems,
  type AiJob,
  type OpenQuestion,
  type Run,
  type Solution,
  type WorkItem,
} from "../../lib/backend";

/** One row in the rail: an agent working on a work item, in a Solution when it
 *  has got as far as a run.
 *
 *  Planning jobs and execution runs are separate records in the database, and
 *  keeping them separate in the UI is what made an agent hard to follow — you
 *  watched it queue in one list, then found it again in another. A rail entry is
 *  whichever of the two is current for that pair. */
interface Agent {
  /** Stable across a refresh, so selection survives one. */
  key: string;
  item: WorkItem;
  run: Run | null;
  job: AiJob | null;
  /** How many unanswered questions are blocking it. */
  questions: number;
}

/** What the rail badge says, in the order that matters most first: a question
 *  blocks everything until answered, so it outranks the run's own state. */
function status(agent: Agent): { text: string; tone: string } {
  if (agent.questions > 0) {
    return {
      text: `${agent.questions} question${agent.questions === 1 ? "" : "s"}`,
      tone: "asking",
    };
  }
  if (agent.job && (agent.job.state === "queued" || agent.job.state === "running")) {
    return { text: agent.job.state === "queued" ? "queued" : "planning", tone: agent.job.state };
  }
  if (agent.job?.state === "failed") return { text: "failed", tone: "failed" };
  if (agent.job?.state === "blocked") return { text: "blocked", tone: "blocked" };
  if (agent.run) {
    return {
      text: agent.run.state === "notStarted" ? "ready" : agent.run.state,
      tone: agent.run.state,
    };
  }
  return { text: "planned", tone: "done" };
}

/** AI and Code as one panel: every agent down the left, its work on the right.
 *
 *  **Why they merged.** They were two tabs describing one thing from two ends.
 *  The AI tab knew which agents existed and what they were waiting on but could
 *  not show a line of what they wrote; the Code tab could show the code but had
 *  no idea an agent had produced it — it opened whichever Solution you picked,
 *  and its single terminal meant one agent at a time. Following one agent from
 *  "queued" to "here is the diff" meant switching tabs and re-finding it.
 *
 *  **Code editing did not go away.** The first rail entry is the plain editor,
 *  unchanged, for the times there is no agent involved at all — reading a
 *  repository, a quick fix by hand. It is first because it is the one entry
 *  always available; an empty rail otherwise would suggest the tab was broken.
 *
 *  **The old lists are still here, at the bottom of the rail**, because a
 *  per-agent view answers "what is this one doing?" and cannot answer "what is
 *  everything doing?" — the queue as a whole, every open question in one place,
 *  and the runs with their merges are still that second question's answer. */
export default function AgentWorkspace({
  productId,
  solutions,
  opened,
}: {
  productId: number;
  /** This Product's Solutions. */
  solutions: Solution[];
  /** A Solution opened from the Workspace tab, which lands in the editor. */
  opened: Solution | null;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string>("code");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [items, runs, jobs, questions] = await Promise.all([
        listWorkItems(productId),
        listRuns(productId),
        listAiJobs(productId),
        listOpenQuestions(productId),
      ]);

      const byItem = new Map<number, WorkItem>(items.map((i) => [i.id, i]));
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
      // "submitted and waiting" case, and leaving it out would make the rail go
      // empty at the moment there is most to watch.
      const itemsWithRuns = new Set(runs.map((r) => r.workItemId));
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
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The rail follows both halves without polling: the runner's own state
  // changes, and anything a person does in the sub-panels beside it.
  useWorkChanged(refresh);

  const active = agents.find((a) => a.key === selected) ?? null;

  return (
    <section className="agent-workspace" aria-label="Agents and code">
      <nav className="agent-rail" aria-label="Agents">
        <button
          type="button"
          className={`agent-rail-entry ${selected === "code" ? "rail-active" : ""}`}
          aria-pressed={selected === "code"}
          onClick={() => setSelected("code")}
        >
          <strong>Code</strong>
          <span className="rail-sub">Edit by hand</span>
        </button>

        <h3 className="rail-heading">Agents ({agents.length})</h3>
        {agents.length === 0 && (
          <p className="hint">
            None yet. Submit a work item for planning from its build plan and it
            appears here.
          </p>
        )}
        {agents.map((agent) => {
          const badge = status(agent);
          return (
            <button
              key={agent.key}
              type="button"
              className={`agent-rail-entry ${selected === agent.key ? "rail-active" : ""}`}
              aria-pressed={selected === agent.key}
              aria-label={`Agent for ${agent.item.title}${
                agent.run ? ` on ${agent.run.solutionName}` : ""
              }`}
              onClick={() => setSelected(agent.key)}
            >
              <strong>{agent.item.title}</strong>
              {agent.run && <span className="rail-sub">{agent.run.solutionName}</span>}
              <span className={`rail-state ${badge.tone}`}>{badge.text}</span>
            </button>
          );
        })}

        <h3 className="rail-heading">Everything at once</h3>
        <button
          type="button"
          className={`agent-rail-entry ${selected === "all" ? "rail-active" : ""}`}
          aria-pressed={selected === "all"}
          onClick={() => setSelected("all")}
        >
          <strong>Queue, questions and runs</strong>
          <span className="rail-sub">Across the Product</span>
        </button>
      </nav>

      <div className="agent-main">
        {error && <p role="alert">{error}</p>}

        {selected === "code" && <CodeEditor solutions={solutions} opened={opened} />}

        {selected === "all" && (
          <div className="agent-overview">
            <JobsPanel productId={productId} />
            <QuestionsPanel productId={productId} />
            <RunsPanel productId={productId} />
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
            item={active.item}
            run={active.run}
            solutions={solutions}
            onRunChanged={refresh}
          />
        )}
      </div>
    </section>
  );
}
