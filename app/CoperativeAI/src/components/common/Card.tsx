import type { ReactNode } from "react";

/** A titled block of a panel, with the answer to its own question on the right.
 *
 *  **One card, because there were two of the same one.** The ship rail wrote
 *  `.ship-card` and the Work area's briefing wrote `.briefing-block`: the same
 *  raised surface, the same border token, the same head with a value pushed to
 *  the end — differing only in a padding of 0.05rem and a radius of one pixel.
 *  That is not two styles, it is one style and a typo's worth of drift, and it
 *  is why the two areas looked *almost* alike in a way nobody could name.
 *
 *  **Not collapsible, deliberately.** `Group` is the collapsible shape and it
 *  earns that where a panel holds long lists somebody scrolls past — the AI
 *  feedback panel's four, the git panel's four. A card holds one short answer
 *  and hiding it behind a click would cost a press to read two words.
 *
 *  `aside` is the answer to the card's own question — "3 files", "written",
 *  "not planned" — which is what makes a column of these readable without
 *  reading any of the bodies. */
export default function Card({
  title,
  aside,
  tone,
  children,
}: {
  /** What this card is about. Omitted where the body names itself — an
   *  inspector showing a file's own name does not need "File" above it. */
  title?: string;
  /** The short answer, on the right of the title. */
  aside?: ReactNode;
  /** Colours `aside`: how a column of cards says which one to look at. */
  tone?: "ok" | "warn" | "bad";
  children: ReactNode;
}) {
  return (
    <div className="panel-card">
      {title !== undefined && (
        <div className="panel-card-head">
          <span>{title}</span>
          {aside !== undefined && <span className={tone}>{aside}</span>}
        </div>
      )}
      {children}
    </div>
  );
}
