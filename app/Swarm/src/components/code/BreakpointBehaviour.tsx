import { useEffect, useRef, useState } from "react";
import type { Mark } from "../../lib/breakpoints";

/** The three things a breakpoint can do beyond stopping every time.
 *
 *  **Ticked, not picked.** DAP allows all three together — "print the basket
 *  total, but only after the 500th time round, and only when it is negative" is
 *  one breakpoint, and a single-choice dropdown could not express it. Each one
 *  reveals its own box, because the expression, the count and the message are
 *  the debugger's own grammar and cannot be offered as a list of values: a
 *  condition is an arbitrary expression in the program's language, and
 *  `model.value == -3` is not something anybody could have put in a dropdown. */
const BEHAVIOURS = [
  {
    id: "condition" as const,
    label: "Only when a condition holds",
    /// What goes in the box, in the program's own language.
    placeholder: "model.value == -3",
  },
  {
    id: "hits" as const,
    label: "After a number of hits",
    placeholder: "7  (js-debug)  ·  == 7  (Delve)",
  },
  {
    id: "log" as const,
    label: "Print instead of stopping",
    placeholder: "basket total is {total}",
  },
];

type Behaviour = (typeof BEHAVIOURS)[number]["id"];

/** How this breakpoint reads in one line, for the closed control.
 *
 *  **"Stop every time" is the absence of the other three, not a fourth tick.**
 *  Offering it as one would have made two states mean the same thing, and a
 *  control with two ways to say one thing is a control somebody will find in
 *  the wrong one. */
export function summarise(mark: Mark): string {
  const said: string[] = [];
  if (mark.log.trim() !== "") said.push("prints");
  if (mark.condition.trim() !== "") said.push("conditional");
  if (mark.hits.trim() !== "") said.push(`after ${mark.hits.trim()}`);
  return said.length === 0 ? "Stops every time" : said.join(" · ");
}

/** What one breakpoint does, as a multi-select that opens onto the boxes.
 *
 *  It replaced three text inputs that were always on screen, one per
 *  breakpoint, whose placeholders were the only thing saying what they were for
 *  — "stop every time", "every hit", "print instead of stopping" read as three
 *  unrelated fields rather than as one question about one breakpoint. */
export default function BreakpointBehaviour({
  mark,
  line,
  language,
  onChange,
}: {
  mark: Mark;
  line: number;
  /** The program's own language, named on the hint — the adapter evaluates the
   *  condition inside the running process, not this app. */
  language: string | null;
  onChange: (field: Behaviour, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement | null>(null);

  // Clicking anywhere else puts it away. A popover that stays open until its
  // own button is found again is one that ends up left open behind whatever
  // somebody looked at next.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (holder.current && !holder.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const on = (id: Behaviour) => mark[id].trim() !== "";
  /// Ticked but empty is a real, useful state — you tick "only when a condition
  /// holds" and then type the condition — so what is showing is tracked apart
  /// from what is written.
  const [revealed, setRevealed] = useState<Behaviour[]>(() =>
    BEHAVIOURS.filter((b) => mark[b.id].trim() !== "").map((b) => b.id),
  );
  const showing = (id: Behaviour) => on(id) || revealed.includes(id);

  return (
    <div className="break-behaviour" ref={holder}>
      <button
        type="button"
        className="break-summary"
        aria-expanded={open}
        aria-label={`What the breakpoint at line ${line} does`}
        onClick={() => setOpen((v) => !v)}
      >
        {summarise(mark)} <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="break-menu" role="group" aria-label={`Behaviour for line ${line}`}>
          {BEHAVIOURS.map((b) => (
            <div className="break-option" key={b.id}>
              <label>
                <input
                  type="checkbox"
                  aria-label={b.label}
                  checked={showing(b.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setRevealed((prev) => [...prev, b.id]);
                    } else {
                      setRevealed((prev) => prev.filter((id) => id !== b.id));
                      // Unticking clears what was written: a condition left
                      // behind in a hidden box would still be sent to the
                      // debugger, and the breakpoint would go on not stopping
                      // for a reason nothing on screen could explain.
                      if (on(b.id)) onChange(b.id, "");
                    }
                  }}
                />{" "}
                {b.label}
              </label>
              {showing(b.id) && (
                <input
                  type="text"
                  className="card-mono"
                  aria-label={`${b.label} at line ${line}`}
                  placeholder={b.placeholder}
                  value={mark[b.id]}
                  onChange={(e) => onChange(b.id, e.target.value)}
                />
              )}
            </div>
          ))}

          {/* The grammar belongs to the debugger, and this app deliberately
              does not check it as it is typed — inventing one would be wrong
              for at least one adapter. Saying whose grammar it is beats
              somebody trying JavaScript in a Go program. */}
          <p className="hint">
            Conditions are written in {language ?? "the program's own language"} and worked
            out by the debugger inside the running program. A message prints and carries on
            instead of stopping; <code>{"{i}"}</code> inside it is worked out the same way.
            All three can be on at once.
          </p>
        </div>
      )}
    </div>
  );
}
