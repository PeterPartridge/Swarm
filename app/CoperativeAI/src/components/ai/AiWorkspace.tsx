import JobsPanel from "./JobsPanel";
import QuestionsPanel from "./QuestionsPanel";
import RunsPanel from "./RunsPanel";

/** One place to manage every agent at once.
 *
 *  The queue and the runs used to sit above the Work board, which put them in
 *  the middle of planning and gave them no room. They belong together and apart
 *  from the board: submitting work, answering what comes back, and starting the
 *  agents that build it are one activity, and with several agents in flight it
 *  needs the whole tab.
 *
 *  Read top to bottom, it is the loop: **Queue** is what has been submitted and
 *  what is waiting behind it; **Questions** is what the AI stopped to ask, which
 *  blocks that work until answered; **Runs** is the agents themselves — one
 *  checkout each, their terminals side by side, and the merge home. */
export default function AiWorkspace({ productId }: { productId: number }) {
  return (
    <section className="ai-workspace" aria-label="AI">
      <p className="hint">
        Everything the AI is doing for this Product. Submit work items for
        planning from a work item's build plan; they arrive here.
      </p>

      <JobsPanel productId={productId} />
      <QuestionsPanel productId={productId} />
      <RunsPanel productId={productId} />
    </section>
  );
}
