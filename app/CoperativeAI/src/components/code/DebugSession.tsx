import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { absoluteFor, loadBreakpoints } from "../../lib/breakpoints";
import {
  debugResume,
  debugSetBreakpoints,
  debugStack,
  debugStart,
  debugStop,
  debugVariables,
  type Frame,
  type DebugVariable,
  type Solution,
} from "../../lib/backend";

/** Which language this Solution would be debugged as.
 *
 *  Guessed from what it was created as, which is the only signal recorded —
 *  and `Solution.language` is explicitly "a record of what it was begun as, not
 *  a claim about what it is now". So a wrong guess is possible, and the panel
 *  names the language it is offering rather than silently picking one.
 *
 *  Only Go can launch today; the rest are found and speak DAP but have no
 *  launch shape yet, so a button that always failed would be worse than a
 *  sentence saying so. */
export function debugLanguageOf(language: string | null): string | null {
  const said = (language ?? "").toLowerCase();
  if (said.includes("go")) return "go";
  if (said.includes("python")) return "python";
  if (said.includes("c#") || said.includes("dotnet") || said.includes(".net")) return "csharp";
  if (said.includes("typescript") || said.includes("javascript") || said.includes("node")) {
    return "typescript";
  }
  return null;
}

/** The languages whose launch shape is built. */
const CAN_LAUNCH = ["go"];
/** One line of the program's own output. */
interface Line {
  at: number;
  text: string;
}

/** What the adapter told us, as it arrives. */
interface DebugEvent {
  session: string;
  event: string;
  body: Record<string, unknown> | null;
}

/** Running a program under its debugger: stop, look, step.
 *
 *  **The stop is the whole thing.** Everything here hangs off the `stopped`
 *  event: it names a thread, the thread gives a stack, the top frame gives the
 *  variables in scope. Nothing is polled — an adapter says when it has stopped
 *  and says nothing in between, so asking repeatedly would only be a way to be
 *  wrong between answers.
 *
 *  Breakpoints come from the editor's gutter, per machine, and are sent as
 *  absolute paths because an adapter matches against what the compiler
 *  recorded. Changing them while the program runs pushes the new set straight
 *  down — a breakpoint you set mid-session and that only took effect on the
 *  next run would be worse than one that did nothing at all, because you would
 *  believe it. */
