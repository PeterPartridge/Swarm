import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkChanged } from "../../lib/workSignal";
import {
  getWorkItemPolicy,
  listAiFeedback,
  listAiProviders,
  listOpenQuestions,
  listRuns,
  listWorkItemPlans,
  TYPE_LABELS,
  type AiFeedback,
  type AiProvider,
  type Run,
  type WorkItem,
  type WorkItemPlan,
  type WorkItemPolicy,
} from "../../lib/backend";

/** One thing a work item needs before an agent can be trusted with it. */
export interface Ready {
  label: string;
  met: boolean;
  /** What to write, or where, when it is not met. */
  missing: string;
}

/** What a work item still needs, judged only on facts the Product can be asked
 *  for in one read each.
 *
 *  **Why these five.** Every one is a real column or row, not a guess: the ask
 *  itself, whether the work has reached a repository, the build notes an agent
 *  is handed, whether anything is still blocking, and whether a person has
 *  approved the plan — which is the gate `prepare_run` actually enforces, so it
 *  belongs on the list that claims to say whether this can be handed over.
 *
 *  **The score is a count, not a prediction.** Five facts, so many met. The
 *  design this came from showed a "ready %" beside the words "the agent lands it
 *  first try", which would be a claim about the future that nothing here can
 *  support. `4 of 5` says the same useful thing and only the true part. */
export function readinessOf(
  item: WorkItem,
  runs: Run[],
  openQuestions: number,
): Ready[] {
  const mine = runs.filter((r) => r.workItemId === item.id);
  return [
    {
      label: "what is asked for",
      met: (item.description ?? "").trim() !== "",
      missing: "The description is empty — an agent has nothing to build against.",
    },
    {
      label: "a Solution",
      met: mine.length > 0,
      missing: "No Solution is attached, so the work has no repository to land in.",
    },
    // **No "how to build it" check.** It measured a work-item-wide notes box
    // removed on 2026-08-21, so keeping it would mark every item permanently
    // unready for a field that cannot be filled in. What replaced it — the
    // per-Solution "what has to change" — is not loaded for every row here,
    // only for the one being looked at, so it is checked in the briefing panel
    // rather than counted in this list.
    {
      label: "nothing blocking",
      met: openQuestions === 0,
      missing: `${openQuestions} question${openQuestions === 1 ? "" : "s"} unanswered.`,
    },
    {
      label: "plan approved",
      met: mine.length > 0 && mine.every((r) => r.planApproved),
      missing: "A run refuses to start until somebody has read the plan and approved it.",
    },
  ];
}

/** Splits a plan's free text into lines worth listing, dropping the blanks. */
const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter((l) => l !== "");

/** Work items by how ready they are to be handed over, with the briefing an
 *  agent would actually receive down the right.
 *
 *  This is the Work view's front page because it is the question the other three
 *  views cannot answer: Board says where an item is, Sprint says when, List says
 *  everything at once — none of them says whether the thing is *scoped well
 *  enough to hand over*, which is the decision anybody standing here is making.
 *
 *  **Three reads, not two per item.** Readiness for every row comes from
 *  `listWorkItems`, `listRuns` and `listOpenQuestions`, all Product-wide — a
 *  per-item lookup would be a hundred calls on a Product with fifty items. The
 *  briefing panel loads the selected item's plans in full, because that is one
 *  item at a time. */
