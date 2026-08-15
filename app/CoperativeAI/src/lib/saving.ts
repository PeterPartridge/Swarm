/** Whether anything is being saved, for the bar at the bottom of the window.
 *
 *  **One place to look.** Panels each grew their own "Saved." line, in
 *  different words and different corners, and a screen with three of them says
 *  less than a screen with one. This is the one place, and every save routed
 *  through it says the same thing in the same spot.
 *
 *  **A spinner is a claim that work is in flight**, so it is only shown while
 *  there really is some — but a save that returns in forty milliseconds would
 *  flash it, which reads as a glitch rather than as feedback. So the spinner
 *  has a floor: once shown it stays for [`MIN_SPIN`]. What it must never do is
 *  the opposite — linger after the write finished — because that is a lie about
 *  the program's state, so "Saved" appears at the moment the write actually
 *  returned and the floor only delays *hiding* the spinner, never the news.
 *
 *  **A failure stays.** "Saved" fades because it is reassurance and reassurance
 *  goes stale; a save that did not happen is the one thing nobody may miss, so
 *  it sits there until the next save succeeds or somebody dismisses it. */

/** What the bar is currently saying. */
export type SaveState =
  | { kind: "idle" }
  | { kind: "saving"; what: string }
  | { kind: "saved"; what: string; at: number }
  | { kind: "failed"; what: string; why: string };

/** How long the spinner stays once it has been shown, so a fast save reads as
 *  feedback rather than as a flicker. */
export const MIN_SPIN = 400;
/** How long "Saved" stays before the bar goes quiet again. */
export const SAVED_FOR = 2500;

type Listener = (state: SaveState) => void;

let state: SaveState = { kind: "idle" };
const listeners = new Set<Listener>();
/// How many saves are in flight. Counted rather than flagged, because two
/// panels saving at once must not have the first to finish declare silence.
let inFlight = 0;
let shownAt = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function announce(next: SaveState): void {
  state = next;
  for (const listener of listeners) listener(state);
}

export function current(): SaveState {
  return state;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Puts the bar back to idle, and clears a failure somebody has read. */
export function dismiss(): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  announce({ kind: "idle" });
}

/** Runs a save and reports it.
 *
 *  Returns whatever the save returned, and **rethrows what it threw**: the bar
 *  is a report on the work, not a replacement for handling it. A caller that
 *  needs to know still finds out.
 *
 *  `what` is the thing being saved in words a person would use — "Developer
 *  rules", not "setDeveloperRules" — because it is read by somebody who did not
 *  write the code.
 */
export async function track<T>(what: string, save: () => Promise<T>): Promise<T> {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (inFlight === 0) shownAt = Date.now();
  inFlight += 1;
  announce({ kind: "saving", what });

  try {
    const result = await save();
    inFlight -= 1;
    // Only the last one still running gets to say it is done: with two saves
    // in flight, the first to return must not claim everything finished.
    if (inFlight === 0) settle({ kind: "saved", what, at: Date.now() });
    return result;
  } catch (e) {
    inFlight -= 1;
    // A failure is announced whether or not others are still going. It is the
    // thing nobody may miss, and waiting for a sibling save to finish before
    // mentioning it would be exactly the wrong priority.
    settle({ kind: "failed", what, why: String(e) }, true);
    throw e;
  }
}

/** Announces the outcome, holding the spinner to its floor first. */
function settle(next: SaveState, immediate = false): void {
  const since = Date.now() - shownAt;
  const wait = immediate ? 0 : Math.max(0, MIN_SPIN - since);

  // The news itself is never delayed — only the spinner's disappearance is.
  // Waiting to *say* it finished would be the lie the floor exists to avoid.
  const say = () => {
    announce(next);
    if (next.kind === "saved") {
      hideTimer = setTimeout(() => {
        // Still the same success? A save that started since owns the bar now.
        if (state.kind === "saved") announce({ kind: "idle" });
      }, SAVED_FOR);
    }
  };

  if (wait === 0) say();
  else setTimeout(say, wait);
}

/** For tests: forget everything. */
export function reset(): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  inFlight = 0;
  shownAt = 0;
  state = { kind: "idle" };
  listeners.clear();
}
