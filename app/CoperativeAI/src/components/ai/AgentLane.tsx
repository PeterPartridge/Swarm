import type { AiJob, Run, WorkItem } from "../../lib/backend";

/** One row in the lane: an agent working on a work item, in a Solution once it
 *  has got as far as a run.
 *
 *  Planning jobs and execution runs are separate records in the database, and
 *  keeping them separate in the UI is what made an agent hard to follow — you
 *  watched it queue in one list, then found it again in another. A lane entry is
 *  whichever of the two is current for that pair. */
export interface Agent {
  /** Stable across a refresh, so selection survives one. */
  key: string;
  item: WorkItem;
  run: Run | null;
  job: AiJob | null;
  /** How many unanswered questions are blocking it. */
  questions: number;
}

/** What the lane badge says, in the order that matters most first: a question
 *  blocks everything until answered, so it outranks the run's own state. */
export function status(agent: Agent): { text: string; tone: string } {
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

/** The four stages a piece of work passes through, in order.
 *
 *  **Every one of these is a state the database actually holds** — a plan being
 *  written, a checkout with an agent in it, a diff waiting to be read, and a
 *  decision recorded against the run. There is deliberately no percentage bar
 *  beside them: the app cannot see how far through its work an agent is, and a
 *  number that looked like progress would be invented. The stage it has reached
 *  is the honest version of the same answer. */
export const PHASES = ["Plan", "Code", "Review", "Done"] as const;

/** Which stage this agent has reached, as an index into `PHASES`. */
export function phaseOf(agent: Agent): number {
  const state = agent.run?.state;
  if (state === "kept" || state === "discarded") return 3;
  if (state === "reviewed") return 2;
  if (state === "prepared") return 1;
  return 0;
}

/** A stable colour per Solution, so an agent, the files it touched and the
 *  Solution tab all carry the same hue.
 *
 *  Keyed on the Solution rather than the model, because that is the axis this
 *  app actually has: a run belongs to a repository, and "which repository is
 *  this agent inside?" is the question the colour is answering.
 *
 *  **Eight, and it repeats after that.** It is a palette, so a Product with nine
 *  Solutions has two sharing a colour — that is inherent rather than a bug, and
 *  eight is where the hues stop being reliably distinguishable from each other.
 *  Keyed on the id rather than the position in the list on purpose: a Solution's
 *  colour must not change when another one is created or deleted. */
const HUES = [
  "#0a84ff",
  "#4ec9b0",
  "#bf5af2",
  "#ff8a5b",
  "#ffb340",
  "#5ac8fa",
  "#e8639b",
  "#8fd14f",
];

export function hueFor(solutionId: number | null): string {
  if (solutionId === null) return "#6cb6ff";
  return HUES[Math.abs(solutionId) % HUES.length];
}

/** Up to two letters for the avatar — the Solution's initials, so the mark in
 *  the lane, in the file tree and on the Solution tab are the same mark. */
export function markFor(name: string): string {
  const words = name.trim().split(/[\s\-_/]+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** The agents down the left of the Build view, each in its own worktree.
 *
 *  A card carries what a person needs before deciding to open it: whose work it
 *  is, which repository, how far it has got, and the last thing the agent said.
 *  The old rail was a title and a badge, which meant opening every one to find
 *  out which had stopped and why. */
export default function AgentLane({
  agents,
  selected,
  onSelect,
  yourFolder,
  unassigned,
  onOpenWork,
}: {
  agents: Agent[];
  /** `"code"` for your own working copy, `"all"` for the across-the-Product
   *  lists, or an agent's key. */
  selected: string;
  onSelect: (key: string) => void;
  /** The folder the plain editor has open, shown on the "your workspace" card.
   *  Null when nothing has been opened. */
  yourFolder: string | null;
  /** Work items with no agent on them yet, newest first. */
  unassigned: WorkItem[];
  /** Opens one of them in Work. Absent when there is nowhere to send it. */
  onOpenWork?: (workItemId: number) => void;
}) {
  const working = agents.filter((a) => {
    const tone = status(a).tone;
    return tone === "queued" || tone === "running" || tone === "prepared";
  }).length;
  const waiting = agents.filter((a) => a.questions > 0).length;

  return (
    <nav className="agent-lane" aria-label="Agents">
      <div className="lane-head">
        <div className="lane-title">
          <span>Agents</span>
          <span className="lane-count">
            {working} working
            {waiting > 0 && ` · ${waiting} waiting on you`}
          </span>
        </div>
        <p className="lane-sub">Each one in its own worktree</p>
      </div>

      <div className="lane-cards">
        {/* Your own working copy, first and always present: the times there is
            no agent involved at all are still most of them, and an empty lane
            would read as a broken tab. */}
        <button
          type="button"
          className={`agent-card yours ${selected === "code" ? "card-active" : ""}`}
          aria-pressed={selected === "code"}
          aria-label="Your workspace"
          style={{ "--agent-hue": "#6cb6ff" } as React.CSSProperties}
          onClick={() => onSelect("code")}
        >
          <span className="card-rail" aria-hidden="true" />
          <span className="card-top">
            <span className="card-avatar">You</span>
            <span className="card-who">
              <strong>Your workspace</strong>
              <span className="card-mono">{yourFolder ?? "nothing opened yet"}</span>
            </span>
            <span className="card-status yours">yours</span>
          </span>
          <span className="card-line">
            <span className="card-chip">by hand</span>
            <span className="card-summary">Edit any Solution directly</span>
          </span>
        </button>

        <div className="lane-divider">
          <span>agent worktrees</span>
        </div>

        {agents.length === 0 && (
          <p className="hint">
            None yet. Submit a work item for planning from its build plan and it
            appears here.
          </p>
        )}

        {agents.map((agent) => {
          const badge = status(agent);
          const phase = phaseOf(agent);
          const hue = hueFor(agent.run?.solutionId ?? null);
          const tail = agent.job?.message?.trim() ?? "";
          return (
            <button
              key={agent.key}
              type="button"
              className={`agent-card ${selected === agent.key ? "card-active" : ""}`}
              aria-pressed={selected === agent.key}
              aria-label={`Agent for ${agent.item.title}${
                agent.run ? ` on ${agent.run.solutionName}` : ""
              }`}
              style={{ "--agent-hue": hue } as React.CSSProperties}
              onClick={() => onSelect(agent.key)}
            >
              <span className="card-rail" aria-hidden="true" />

              <span className="card-top">
                <span className="card-avatar">
                  {agent.run ? markFor(agent.run.solutionName) : "··"}
                </span>
                <span className="card-who">
                  <strong>{agent.item.title}</strong>
                  <span className="card-mono">
                    {agent.run ? agent.run.solutionName : "no Solution yet"}
                  </span>
                </span>
                <span className={`card-status ${badge.tone}`}>{badge.text}</span>
              </span>

              <span className="card-line">
                <span className="card-chip">#{agent.item.id}</span>
                <span className="card-summary">
                  {agent.item.itemType}
                  {agent.job ? ` · ${agent.job.purpose}` : ""}
                </span>
              </span>

              {/* The stage, not a percentage. See PHASES. */}
              <span className="card-phases" aria-label={`Stage: ${PHASES[phase]}`}>
                {PHASES.map((label, i) => (
                  <span
                    key={label}
                    className={`phase ${i < phase ? "phase-done" : ""} ${
                      i === phase ? "phase-now" : ""
                    }`}
                  >
                    <span className="phase-dot" aria-hidden="true" />
                    <span className="phase-label">{label}</span>
                  </span>
                ))}
              </span>

              {tail !== "" && (
                <span className="card-tail">
                  <span className="tail-dot" aria-hidden="true" />
                  <span className="tail-text">{tail}</span>
                </span>
              )}

              <span className="card-foot">
                {agent.run && agent.run.filesChanged > 0 && (
                  <span>
                    {agent.run.filesChanged} file
                    {agent.run.filesChanged === 1 ? "" : "s"}
                  </span>
                )}
                {agent.run?.branch && <span className="card-mono">{agent.run.branch}</span>}
              </span>
            </button>
          );
        })}

        {/* A link, not a launcher. Handing work to an agent means approving a
            plan and pressing Start, and both of those are deliberate presses
            that live on the item's build plan — so this opens the item there
            rather than growing a second way to begin a run. */}
        {unassigned.length > 0 && onOpenWork && (
          <button
            type="button"
            className="agent-card everything"
            aria-label={`Open ${unassigned[0].title} in Work`}
            onClick={() => onOpenWork(unassigned[0].id)}
          >
            <span className="card-top">
              <span className="card-avatar plain" aria-hidden="true">
                ＋
              </span>
              <span className="card-who">
                <strong>Hand a work item to an agent</strong>
                <span className="card-mono">
                  {unassigned.length} item{unassigned.length === 1 ? "" : "s"} with no
                  agent · opens in Work
                </span>
              </span>
            </span>
          </button>
        )}

        <button
          type="button"
          className={`agent-card everything ${selected === "all" ? "card-active" : ""}`}
          aria-pressed={selected === "all"}
          onClick={() => onSelect("all")}
        >
          <span className="card-top">
            <span className="card-avatar plain" aria-hidden="true">
              ☰
            </span>
            <span className="card-who">
              <strong>Queue, questions and runs</strong>
              <span className="card-mono">Across the Product</span>
            </span>
          </span>
        </button>
      </div>
    </nav>
  );
}
