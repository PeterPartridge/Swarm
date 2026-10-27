import { useRef, useState } from "react";
import ConsolePanes from "./ConsolePanes";
import { openConsoleWindow, type Solution } from "../../lib/backend";

/** How far the pointer has to travel before a drag is a drag.
 *
 *  A window is not something to open by accident, and a header is also the
 *  thing you click to collapse the dock — so a few pixels of movement while
 *  clicking must stay a click. */
const DETACH_AT = 90;

/** The console, docked under the code — and dragged off it into its own OS
 *  window.
 *
 *  **The same space as the code, because that is where it is read.** Output
 *  belongs beside the line that produced it: a console on another tab means
 *  alt-tabbing between the thing that broke and the reason.
 *
 *  **Dragged out, not buttoned out.** Pulling a panel off is what the gesture
 *  means everywhere else, and a button labelled "detach" beside a panel you can
 *  also drag would be two answers to one question. The button is still there
 *  for a keyboard, because a drag is not reachable without a pointer and a
 *  feature only mice can use is a feature half the people here cannot. */
export default function ConsoleDock({
  solution,
  adoptId,
  active = true,
  pendingCommand,
  onCommandSent,
}: {
  solution: Solution;
  /** A shell already running for this Solution, to pick up rather than start
   *  a second one. */
  adoptId?: string | null;
  active?: boolean;
  pendingCommand?: string | null;
  onCommandSent?: () => void;
}) {
  /// Open in its own window. The dock keeps its place and says so rather than
  /// vanishing — a panel that disappears on being dragged looks like it was
  /// thrown away.
  const [detached, setDetached] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const from = useRef<{ x: number; y: number } | null>(null);

  async function detach() {
    try {
      await openConsoleWindow(solution.id, solution.name, adoptId ?? null);
      setDetached(true);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (detached) return;
    from.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!from.current) return;
    const moved = Math.hypot(e.clientX - from.current.x, e.clientY - from.current.y);
    // An unmeasurable move is not a drag. Without this, a pointer event that
    // carries no coordinates makes the distance NaN — and `NaN < 90` is false,
    // so every twitch would open a window.
    if (!Number.isFinite(moved) || moved < DETACH_AT) return;
    // Far enough to mean it. Cleared first so one drag cannot ask twice while
    // the window is being built.
    from.current = null;
    setDragging(false);
    void detach();
  }

  function onPointerUp() {
    from.current = null;
    setDragging(false);
  }

  return (
    <section
      className={`console-dock ${dragging ? "dragging" : ""} ${detached ? "away" : ""}`}
      aria-label={`Console for ${solution.name}`}
    >
      <header
        className="console-grip"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="console-grip-mark" aria-hidden="true">
          ⠿
        </span>
        <strong>Console</strong>
        <span className="card-mono">{solution.name}</span>
        <span className="hint">
          {detached ? "in its own window" : "drag to pull it out"}
        </span>
        <span className="process-spacer" />
        {!detached && (
          <>
            <button
              type="button"
              aria-label={collapsed ? "Show the console" : "Hide the console"}
              onClick={() => setCollapsed((v) => !v)}
            >
              {collapsed ? "Show" : "Hide"}
            </button>
            {/* A drag is not reachable from a keyboard, and a console only mice
                can pull out is a console half the people here cannot. */}
            <button
              type="button"
              aria-label={`Open the console for ${solution.name} in its own window`}
              onClick={() => void detach()}
            >
              Pull out
            </button>
          </>
        )}
        {detached && (
          <button
            type="button"
            aria-label={`Bring the console for ${solution.name} back`}
            onClick={() => setDetached(false)}
          >
            Bring it back
          </button>
        )}
      </header>

      {error && <p role="alert">{error}</p>}

      {detached ? (
        <p className="hint">
          This console is open in its own window. The shell kept running — it
          belongs to the app, not to either window.
        </p>
      ) : (
        !collapsed && (
          <ConsolePanes
            solution={solution}
            adoptId={adoptId}
            active={active}
            pendingCommand={pendingCommand}
            onCommandSent={onCommandSent}
          />
        )
      )}
    </section>
  );
}
