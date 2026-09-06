import type { ReactNode } from "react";

/** A section of a panel: one line saying what it is and how it stands, and what
 *  is under it when it is opened.
 *
 *  **The Develop area's shape for "one of several things about this".** The git
 *  panel showed everything it could do at once — a folder field, an init
 *  button, a commit list, two forms — which is a lot of room for something
 *  usually glanced at. Each question became a line carrying its own answer, and
 *  the pattern turned out to be what every panel of that kind wants: the AI
 *  feedback panel had the same problem with four lists.
 *
 *  **The summary is the point.** A collapsed box that says only its own title
 *  makes somebody open all of them to find the one they wanted. The line
 *  answers the ordinary reason for looking — which branch, how many failures,
 *  what the agent said — and opening it is for acting on that.
 *
 *  `tone="warn"` colours the summary where the answer is a problem, so a shut
 *  box can still say something is wrong. */
export default function Group({
  title,
  summary,
  tone,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  tone?: "warn";
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group-box">
      <button
        type="button"
        className="group-line"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="group-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="palette-label">{title}</span>
        <span className={tone === "warn" ? "group-summary warn" : "group-summary"}>
          {summary}
        </span>
      </button>
      {open && <div className="group-body">{children}</div>}
    </div>
  );
}
