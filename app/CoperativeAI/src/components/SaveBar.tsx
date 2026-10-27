import { useEffect, useState } from "react";
import { current, dismiss, subscribe, type SaveState } from "../lib/saving";

/** What is being saved, along the bottom of the window.
 *
 *  **One line, in one place.** Panels each grew their own "Saved." notice, in
 *  different words and different corners; a screen with three of them says less
 *  than a screen with one.
 *
 *  It is `role="status"` rather than `role="alert"` while things are going
 *  well — a save succeeding is not something to interrupt anybody about — and
 *  a failure gets `role="alert"`, because that one is.
 *
 *  **Nothing is drawn when there is nothing to say.** A permanent bar reading
 *  "Ready" is furniture, and furniture at the bottom of every screen is a row
 *  of pixels somebody paid for with their attention. */
export default function SaveBar() {
  const [state, setState] = useState<SaveState>(current);

  useEffect(() => subscribe(setState), []);

  if (state.kind === "idle") return null;

  const failed = state.kind === "failed";
  return (
    <div
      className={`save-bar ${state.kind}`}
      role={failed ? "alert" : "status"}
      aria-label="Saving"
    >
      {state.kind === "saving" && (
        <>
          {/* The animation is decoration; the words carry the meaning, which is
              what a screen reader and a stopped animation both fall back to. */}
          <span className="save-spinner" aria-hidden="true" />
          <span>Saving {state.what.toLowerCase()}…</span>
        </>
      )}

      {state.kind === "saved" && (
        <>
          <span className="save-tick" aria-hidden="true">
            ✓
          </span>
          <span>{state.what} saved</span>
        </>
      )}

      {failed && (
        <>
          <span className="save-cross" aria-hidden="true">
            ✕
          </span>
          {/* The adapter's or the database's own words. A bar that said only
              "could not save" would send somebody looking for the reason that
              was already in hand. */}
          <span>
            {state.what} not saved — {state.why}
          </span>
          {/* A failure does not fade, so there has to be a way to put it away
              once it has been read. */}
          <button type="button" onClick={dismiss} aria-label="Dismiss">
            ✕
          </button>
        </>
      )}
    </div>
  );
}
