import { useState } from "react";
import { debugResume, type Frame } from "../../lib/backend";

/** The stepping controls, above whatever the middle pane is showing.
 *
 *  **Why it is not inside the Debug board.** A stop opens the file it happened
 *  in, which replaces the board with the editor — and a debugger whose Continue
 *  button disappears the moment it stops is no use at all. So the controls sit
 *  above the pane rather than in one, which is where every editor puts them and
 *  for the same reason.
 *
 *  It exists only while the program is stopped. There is nothing to step when
 *  it is running, and a toolbar that is always there with everything greyed out
 *  is furniture. */
export default function DebugToolbar({
  session,
  threadId,
  frame,
  onResumed,
}: {
  session: string;
  threadId: number;
  /** The innermost frame — where it stopped. */
  frame: Frame;
  /** Called as soon as it is moving again, so the highlight goes with it. */
  onResumed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resume(how: "continue" | "over" | "in" | "out") {
    setBusy(true);
    // Cleared before the request, not after: the program is already moving by
    // the time the adapter answers, and a highlight left on the old line for
    // that gap points at somewhere it no longer is.
    onResumed();
    try {
      await debugResume(session, how, threadId);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="debug-toolbar" role="group" aria-label="Debugger">
      <span className="toolbar-dot" aria-hidden="true" />
      <span className="toolbar-where">
        <strong>{frame.name}</strong>
        <span className="card-mono">
          {frame.path
            ? `${frame.path.split(/[/\\]/).pop()}:${frame.line}`
            : "no source for this frame"}
        </span>
      </span>

      {(
        [
          ["continue", "Continue"],
          ["over", "Step over"],
          ["in", "Step into"],
          ["out", "Step out"],
        ] as const
      ).map(([how, label]) => (
        <button
          key={how}
          type="button"
          aria-label={label}
          disabled={busy}
          onClick={() => resume(how)}
        >
          {label}
        </button>
      ))}

      {error && (
        <span className="toolbar-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
