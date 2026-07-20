import { useCallback, useEffect, useMemo, useState } from "react";
import SprintCapacity from "./SprintCapacity";
import {
  getPlanningHierarchy,
  listSprints,
  listWorkItems,
  STATUSES,
  TYPE_LABELS,
  type Sprint,
  type WorkItem,
} from "../lib/backend";

interface RoadMapProps {
  productId: number;
}

type RoadmapView = "months" | "sprints" | "status";

const VIEWS: { id: RoadmapView; label: string }[] = [
  { id: "months", label: "By month" },
  { id: "sprints", label: "By sprint" },
  { id: "status", label: "By status" },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatDate(millis: number | null): string | null {
  if (millis === null) return null;
  return new Date(millis).toISOString().slice(0, 10);
}

function dateRange(start: number | null, end: number | null): string {
  const from = formatDate(start);
  const to = formatDate(end);
  if (from && to) return `${from} → ${to}`;
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return "no dates";
}

/** A month key like "2026-7" (0-based month) and its human label. UTC so it
 *  agrees with formatDate, which slices an ISO string. */
function monthKey(millis: number): string {
  const d = new Date(millis);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}
function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return `${MONTH_NAMES[month]} ${year}`;
}

/** Every month from the first to the last, inclusive, so a gap between two
 *  pieces of dated work shows as an empty month rather than vanishing. Capped
 *  so a stray far-future date cannot render hundreds of lanes. */
function monthsBetween(minMillis: number, maxMillis: number): string[] {
  const start = new Date(minMillis);
  const keys: string[] = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  const end = new Date(maxMillis);
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth();
  while ((year < endYear || (year === endYear && month <= endMonth)) && keys.length < 36) {
    keys.push(`${year}-${month}`);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return keys;
}

export default function RoadMap({ productId }: RoadMapProps) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [hierarchy, setHierarchy] = useState<string[]>([]);
  const [view, setView] = useState<RoadmapView>("months");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedItems, loadedSprints, loadedHierarchy] = await Promise.all([
        listWorkItems(productId),
        listSprints(productId),
        getPlanningHierarchy(),
      ]);
      setItems(loadedItems);
      setSprints(loadedSprints);
      setHierarchy(loadedHierarchy);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The roadmap shows the planning hierarchy's items (bugs/tests stay on the board).
  const roadmapItems = useMemo(
    () => items.filter((i) => hierarchy.includes(i.itemType)),
    [items, hierarchy],
  );

  const sprintById = useMemo(
    () => new Map(sprints.map((s) => [s.id, s])),
    [sprints],
  );

  /** Where an item sits in time: its own start, else its own end, else the
   *  dates of the sprint it is scheduled into. A dateless item in a dateless
   *  sprint has no place on a timeline and lands in "Undated". */
  const positionDate = useCallback(
    (item: WorkItem): number | null => {
      if (item.startDate !== null) return item.startDate;
      if (item.endDate !== null) return item.endDate;
      const sprint = item.sprintId !== null ? sprintById.get(item.sprintId) : undefined;
      return sprint?.startDate ?? sprint?.endDate ?? null;
    },
    [sprintById],
  );

  const monthLanes = useMemo(() => {
    // The range spans every dated item and every dated sprint, so months
    // between two sprints still appear.
    const dates: number[] = [];
    for (const item of roadmapItems) {
      const d = positionDate(item);
      if (d !== null) dates.push(d);
    }
    for (const sprint of sprints) {
      if (sprint.startDate !== null) dates.push(sprint.startDate);
      if (sprint.endDate !== null) dates.push(sprint.endDate);
    }
    const undated = roadmapItems.filter((i) => positionDate(i) === null);

    if (dates.length === 0) {
      return { months: [] as { key: string; items: WorkItem[] }[], undated };
    }
    const keys = monthsBetween(Math.min(...dates), Math.max(...dates));
    const months = keys.map((key) => ({
      key,
      items: roadmapItems.filter((i) => {
        const d = positionDate(i);
        return d !== null && monthKey(d) === key;
      }),
    }));
    return { months, undated };
  }, [roadmapItems, sprints, positionDate]);

  const laneLanes: {
    key: string;
    heading: string;
    subtitle: string;
    items: WorkItem[];
    sprintId?: number;
  }[] =
    view === "sprints"
      ? [
          ...sprints.map((sprint) => ({
            key: `sprint-${sprint.id}`,
            heading: sprint.name,
            subtitle: dateRange(sprint.startDate, sprint.endDate),
            items: roadmapItems.filter((i) => i.sprintId === sprint.id),
            sprintId: sprint.id,
          })),
          {
            key: "unscheduled",
            heading: "Unscheduled",
            subtitle: "not in a sprint",
            items: roadmapItems.filter((i) => i.sprintId === null),
          },
        ]
      : STATUSES.map((status) => ({
          key: `status-${status}`,
          heading: status,
          subtitle: "",
          items: roadmapItems.filter((i) => i.status === status),
        }));

  function card(item: WorkItem) {
    return (
      <article key={item.id} className={`card type-${item.itemType}`} aria-label={item.title}>
        <span className="card-type">{TYPE_LABELS[item.itemType] ?? item.itemType}</span>
        <strong>{item.title}</strong>
        {(item.startDate !== null || item.endDate !== null) && (
          <span className="card-dates">{dateRange(item.startDate, item.endDate)}</span>
        )}
      </article>
    );
  }

  return (
    <div className="roadmap">
      {error && <p role="alert">{error}</p>}

      <nav className="roadmap-views" aria-label="Roadmap view">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            aria-pressed={view === v.id}
            className={view === v.id ? "roadmap-view-active" : ""}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </nav>

      {view === "months" ? (
        monthLanes.months.length === 0 && monthLanes.undated.length === 0 ? (
          <p className="lane-empty">
            Nothing to place on a timeline yet. Give work items dates, or schedule
            them into sprints that have dates, and they appear here month by month.
          </p>
        ) : (
          <div className="roadmap-timeline">
            {monthLanes.months.map((month) => (
              <section
                key={month.key}
                className="roadmap-month"
                aria-label={monthLabel(month.key)}
              >
                <header>
                  <h2>{monthLabel(month.key)}</h2>
                </header>
                <div className="lane-items">
                  {month.items.map(card)}
                  {month.items.length === 0 && <p className="lane-empty">—</p>}
                </div>
              </section>
            ))}
            {monthLanes.undated.length > 0 && (
              <section className="roadmap-month undated" aria-label="Undated">
                <header>
                  <h2>Undated</h2>
                  <span className="lane-dates">no dates and no dated sprint</span>
                </header>
                <div className="lane-items">{monthLanes.undated.map(card)}</div>
              </section>
            )}
          </div>
        )
      ) : (
        laneLanes.map((lane) => (
          <section key={lane.key} className="roadmap-lane" aria-label={lane.heading}>
            <header>
              <h2>{lane.heading}</h2>
              {lane.subtitle && <span className="lane-dates">{lane.subtitle}</span>}
            </header>
            <div className="lane-items">
              {lane.items.map(card)}
              {lane.items.length === 0 && <p className="lane-empty">Nothing here yet.</p>}
            </div>
            {lane.sprintId !== undefined && (
              <SprintCapacity sprintId={lane.sprintId} sprintName={lane.heading} />
            )}
          </section>
        ))
      )}
    </div>
  );
}
