import { useEffect, useState } from "react";

/** "Something a person pressed did not work" — said once, read anywhere.
 *
 *  **Why this is a module and not a prop.** A failure happens deep inside a
 *  panel — the build plan inside the workbench inside the Build view — and the
 *  place with room to show it is the rail down the right, four components away.
 *  Threading a callback through all four would put a reporting concern into
 *  every component between them, and each would forget it in a different way.
 *
 *  **Why it exists at all.** Execute failed and nothing appeared. The message
 *  was there, in the panel that ran it, at the top of a section long enough to
 *  have scrolled it away — and before that it was being erased by a background
 *  refresh (see `WorkItemBuildPlan`). A panel saying it quietly to itself is
 *  not the same as somebody being told.
 *
 *  Only the last one is kept. A list would be a log, and this is a message: the
 *  question it answers is "what just went wrong?", which has one answer. */
export interface Failure {
  /** What was being attempted, in the words of the press: "Execute". */
  what: string;
  /** The backend's own words. Never reworded here — the sentence that names the
   *  fix is the backend's, and a friendlier paraphrase loses it. */
  message: string;
  /** When, so a repeat of the same message still reads as a new failure. */
  at: number;
}

type Listener = (failure: Failure | null) => void;

const listeners = new Set<Listener>();
let last: Failure | null = null;

function fanOut() {
  for (const listener of [...listeners]) listener(last);
}

/** Records a failed action. Call it in the `catch`, beside whatever the panel
 *  does locally — this is the shout, not a replacement for saying it in place. */
export function reportFailure(what: string, message: string): void {
  last = { what, message, at: Date.now() };
  fanOut();
}

/** Dismisses the current one. Read and understood is a decision a person makes,
 *  so nothing clears it on their behalf — not a reload, not a later success. */
export function clearFailure(): void {
  last = null;
  fanOut();
}

/** The last failure, live. */
export function useLastFailure(): Failure | null {
  const [failure, setFailure] = useState<Failure | null>(last);
  useEffect(() => {
    const listener: Listener = (next) => setFailure(next);
    listeners.add(listener);
    // Read once on mount as well: a rail that mounts after the failure — which
    // is what happens when somebody switches to the agent it came from — must
    // still show it.
    setFailure(last);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return failure;
}