export default function WorkReadiness({
  productId,
  items,
  onOpenPlan,
  onOpenAgent,
  /** An item asked for from elsewhere — the Build view's lane links here. */
  requestedItem,
}: {
  productId: number;
  items: WorkItem[];
  /** Opens the build plan for an item, which is where scoping is fixed and
   *  where the plan is approved. */
  onOpenPlan: (item: WorkItem) => void;
  /** Opens an item's agent over in Build. An item that already has one is not
   *  a scoping question any more, so its row points at the work instead. */
  onOpenAgent?: (workItemId: number) => void;
  requestedItem?: number | null;
}) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [questions, setQuestions] = useState<Record<number, number>>({});
  const [filter, setFilter] = useState<"ready" | "scoping" | "all">("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /// The selected item's briefing — loaded one item at a time, so the detail
  /// costs three reads rather than three per row.
  const [plans, setPlans] = useState<WorkItemPlan[]>([]);
  const [feedback, setFeedback] = useState<AiFeedback[]>([]);
  const [policy, setPolicy] = useState<WorkItemPolicy | null>(null);
  const [providers, setProviders] = useState<AiProvider[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [loadedRuns, open] = await Promise.all([
        listRuns(productId),
        listOpenQuestions(productId),
      ]);
      setRuns(loadedRuns);
      setQuestions(
        open.reduce<Record<number, number>>((counts, q) => {
          counts[q.workItemId] = (counts[q.workItemId] ?? 0) + 1;
          return counts;
        }, {}),
      );
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useWorkChanged(refresh);

  // An item asked for from the Build view wins over whatever was selected, and
  // only while it is asking — otherwise coming back here would keep dragging the
  // selection to an item somebody looked at once.
  useEffect(() => {
    if (requestedItem != null) setSelected(requestedItem);
  }, [requestedItem]);

  const rows = useMemo(
    () =>
      items.map((item) => {
        const checks = readinessOf(item, runs, questions[item.id] ?? 0);
        const mine = runs.filter((r) => r.workItemId === item.id);
        return {
          item,
          checks,
          met: checks.filter((c) => c.met).length,
          // A run past "notStarted" means an agent already has a checkout, which
          // is a different answer from "ready to hand over".
          working: mine.find((r) => r.state !== "notStarted") ?? null,
        };
      }),
    [items, runs, questions],
  );

  const readyCount = rows.filter((r) => r.met === r.checks.length).length;
  const shown = rows.filter((r) =>
    filter === "ready"
      ? r.met === r.checks.length
      : filter === "scoping"
        ? r.met < r.checks.length
        : true,
  );

  const chosen = rows.find((r) => r.item.id === selected) ?? null;

  const loadBriefing = useCallback(async () => {
    if (selected === null) return;
    try {
      const [loadedPlans, loadedFeedback, loadedPolicy] = await Promise.all([
        listWorkItemPlans(selected),
        listAiFeedback(selected),
        getWorkItemPolicy(selected),
      ]);
      setPlans(loadedPlans);
      setFeedback(loadedFeedback);
      setPolicy(loadedPolicy);
    } catch (e) {
      setError(String(e));
    }
  }, [selected]);

  useEffect(() => {
    void loadBriefing();
  }, [loadBriefing]);

  useEffect(() => {
    void (async () => {
      try {
        setProviders(await listAiProviders());
      } catch {
        // Naming the provider is a nicety on the briefing; failing to read the
        // list must not take the briefing down with it.
      }
    })();
  }, []);

  const unresolved = feedback.filter((f) => !f.resolved);
  const providerName =
    policy?.providerId == null
      ? "the Product's default"
      : (providers.find((p) => p.id === policy.providerId)?.name ?? "a removed provider");

  return (
    <section className="work-ready" aria-label="Ready to hand over">
      <div className="ready-list">
        <header className="ready-head">
          <div>
            <h3>Work items</h3>
            <p className="hint">
              Five things an agent needs. Every one is read back from the item —
              none of it is a prediction about how the work will go.
            </p>
          </div>
          <div className="ready-filters" role="group" aria-label="Filter by readiness">
            {(
              [
                ["all", `All ${rows.length}`],
                ["ready", `Ready ${readyCount}`],
                ["scoping", `Needs scoping ${rows.length - readyCount}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={filter === id ? "ready-filter on" : "ready-filter"}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {error && <p role="alert">{error}</p>}

        {shown.length === 0 && (
          <p className="hint">
            {rows.length === 0
              ? "No work items in this Product yet."
              : "Nothing matches that filter."}
          </p>
        )}

        <ul className="ready-rows">
          {shown.map(({ item, checks, met, working }) => {
            const all = met === checks.length;
            return (
              /* The row is a list item holding two controls, not one button
                 wrapping everything: an item with an agent on it needs a second
                 destination, and an interactive element inside a button is
                 neither valid nor reachable by keyboard. */
              <li
                key={item.id}
                className={`ready-row ${selected === item.id ? "on" : ""}`}
                aria-label={`${item.title} — ${met} of ${checks.length} ready`}
              >
                <button
                  type="button"
                  className="ready-open"
                  aria-pressed={selected === item.id}
                  aria-label={`Show the briefing for ${item.title}`}
                  onClick={() => setSelected(item.id)}
                >
                  <span className="ready-main">
                    <span className="ready-title">
                      <span className="ready-id">#{item.id}</span>
                      <strong>{item.title}</strong>
                      <span className="ready-type">
                        {TYPE_LABELS[item.itemType] ?? item.itemType}
                      </span>
                    </span>
                    <span className="ready-dots">
                      {checks.map((c) => (
                        <span key={c.label} className={c.met ? "dot met" : "dot"}>
                          <span className="dot-mark" aria-hidden="true" />
                          {c.label}
                        </span>
                      ))}
                    </span>
                  </span>

                  <span className="ready-score">
                    <span className="score-figure">
                      <strong className={all ? "ok" : met === 0 ? "bad" : "warn"}>{met}</strong>
                      <span>of {checks.length}</span>
                    </span>
                    <span className="score-bar" aria-hidden="true">
                      <span
                        className={all ? "score-fill ok" : "score-fill"}
                        style={{ width: `${(met / checks.length) * 100}%` }}
                      />
                    </span>
                  </span>
                </button>

                {/* An item with an agent on it is not a scoping question any
                    more, so its row stops answering one and points at the work.
                    A span that named a state and went nowhere was the one dead
                    end on this screen. */}
                {working && onOpenAgent ? (
                  <button
                    type="button"
                    className="ready-action busy link"
                    aria-label={`Open ${item.title} in Build`}
                    onClick={() => onOpenAgent(item.id)}
                  >
                    {working.state} · open →
                  </button>
                ) : (
                  <span className={`ready-action ${working ? "busy" : all ? "go" : ""}`}>
                    {working
                      ? `agent · ${working.state}`
                      : all
                        ? "Ready to hand over"
                        : `${checks.length - met} to fix`}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <aside className="ready-briefing" aria-label="Agent briefing">
        {chosen === null ? (
          <p className="hint">
            Pick a work item to see the briefing an agent would be handed.
          </p>
        ) : (
          <>
            <div className="briefing-head">
              <span className="briefing-kicker">Agent briefing</span>
              <strong>{chosen.item.title}</strong>
              <span className="card-mono">
                #{chosen.item.id} · {TYPE_LABELS[chosen.item.itemType] ?? chosen.item.itemType}
                {" · "}
                {chosen.item.status}
              </span>
            </div>

            <div className="briefing-block">
              <div className="briefing-block-head">
                <span>What is asked for</span>
                <span className={chosen.item.description ? "ok" : "warn"}>
                  {chosen.item.description ? "written" : "missing"}
                </span>
              </div>
              {chosen.item.description ? (
                <p className="briefing-text">{chosen.item.description}</p>
              ) : (
                <p className="hint">
                  Nothing here reaches the agent. Write it on the work item in
                  Product.
                </p>
              )}
            </div>

            <div className="briefing-block">
              <div className="briefing-block-head">
                <span>Solutions affected</span>
                <span className={plans.length > 0 ? "ok" : "warn"}>
                  {plans.length > 0 ? `${plans.length}` : "none"}
                </span>
              </div>
              {plans.length === 0 ? (
                <p className="hint">
                  No Solution attached, so nothing says which repository this
                  lands in.
                </p>
              ) : (
                <ul className="briefing-lines">
                  {plans.map((p) => (
                    <li key={p.id}>
                      <strong>{p.solutionName}</strong>
                      <span className="card-mono">
                        {p.branchName || "no branch"}
                        {p.cloneFrom ? ` from ${p.cloneFrom}` : ""}
                      </span>
                      <span className={p.approvedAt > 0 ? "chip ok-chip" : "chip warn-chip"}>
                        {p.approvedAt > 0 ? "approved" : "not approved"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="briefing-block">
              <div className="briefing-block-head">
                <span>Test plan</span>
                <span className={plans.some((p) => p.unitTests.trim()) ? "ok" : "warn"}>
                  {plans.some((p) => p.unitTests.trim()) ? "written" : "missing"}
                </span>
              </div>
              {plans.some((p) => p.unitTests.trim()) ? (
                <ul className="briefing-lines">
                  {plans.flatMap((p) =>
                    lines(p.unitTests).map((t, i) => (
                      <li key={`${p.id}-${i}`}>
                        <span>{t}</span>
                      </li>
                    )),
                  )}
                </ul>
              ) : (
                <p className="hint">
                  No tests described. The agent writes its own either way — this
                  is what you would hold it to.
                </p>
              )}
            </div>

            <div className="briefing-block">
              <div className="briefing-block-head">
                <span>Context</span>
                <span className={unresolved.length === 0 ? "ok" : "warn"}>
                  {unresolved.length === 0
                    ? "nothing blocking"
                    : `${unresolved.length} open`}
                </span>
              </div>
              {/* What has to change, per Solution — the item-wide notes box it
                  used to read went on 2026-08-21. */}
              {plans
                .filter((p) => p.changesRequired.trim() !== "")
                .map((p) => (
                  <p className="briefing-text" key={p.id}>
                    <strong>{p.solutionName}: </strong>
                    {p.changesRequired}
                  </p>
                ))}
              {unresolved.length > 0 && (
                <ul className="briefing-lines">
                  {unresolved.map((f) => (
                    <li key={f.id}>
                      <span>{f.message}</span>
                    </li>
                  ))}
                </ul>
              )}
              {plans.every((p) => p.changesRequired.trim() === "") &&
                unresolved.length === 0 && (
                  <p className="hint">
                    Nothing written about what has to change — an agent would be
                    working from the description alone.
                  </p>
                )}
            </div>

            <div className="briefing-block">
              <div className="briefing-block-head">
                <span>Still needed</span>
                <span className={chosen.met === chosen.checks.length ? "ok" : "warn"}>
                  {chosen.met} of {chosen.checks.length}
                </span>
              </div>
              {chosen.met === chosen.checks.length ? (
                <p className="hint">
                  Nothing. Open the build plan to approve and start it.
                </p>
              ) : (
                <ul className="briefing-lines missing">
                  {chosen.checks
                    .filter((c) => !c.met)
                    .map((c) => (
                      <li key={c.label}>
                        <span>{c.missing}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            {/* Not a model picker. Which model and how hard it tries is the work
                item's policy, set once in its policy editor — offering a second
                place to choose would mean two answers and no way to tell which
                the run used. */}
            <p className="hint briefing-policy">
              Runs on {providerName} at {policy?.effortTier ?? "the default"} effort.
              Change it on the work item's AI policy.
            </p>

            <button
              type="button"
              className="briefing-cta"
              onClick={() => onOpenPlan(chosen.item)}
            >
              Open the build plan
            </button>
          </>
        )}
      </aside>
    </section>
  );
}
