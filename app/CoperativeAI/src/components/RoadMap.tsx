import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createSprint,
  getPlanningHierarchy,
  getRoadmapMode,
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

export default function RoadMap({ productId }: RoadMapProps) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [mode, setMode] = useState<string>("sprints");
  const [hierarchy, setHierarchy] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sprintName, setSprintName] = useState("");
  const [sprintStart, setSprintStart] = useState("");
  const [sprintEnd, setSprintEnd] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [loadedItems, loadedSprints, loadedMode, loadedHierarchy] =
        await Promise.all([
          listWorkItems(productId),
          listSprints(productId),
          getRoadmapMode(),
          getPlanningHierarchy(),
        ]);
      setItems(loadedItems);
      setSprints(loadedSprints);
      setMode(loadedMode);
      setHierarchy(loadedHierarchy);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreateSprint(e: FormEvent) {
    e.preventDefault();
    if (!sprintName.trim()) return;
    try {
      await createSprint({
        productId,
        name: sprintName,
        startDate: sprintStart ? Date.parse(sprintStart) : null,
        endDate: sprintEnd ? Date.parse(sprintEnd) : null,
      });
      setSprintName("");
      setSprintStart("");
      setSprintEnd("");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  // The roadmap shows the planning hierarchy's items (bugs/tests stay on the board).
  const roadmapItems = items.filter((i) => hierarchy.includes(i.itemType));

  const lanes: { key: string; heading: string; subtitle: string; items: WorkItem[] }[] =
    mode === "sprints"
      ? [
          ...sprints.map((sprint) => ({
            key: `sprint-${sprint.id}`,
            heading: sprint.name,
            subtitle: dateRange(sprint.startDate, sprint.endDate),
            items: roadmapItems.filter((i) => i.sprintId === sprint.id),
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

  return (
    <div className="roadmap">
      {error && <p role="alert">{error}</p>}

      {mode === "sprints" && (
        <form onSubmit={onCreateSprint} aria-label="Create sprint">
          <input
            aria-label="Sprint name"
            placeholder="Sprint name"
            value={sprintName}
            onChange={(e) => setSprintName(e.target.value)}
          />
          <input
            aria-label="Sprint start"
            type="date"
            value={sprintStart}
            onChange={(e) => setSprintStart(e.target.value)}
          />
          <input
            aria-label="Sprint end"
            type="date"
            value={sprintEnd}
            onChange={(e) => setSprintEnd(e.target.value)}
          />
          <button type="submit">Add sprint</button>
        </form>
      )}

      {lanes.map((lane) => (
        <section key={lane.key} className="roadmap-lane" aria-label={lane.heading}>
          <header>
            <h2>{lane.heading}</h2>
            {lane.subtitle && <span className="lane-dates">{lane.subtitle}</span>}
          </header>
          <div className="lane-items">
            {lane.items.map((item) => (
              <article key={item.id} className={`card type-${item.itemType}`} aria-label={item.title}>
                <span className="card-type">{TYPE_LABELS[item.itemType] ?? item.itemType}</span>
                <strong>{item.title}</strong>
                {(item.startDate !== null || item.endDate !== null) && (
                  <span className="card-dates">{dateRange(item.startDate, item.endDate)}</span>
                )}
              </article>
            ))}
            {lane.items.length === 0 && <p className="lane-empty">Nothing here yet.</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
