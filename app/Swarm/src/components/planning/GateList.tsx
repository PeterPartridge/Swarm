import type { Gate } from "../../lib/backend";

/** What has to be true before a press will work, met and unmet.
 *
 *  **One shape for both lists.** Planning an item and running an agent on it
 *  each refuse for a list of reasons, and each said them its own way: the Plan
 *  button held its own copy of the rules and rendered them as a bulleted list
 *  of complaints, while a run reported one reason at a time in an error box
 *  after being pressed. Two lists about readiness, in two shapes. They are the
 *  same idea, so they are one component reading one type, and each list comes
 *  from the backend function its own press walks.
 *
 *  **Met checks are shown too.** A list of only the problems cannot say what
 *  else was looked at, so "nothing wrong" reads the same as "nothing checked" —
 *  and a panel that goes quiet is exactly what a greyed-out button with no
 *  reason already was. */
export default function GateList({
  label,
  heading,
  gates,
}: {
  /** Names the list for anybody not looking at it — the pairing between a
   *  heading and its rows is visual otherwise. */
  label: string;
  /** Shown above the rows. Omitted where the surrounding panel already says
   *  what this is about. */
  heading?: string;
  gates: Gate[];
}) {
  if (gates.length === 0) return null;
  const unmet = gates.filter((g) => !g.ok).length;

  return (
    <div className="gate-group">
      {heading !== undefined && (
        <span className="palette-label">
          {heading}
          {unmet > 0 && <span className="gate-count"> · {unmet} outstanding</span>}
        </span>
      )}
      <ul className="gate-list" aria-label={label}>
        {gates.map((gate) => (
          <li key={gate.id} className={gate.ok ? "met" : "unmet"}>
            <span className="gate-mark" aria-hidden="true">
              {gate.ok ? "✓" : "✗"}
            </span>
            <span className="gate-label">{gate.label}</span>
            {/* Only when it is unmet: a detail beside a green row reads as a
                warning about something that is fine. */}
            {!gate.ok && <span className="gate-detail">{gate.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
