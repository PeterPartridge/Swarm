import { useCallback, useEffect, useState } from "react";
import {
  getSprintLoad,
  listTeamMembers,
  setSprintCapacity,
  type MemberLoad,
  type TeamMember,
} from "../lib/backend";

/** Who has how much available in a sprint, beside what they have been given.
 *
 *  Capacity is one number per person in whatever unit the team already uses —
 *  points, hours, days. No calendar, no holidays, no part-time handling: a
 *  capacity model that demands all of that before it says anything useful is
 *  one nobody fills in.
 *
 *  What it is compared against is a **count of work items**, not effort. Work
 *  items carry no estimate, so the panel says as much rather than implying a
 *  precision it does not have. */
export default function SprintCapacity({
  sprintId,
  sprintName,
}: {
  sprintId: number;
  sprintName: string;
}) {
  const [load, setLoad] = useState<MemberLoad[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loaded, loadedMembers] = await Promise.all([
        getSprintLoad(sprintId),
        listTeamMembers(),
      ]);
      setLoad(loaded);
      setMembers(loadedMembers);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [sprintId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSet(memberId: number, value: string) {
    const capacity = Number(value);
    if (!Number.isFinite(capacity) || capacity < 0) return;
    try {
      await setSprintCapacity(sprintId, memberId, capacity);
      setError(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  const capacityOf = (id: number) =>
    load.find((l) => l.teamMemberId === id)?.capacity ?? 0;
  const assignedOf = (id: number) =>
    load.find((l) => l.teamMemberId === id)?.assignedItems ?? 0;

  if (members.length === 0) return null;

  return (
    <section className="sprint-capacity" aria-label={`Capacity for ${sprintName}`}>
      <h4>Capacity</h4>
      {error && <p role="alert">{error}</p>}
      <p className="hint">
        Your own unit — points, hours, days. Compared against the{" "}
        <em>number of items</em> assigned, which is a rough signal, not effort.
      </p>
      <ul className="capacity-list">
        {members.map((m) => {
          const capacity = capacityOf(m.id);
          const assigned = assignedOf(m.id);
          // Only meaningful once someone has said what they have available.
          const over = capacity > 0 && assigned > capacity;
          return (
            <li key={m.id} className={over ? "over-capacity" : ""}>
              <span className="capacity-name">{m.name}</span>
              <input
                type="number"
                min={0}
                aria-label={`Capacity for ${m.name} in ${sprintName}`}
                defaultValue={capacity}
                onBlur={(e) => onSet(m.id, e.target.value)}
              />
              <span className="capacity-assigned">
                {assigned} item{assigned === 1 ? "" : "s"} assigned
                {over ? " — over capacity" : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
