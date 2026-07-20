import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createSprint,
  listSprints,
  removeSprint,
  type Sprint,
} from "../lib/backend";

function formatDate(millis: number | null): string | null {
  return millis === null ? null : new Date(millis).toISOString().slice(0, 10);
}

function dateRange(start: number | null, end: number | null): string {
  const from = formatDate(start);
  const to = formatDate(end);
  if (from && to) return `${from} → ${to}`;
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return "no dates";
}

/** Creating and listing a Product's sprints — the execution side of Planning.
 *
 *  Dates are optional: plenty of teams run sprints by number, not calendar, and
 *  a form that demands two dates before it will make a sprint is one people
 *  work around. The RoadMap reads these; here is where they are made and
 *  removed. */
export default function SprintManager({ productId }: { productId: number }) {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSprints(await listSprints(productId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createSprint({
        productId,
        name,
        startDate: start ? Date.parse(start) : null,
        endDate: end ? Date.parse(end) : null,
      });
      setName("");
      setStart("");
      setEnd("");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function onRemove(id: number) {
    try {
      // Removing a sprint unschedules its work rather than deleting it — the
      // backend nulls the items' sprintId, so nothing planned is lost.
      await removeSprint(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section className="sprint-manager" aria-label="Sprints">
      <h3>Sprints</h3>
      {error && <p role="alert">{error}</p>}

      <form onSubmit={onCreate} aria-label="Create sprint">
        <input
          aria-label="Sprint name"
          placeholder="Sprint name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          aria-label="Sprint start"
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <input
          aria-label="Sprint end"
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
        <button type="submit">Add sprint</button>
      </form>

      {sprints.length === 0 ? (
        <p className="hint">No sprints yet — add one above, then schedule work into it on the board.</p>
      ) : (
        <ul className="sprint-list">
          {sprints.map((s) => (
            <li key={s.id}>
              <strong>{s.name}</strong>
              <span className="sprint-dates">{dateRange(s.startDate, s.endDate)}</span>
              <button aria-label={`Remove sprint ${s.name}`} onClick={() => onRemove(s.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
