import { useEffect, useState } from "react";

export interface SectionOption {
  id: string;
  label: string;
}

/** Below this, a row of tabs wraps onto two or three lines and stops being a
 *  row. That is the only point at which a dropdown is the better control. */
const NARROW = "(max-width: 52rem)";

/** Whether the window is too narrow for a row of tabs.
 *
 *  Defaults to "wide" when `matchMedia` is missing — jsdom has none, and a test
 *  environment silently collapsing every tab bar into a select would change what
 *  is being tested without saying so. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(NARROW);
    setNarrow(query.matches);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/** One-of-many section switching, in the shape that costs fewest clicks.
 *
 *  **Why this is one component.** Five screens had grown their own copy of the
 *  same `role="tablist"` and the same active-class logic — the Develop tabs, the
 *  work views, Admin's sections, the agent sub-panels and the preview modes. The
 *  project's own rule is that a third repetition becomes a shared module, and
 *  this was the fifth. It also means a change to how sections behave is made
 *  once rather than five times, which is how the dropdown below arrived at all.
 *
 *  **Why not always a dropdown.** A dropdown reads as tidier and is *more* work
 *  to use: open it, then choose, where a tab row is one press and shows every
 *  option without being asked. For somebody taking the shortest route the row
 *  wins — right up until it wraps onto three lines and stops being a row. So the
 *  row is the default and the dropdown appears only when the window is too
 *  narrow to hold it, which is the case it is genuinely better for.
 *
 *  Both forms carry the same accessible name, so anything finding a section by
 *  its label keeps working whichever is showing. */
export default function SectionTabs({
  label,
  options,
  active,
  onSelect,
  className,
  as = "tabs",
}: {
  /** Names the group — "View", "Settings sections". Read aloud before the
   *  options, so it should say what is being chosen. */
  label: string;
  options: SectionOption[];
  active: string;
  onSelect: (id: string) => void;
  className?: string;
  /** `"tabs"` is a real tablist. `"buttons"` is pressed-state buttons with no
   *  tablist role — for a page that already has a tablist inside it, where a
   *  second one would make "the tabs" ambiguous to a screen reader. Sharing the
   *  code without forcing the semantics is the point of the option. */
  as?: "tabs" | "buttons";
}) {
  const narrow = useNarrow();

  if (narrow) {
    return (
      <label className={`section-tabs-narrow ${className ?? ""}`}>
        {label}
        <select
          aria-label={label}
          value={active}
          onChange={(e) => onSelect(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (as === "buttons") {
    return (
      <nav aria-label={label} className={`section-tabs ${className ?? ""}`}>
        {options.map((o) => (
          <button
            key={o.id}
            aria-pressed={active === o.id}
            className={active === o.id ? "view-active" : ""}
            onClick={() => onSelect(o.id)}
          >
            {o.label}
          </button>
        ))}
      </nav>
    );
  }

  return (
    <nav role="tablist" aria-label={label} className={`section-tabs ${className ?? ""}`}>
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={active === o.id}
          className={active === o.id ? "view-active" : ""}
          onClick={() => onSelect(o.id)}
        >
          {o.label}
        </button>
      ))}
    </nav>
  );
}
