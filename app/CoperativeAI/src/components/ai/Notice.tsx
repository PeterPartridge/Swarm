import BlockedNote from "./BlockedNote";
import type { Blocked } from "../../lib/backend";

/** What a panel is currently saying: a plain sentence, or the AI declining. */
export type NoticeValue =
  | string
  | { blocked: Blocked; what: string; answerOn?: string };

/** One notice slot per panel, holding either shape.
 *
 *  **Why a union rather than a second piece of state.** The obvious way to add
 *  a decline to a panel that already has a `notice` string is a `blocked` state
 *  beside it — and then every panel has to remember to clear the one it is not
 *  setting. Forget once and a stale question sits under a successful run,
 *  claiming the AI refused work it has just done. Holding both in the one slot
 *  makes that unrepresentable: setting a notice always replaces whatever was
 *  there, which is what the panels already do at the start of every attempt.
 *
 *  Renders nothing for `null`, so callers do not each write the guard. */
export default function Notice({ value }: { value: NoticeValue | null }) {
  if (value === null) return null;
  if (typeof value === "string") return <p role="status">{value}</p>;
  return (
    <BlockedNote
      blocked={value.blocked}
      what={value.what}
      answerOn={value.answerOn}
    />
  );
}