export default function DebugSession({ solution }: { solution: Solution }) {
  const language = debugLanguageOf(solution.language);
  const canLaunch = language !== null && CAN_LAUNCH.includes(language);
  const [session, setSession] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "running" | "stopped" | "ended">("idle");
  const [reason, setReason] = useState("");
  const [threadId, setThreadId] = useState<number | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [frameId, setFrameId] = useState<number | null>(null);
  const [variables, setVariables] = useState<DebugVariable[]>([]);
  const [output, setOutput] = useState<Line[]>([]);
  const [placed, setPlaced] = useState<string | null>(null);

  /// The session id as the event listener sees it. A listener registered once
  /// would otherwise capture the id from the render it was created in, and stop
  /// recognising its own session the moment a second one started.
  const current = useRef<string | null>(null);
  current.current = session;

  const showFrame = useCallback(
    async (id: string, frame: number) => {
      setFrameId(frame);
      try {
        setVariables(await debugVariables(id, frame));
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  // Everything the adapter says, as it says it.
  useEffect(() => {
    const unlisten = listen<DebugEvent>("debug-event", (message) => {
      const { session: from, event, body } = message.payload;
      if (from !== current.current) return;

      if (event === "stopped") {
        const thread = Number(body?.threadId ?? 0);
        setState("stopped");
        setReason(String(body?.reason ?? "stopped"));
        setThreadId(thread);
        void (async () => {
          try {
            const stack = await debugStack(from, thread);
            setFrames(stack);
            // The innermost frame is where it stopped, which is the one
            // anybody wants first.
            if (stack[0]) await showFrame(from, stack[0].id);
          } catch (e) {
            setError(String(e));
          }
        })();
      } else if (event === "continued") {
        setState("running");
        setFrames([]);
        setVariables([]);
      } else if (event === "output") {
        const text = String(body?.output ?? "");
        if (text.trim() !== "") {
          setOutput((prev) => [...prev.slice(-200), { at: Date.now(), text }]);
        }
      } else if (event === "terminated" || event === "exited" || event === "dap-closed") {
        setState("ended");
        setFrames([]);
        setVariables([]);
      } else if (event === "dap-broken") {
        setState("ended");
        setError(String(body?.message ?? "the adapter stopped making sense"));
      }
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, [showFrame]);

  // A session is a real process. Leaving the panel ends it rather than leaking
  // a debugger and the program under it.
  useEffect(() => {
    return () => {
      if (current.current) void debugStop(current.current);
    };
  }, []);

  async function start() {
    if (!solution.localPath) return;
    setBusy(true);
    setError(null);
    setOutput([]);
    try {
      const marks = absoluteFor(loadBreakpoints(), solution.id, solution.localPath);
      const started = await debugStart(language ?? "go", solution.localPath, marks);
      setSession(started.session);
      current.current = started.session;
      setState("running");

      // Where they actually landed, not where they were asked for: an adapter
      // slides a breakpoint to the next executable line.
      const moved = started.breakpoints.filter(
        (b) => b.verified && b.line !== null && b.line !== b.requested,
      );
      const refused = started.breakpoints.filter((b) => !b.verified);
      setPlaced(
        [
          moved.length > 0
            ? `${moved.length} moved to the next line that runs`
            : "",
          refused.length > 0 ? `${refused.length} could not be set` : "",
        ]
          .filter(Boolean)
          .join(" · ") || null,
      );
    } catch (e) {
      setError(String(e));
      setSession(null);
      current.current = null;
      setState("idle");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!session) return;
    try {
      await debugStop(session);
    } catch (e) {
      setError(String(e));
    }
    setSession(null);
    current.current = null;
    setState("idle");
    setFrames([]);
    setVariables([]);
  }

  async function resume(how: "continue" | "over" | "in" | "out") {
    if (!session || threadId === null) return;
    setState("running");
    setFrames([]);
    setVariables([]);
    try {
      await debugResume(session, how, threadId);
    } catch (e) {
      setError(String(e));
    }
  }

  /** Pushes the gutter's current breakpoints into the running session. */
  async function pushBreakpoints() {
    if (!session || !solution.localPath) return;
    try {
      await debugSetBreakpoints(
        session,
        absoluteFor(loadBreakpoints(), solution.id, solution.localPath),
      );
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  const stopped = state === "stopped";

  return (
    <section className="debug-session" aria-label={`Debugger for ${solution.name}`}>
      <header className="session-head">
        <span className={`session-dot ${state}`} aria-hidden="true" />
        <strong>{solution.name}</strong>
        <span className="session-state">
          {state === "idle"
            ? "not running"
            : state === "running"
              ? "running"
              : state === "stopped"
                ? `stopped — ${reason}`
                : "ended"}
        </span>
        <span className="process-spacer" />
        {session === null ? (
          <button
            type="button"
            aria-label={`Debug ${solution.name}`}
            disabled={busy || !solution.localPath || !canLaunch}
            onClick={start}
          >
            {busy ? "Starting…" : "Debug"}
          </button>
        ) : (
          <>
            <button
              type="button"
              aria-label="Send the current breakpoints"
              onClick={pushBreakpoints}
            >
              Sync breakpoints
            </button>
            <button type="button" aria-label={`Stop debugging ${solution.name}`} onClick={stop}>
              Stop
            </button>
          </>
        )}
      </header>

      {!solution.localPath && (
        <p className="hint">
          No working copy on this machine, so there is nothing to run. Point it
          at a folder on the Map tab.
        </p>
      )}
      {solution.localPath && !canLaunch && (
        <p className="hint">
          {language === null
            ? "This Solution records no language, so there is nothing to pick a debugger by."
            : `Launching ${language} is not wired up yet — its adapter is found and speaks DAP, but its launch shape is still to do.`}{" "}
          Go works today.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {placed && <p className="hint">{placed}</p>}

      {session !== null && (
        <>
          {/* Only where they would do something: a step button while the
              program is running has nothing to step. */}
          <div className="session-controls" role="group" aria-label="Stepping">
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
                disabled={!stopped}
                onClick={() => resume(how)}
              >
                {label}
              </button>
            ))}
          </div>

          {stopped && (
            <div className="session-panes">
              <div className="session-stack">
                <span className="palette-label">Call stack</span>
                <ul>
                  {frames.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        className={frameId === f.id ? "frame on" : "frame"}
                        aria-pressed={frameId === f.id}
                        aria-label={`Frame ${f.name}`}
                        onClick={() => session && showFrame(session, f.id)}
                      >
                        <span className="frame-name">{f.name}</span>
                        {/* A frame with no source is a real frame — runtime
                            internals — and hiding it would make the stack lie
                            about how the program got here. */}
                        <span className="frame-at card-mono">
                          {f.path ? `${f.path.split(/[/\\]/).pop()}:${f.line}` : "no source"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="session-vars">
                <span className="palette-label">Variables</span>
                {variables.length === 0 ? (
                  <p className="hint">Nothing in scope in this frame.</p>
                ) : (
                  <ul>
                    {variables.map((v) => (
                      <li key={`${v.name}-${v.value}`}>
                        <span className="var-name">{v.name}</span>
                        <span className="var-value card-mono">{v.value}</span>
                        {v.kind && <span className="var-kind">{v.kind}</span>}
                        {/* Counted but not openable yet, and said so rather
                            than drawn as a caret that does nothing. */}
                        {v.children > 0 && <span className="var-more">has fields</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {output.length > 0 && (
            <pre className="session-output" aria-label="Program output">
              {output.map((l) => l.text).join("")}
            </pre>
          )}
        </>
      )}
    </section>
  );
}
