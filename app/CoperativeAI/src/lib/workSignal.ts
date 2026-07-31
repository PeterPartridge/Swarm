import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** "Something about the AI's work changed — re-read what you show."
 *
 *  **Why this is one module rather than a `listen` in each panel.** Five
 *  components had their own copy of the same subscription, which was tolerable,
 *  and one — the runs list — had none at all, which was not: a job finishing or
 *  a question being answered never reached it, so it showed a stale list until
 *  somebody pressed Refresh.
 *
 *  It also carries what the backend event could not. `ai-job-changed` is emitted
 *  by the job runner, so it says nothing about the things a person does in the
 *  UI — approving a plan, answering a question, starting a run, cancelling one.
 *  Those changed what the panel beside you was showing and it had no way to
 *  know. `notifyWorkChanged` is that missing half, and both halves arrive
 *  through the same door so a subscriber does not care which happened.
 *
 *  Nothing is carried in the signal. Every subscriber re-reads from the backend,
 *  which is what makes an out-of-order or duplicated notification harmless — the
 *  same reasoning the Tauri event already used. */
type Listener = () => void;

const listeners = new Set<Listener>();

/** The one backend subscription, opened when the first component asks and then
 *  kept for the life of the app.
 *
 *  Deliberately never closed: dropping it when the set empties would mean
 *  unsubscribing and resubscribing on every navigation between tabs, and a
 *  fan-out over an empty set costs nothing. */
let backend: Promise<UnlistenFn> | null = null;

function fanOut() {
  // Copied first: a subscriber that unsubscribes while being called would
  // otherwise mutate the set mid-iteration.
  for (const listener of [...listeners]) listener();
}

/** Says the work changed because of something done here, rather than by the
 *  runner. Call it after a mutation lands, not before — a panel that re-reads
 *  ahead of the write shows the old answer and looks broken. */
export function notifyWorkChanged() {
  fanOut();
}

/** Re-runs `onChange` whenever the AI's work moves, from either direction.
 *
 *  `onChange` must be stable — wrap it in `useCallback`, as every caller's
 *  `refresh` already is — or the subscription is torn down and rebuilt on each
 *  render. */
export function useWorkChanged(onChange: Listener) {
  useEffect(() => {
    listeners.add(onChange);
    if (!backend) {
      // `listen` resolves after the subscription exists; events before that are
      // missed, which is why every subscriber also reads once on mount.
      backend = listen("ai-job-changed", fanOut);
    }
    return () => {
      listeners.delete(onChange);
    };
  }, [onChange]);
}
