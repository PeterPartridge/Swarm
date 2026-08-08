import SectionTabs from "../common/SectionTabs";
import { Fragment, useCallback, useEffect, useState } from "react";
import SolutionStrategyPanel from "../ai/SolutionStrategyPanel";
import WorkItemBuildPlan from "../planning/WorkItemBuildPlan";
import WorkReadiness from "./WorkReadiness";
import {
  listSolutions,
  listSprints,
  listTeamMembers,
  listWorkItems,
  DEV_VIEWS,
  STATUSES,
  TYPE_LABELS,
  type Solution,
  type Sprint,
  type TeamMember,
  type WorkItem,
} from "../../lib/backend";

/** Ready first, then the three views that were already here.
 *
 *  Ready leads because it is the only one that answers the question somebody
 *  standing in Work is actually asking — is this scoped well enough to hand
 *  over? Board says where an item is, Sprint says when, List says everything at
 *  once, and none of the three can say that. */
const WORK_VIEWS = ["ready", ...DEV_VIEWS] as const;
type WorkView = (typeof WORK_VIEWS)[number];

/** The Developer area's work views: Ready (what an agent still needs), Board
 *  (status columns), Sprint (lanes by sprint), and List (flat table) — the last
 *  three filterable by assigned user. */
export default function WorkItemViews({
  productId,
  requestedItem,
}: {
  productId: number;
  /** A work item asked for from elsewhere — the Build view's lane links here
   *  when an item has no agent on it. Carries a timestamp so asking twice for
   *  the same item still moves. */
  requestedItem?: { id: number; at: number } | null;
}) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<WorkView>("ready");
  const [assignee, setAssignee] = useState<string>("all"); // "all" | "unassigned" | id
  const [strategyItem, setStrategyItem] = useState<number | null>(null);
  const [planItem, setPlanItem] = useState<number | null>(null);
  const [solutions, setSolutions] = useState<Solution[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [loadedItems, loadedSprints, loadedMembers, loadedSolutions] =
        await Promise.all([
          listWorkItems(productId),
          listSprints(productId),
          listTeamMembers(),
          listSolutions(),
        ]);
      setItems(loadedItems);
      setSprints(loadedSprints);
      setMembers(loadedMembers);
      // Work reaches a repository through a Solution of its own Product.
      setSolutions(loadedSolutions.filter((s) => s.productId === productId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // An item asked for from the Build view lands on Ready, which is where its
  // briefing is — sending it to the Board would show the card but not why the
  // lane pointed here.
  useEffect(() => {
    if (requestedItem) setView("ready");
  }, [requestedItem]);

  const memberName = (id: number | null) =>
    id === null ? "Unassigned" : members.find((m) => m.id === id)?.name ?? "(unknown)";
  const sprintName = (id: number | null) =>
    id === null ? "No sprint" : sprints.find((s) => s.id === id)?.name ?? "(unknown)";

  const filtered = items.filter((i) => {
    if (assignee === "all") return true;
    if (assignee === "unassigned") return i.assigneeId === null;
    return i.assigneeId === Number(assignee);
  });

  return (
    <section className="work-views" aria-label="Work views">
      <div className="view-controls">
        <SectionTabs
          label="View"
          options={WORK_VIEWS.map((v) => ({
            id: v,
            label: v[0].toUpperCase() + v.slice(1),
          }))}
          active={view}
          onSelect={(id) => setView(id as WorkView)}
        />
        {/* The filter belongs to the three views that list by person. Ready is
            sorted by what the work still needs, which is not a fact about who
            it is assigned to. */}
        <label hidden={view === "ready"}>
          Filter by user
          <select
            aria-label="Filter by user"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="all">Everyone</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p role="alert">{error}</p>}

      {view === "ready" && (
        <WorkReadiness
          productId={productId}
          items={items}
          requestedItem={requestedItem?.id ?? null}
          // The build plan is where scoping is fixed and where the plan is
          // approved, so "open it" is the one action this view needs.
          onOpenPlan={(item) => setPlanItem(item.id)}
        />
      )}

      {view === "board" && (
        <section className="board" aria-label="Board view">
          {STATUSES.map((status) => (
            <section key={status} className="board-column" aria-label={status}>
              <h3>{status}</h3>
              {filtered
                .filter((i) => i.status === status)
                .map((i) => (
                  <article key={i.id} className={`card type-${i.itemType}`} aria-label={i.title}>
                    {/* The card opens the build plan: outlining the changes and
                        which Solutions are affected is a developer's job, and it
                        has to be reachable from the view they actually land on,
                        not only from the List. */}
                    <button
                      type="button"
                      className="card-open"
                      aria-pressed={planItem === i.id}
                      aria-label={`Open ${i.title}`}
                      onClick={() => setPlanItem(planItem === i.id ? null : i.id)}
                    >
                      <span className="card-type">{TYPE_LABELS[i.itemType] ?? i.itemType}</span>
                      <strong>{i.title}</strong>
                      <span className="card-meta">{memberName(i.assigneeId)}</span>
                    </button>
                  </article>
                ))}
            </section>
          ))}
        </section>
      )}

      {view === "sprint" && (
        <div className="sprint-view" aria-label="Sprint view">
          {[...sprints.map((s) => ({ id: s.id as number | null, name: s.name })), { id: null, name: "Unscheduled" }].map(
            (lane) => (
              <section key={lane.id ?? "none"} className="sprint-lane" aria-label={lane.name}>
                <h3>{lane.name}</h3>
                <ul>
                  {filtered
                    .filter((i) => i.sprintId === lane.id)
                    .map((i) => (
                      <li key={i.id}>
                        <button
                          type="button"
                          className="sprint-item"
                          aria-pressed={planItem === i.id}
                          aria-label={`Open ${i.title}`}
                          onClick={() => setPlanItem(planItem === i.id ? null : i.id)}
                        >
                          {TYPE_LABELS[i.itemType] ?? i.itemType}: {i.title} — {memberName(i.assigneeId)}
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            ),
          )}
        </div>
      )}

      {/* The build plan for the item opened from the Board or Sprint view. The
          List view opens it inline in its own row, so it is left out here to
          avoid showing it twice. This is the editor a developer outlines the
          changes and affected Solutions in — reachable from every view, not
          just the List. */}
      {view !== "list" &&
        (() => {
          const selected =
            planItem !== null ? filtered.find((i) => i.id === planItem) ?? null : null;
          return selected ? (
            <div className="selected-plan">
              <div className="selected-plan-head">
                <strong>Build plan — {selected.title}</strong>
                <button aria-label="Close build plan" onClick={() => setPlanItem(null)}>
                  Close
                </button>
              </div>
              {/* WorkItemBuildPlan is itself a region named "Build plan for …",
                  so the wrapper stays a plain div to avoid two of them. */}
              <WorkItemBuildPlan item={selected} solutions={solutions} />
            </div>
          ) : null;
        })()}

      {view === "list" && (
        <table className="list-view" aria-label="List view">
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Status</th>
              <th>Assignee</th>
              <th>Sprint</th>
              <th>Build</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((i) => (
              <Fragment key={i.id}>
                <tr aria-label={i.title}>
                  <td>{i.title}</td>
                  <td>{TYPE_LABELS[i.itemType] ?? i.itemType}</td>
                  <td>{i.status}</td>
                  <td>{memberName(i.assigneeId)}</td>
                  <td>{sprintName(i.sprintId)}</td>
                  <td>
                    <button
                      aria-label={`Solution strategy for ${i.title}`}
                      onClick={() => setStrategyItem(strategyItem === i.id ? null : i.id)}
                    >
                      {strategyItem === i.id ? "Hide" : "How to build"}
                    </button>
                    <button
                      aria-label={`Open ${i.title}`}
                      onClick={() => setPlanItem(planItem === i.id ? null : i.id)}
                    >
                      {planItem === i.id ? "Close" : "Open"}
                    </button>
                  </td>
                </tr>
                {strategyItem === i.id && (
                  <tr>
                    <td colSpan={6}>
                      <SolutionStrategyPanel workItemId={i.id} itemTitle={i.title} />
                    </td>
                  </tr>
                )}
                {planItem === i.id && (
                  <tr>
                    <td colSpan={6}>
                      <WorkItemBuildPlan item={i} solutions={solutions} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
