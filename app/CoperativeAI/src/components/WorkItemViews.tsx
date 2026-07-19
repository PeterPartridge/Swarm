import { Fragment, useCallback, useEffect, useState } from "react";
import SolutionStrategyPanel from "./SolutionStrategyPanel";
import {
  listSprints,
  listTeamMembers,
  listWorkItems,
  DEV_VIEWS,
  STATUSES,
  TYPE_LABELS,
  type Sprint,
  type TeamMember,
  type WorkItem,
} from "../lib/backend";

/** The Developer area's work views: Board (status columns), Sprint (lanes by
 *  sprint), and List (flat table) — all filterable by assigned user. */
export default function WorkItemViews({ productId }: { productId: number }) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<(typeof DEV_VIEWS)[number]>("board");
  const [assignee, setAssignee] = useState<string>("all"); // "all" | "unassigned" | id
  const [strategyItem, setStrategyItem] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedItems, loadedSprints, loadedMembers] = await Promise.all([
        listWorkItems(productId),
        listSprints(productId),
        listTeamMembers(),
      ]);
      setItems(loadedItems);
      setSprints(loadedSprints);
      setMembers(loadedMembers);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
        <div role="tablist" aria-label="View">
          {DEV_VIEWS.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={view === v ? "view-active" : ""}
              onClick={() => setView(v)}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <label>
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

      {view === "board" && (
        <section className="board" aria-label="Board view">
          {STATUSES.map((status) => (
            <section key={status} className="board-column" aria-label={status}>
              <h3>{status}</h3>
              {filtered
                .filter((i) => i.status === status)
                .map((i) => (
                  <article key={i.id} className={`card type-${i.itemType}`} aria-label={i.title}>
                    <span className="card-type">{TYPE_LABELS[i.itemType] ?? i.itemType}</span>
                    <strong>{i.title}</strong>
                    <span className="card-meta">{memberName(i.assigneeId)}</span>
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
                        {TYPE_LABELS[i.itemType] ?? i.itemType}: {i.title} — {memberName(i.assigneeId)}
                      </li>
                    ))}
                </ul>
              </section>
            ),
          )}
        </div>
      )}

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
                  </td>
                </tr>
                {strategyItem === i.id && (
                  <tr>
                    <td colSpan={6}>
                      <SolutionStrategyPanel workItemId={i.id} itemTitle={i.title} />
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
