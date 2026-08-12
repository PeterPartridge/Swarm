import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { absoluteFor, loadBreakpoints } from "../../lib/breakpoints";
import {
  debugResume,
  debugSetBreakpoints,
  debugExpand,
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
 *  Go, TypeScript and C# can launch today; Python is found and speaks DAP but
 *  has no launch shape yet, so a button that always failed would be worse than
 *  a sentence saying so. */
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

/** The languages whose launch shape is built.
 *
 *  Go through Delve, TypeScript and JavaScript through js-debug, C# through
 *  netcoredbg — each verified against the real adapter, stopping a real program
 *  on a real line. Python is found and speaks DAP but has no launch shape yet.
 *
 *  C# is launched from its **built assembly**, so starting it before a build
 *  fails with "run `dotnet build` first" rather than starting a debugger that
 *  stops at nothing. */
const CAN_LAUNCH = ["go", "typescript", "csharp"];
/** A variable that has been opened: its fields, or why they could not be got. */
interface Opened {
  fields?: DebugVariable[];
  problem?: string;
}

/** One variable and, when it is open, everything under it.
 *
 *  Recursive because the data is: a field can be a struct whose fields are
 *  structs. Each level is fetched only when opened — see `Live::expand`, which
 *  will not walk the graph eagerly, because a linked list would be followed to
 *  its end and a cyclic one would never finish.
 *
 *  Rows are keyed by their **path** rather than the adapter's reference number.
 *  Two different variables can hold the same reference once the program has
 *  moved, and keying on it would open the wrong row. */
function VariableTree({
  variables,
  at,
  opened,
  onToggle,
}: {
  variables: DebugVariable[];
  /** The path of the parent, empty at the top. */
  at: string;
  opened: Record<string, Opened>;
  onToggle: (path: string, reference: number) => void;
}) {
  return (
    <ul className="var-tree">
      {variables.map((v, index) => {
        // The index is in the path because an array's elements can share a
        // name, and duplicate keys would collapse them into one row.
        const path = `${at}/${index}-${v.name}`;
        const open = opened[path];
        return (
          <li key={path}>
            <div className="var-row">
              {v.children > 0 ? (
                <button
                  type="button"
                  className="var-open"
                  aria-expanded={open !== undefined}
                  aria-label={`${open !== undefined ? "Close" : "Open"} ${v.name}`}
                  onClick={() => onToggle(path, v.children)}
                >
                  {open !== undefined ? "▾" : "▸"}
                </button>
              ) : (
                <span className="var-open empty" aria-hidden="true" />
              )}
              <span className="var-name">{v.name}</span>
              <span className="var-value card-mono">{v.value}</span>
              {v.kind && <span className="var-kind">{v.kind}</span>}
            </div>
            {open?.problem && <p className="hint var-problem">{open.problem}</p>}
            {open?.fields &&
              (open.fields.length === 0 ? (
                <p className="hint var-problem">Nothing inside it.</p>
              ) : (
                <VariableTree
                  variables={open.fields}
                  at={path}
                  opened={opened}
                  onToggle={onToggle}
                />
              ))}
          </li>
        );
      })}
    </ul>
  );
}

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
export default function DebugSession({
  solution,
  onStopped,
  onResumed,
}: {
  solution: Solution;
  /** Where the program stopped, so the workspace can open that file and put a
   *  stepping toolbar above it — the controls have to stay reachable while you
   *  are looking at the line they act on. */
  onStopped?: (at: { session: string; threadId: number; frame: Frame }) => void;
  /** It is moving again, or gone: the highlight and the toolbar go with it. */
  onResumed?: () => void;
}) {
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
  const [opened, setOpened] = useState<Record<string, Opened>>({});
  const [output, setOutput] = useState<Line[]>([]);
  const [placed, setPlaced] = useState<string | null>(null);
  /// Whether this adapter evaluates breakpoint conditions. Null until a session
  /// has started, because it is the adapter’s own answer to `initialize`
  /// rather than something this app can know in advance.
  const [conditions, setConditions] = useState<boolean | null>(null);
  /// The same, for printing a message instead of stopping.
  const [logPoints, setLogPoints] = useState<boolean | null>(null);

  /// The session id as the event listener sees it. A listener registered once
  /// would otherwise capture the id from the render it was created in, and stop
  /// recognising its own session the moment a second one started.
  const current = useRef<string | null>(null);
  current.current = session;

  /// The callbacks, held in refs for the same reason as the session id: the
  /// listener is registered once, and a parent that re-renders would otherwise
  /// leave it calling a stale copy.
  const stoppedRef = useRef(onStopped);
  stoppedRef.current = onStopped;
  const resumedRef = useRef(onResumed);
  resumedRef.current = onResumed;

  const showFrame = useCallback(
    async (id: string, frame: number) => {
      setFrameId(frame);
      /// Every open row goes with the frame. A `variablesReference` is only
      /// valid for the stop and frame it was handed out in, so carrying the
      /// open state across would redraw someone else’s memory under the
      /// old name — worse than showing nothing.
      setOpened({});
      try {
        setVariables(await debugVariables(id, frame));
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  /// Opens a variable, or closes it again.
  ///
  /// Fetched once per opening rather than cached: the handle dies when the
  /// program moves, and a remembered expansion would show a value that is no
  /// longer true.
  const toggleVariable = useCallback(
    async (path: string, reference: number) => {
      const id = current.current;
      if (!id) return;
      if (opened[path] !== undefined) {
        setOpened((prev) => {
          const next = { ...prev };
          // Everything nested under it goes too, or reopening would show the
          // children of a row that has since been refetched.
          for (const key of Object.keys(next)) {
            if (key === path || key.startsWith(`${path}/`)) delete next[key];
          }
          return next;
        });
        return;
      }
      // Marked open straight away so the caret turns and a slow adapter does
      // not read as a click that did nothing.
      setOpened((prev) => ({ ...prev, [path]: {} }));
      try {
        const fields = await debugExpand(id, reference);
        setOpened((prev) => (path in prev ? { ...prev, [path]: { fields } } : prev));
      } catch (e) {
        setOpened((prev) => (path in prev ? { ...prev, [path]: { problem: String(e) } } : prev));
      }
    },
    [opened],
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
            // anybody wants first — and the one the editor should open.
            if (stack[0]) {
              await showFrame(from, stack[0].id);
              stoppedRef.current?.({ session: from, threadId: thread, frame: stack[0] });
            }
          } catch (e) {
            setError(String(e));
          }
        })();
      } else if (event === "continued") {
        setState("running");
        setFrames([]);
        setVariables([]);
        setOpened({});
        resumedRef.current?.();
      } else if (event === "output") {
        const text = String(body?.output ?? "");
        if (text.trim() !== "") {
          setOutput((prev) => [...prev.slice(-200), { at: Date.now(), text }]);
        }
      } else if (event === "terminated" || event === "exited" || event === "dap-closed") {
        setState("ended");
        setFrames([]);
        setVariables([]);
        setOpened({});
        resumedRef.current?.();
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
      setConditions(started.conditions);
      setLogPoints(started.logPoints);

      // Where they actually landed, not where they were asked for: an adapter
      // slides a breakpoint to the next executable line.
      const moved = started.breakpoints.filter(
        (b) => b.verified && b.line !== null && b.line !== b.requested,
      );
      // A refusal carries the adapter’s own words — "this debugger cannot
      // evaluate breakpoint conditions" is the answer somebody needs, and a
      // bare count of failures is not.
      const refused = started.breakpoints.filter((b) => !b.verified);
      const why = [...new Set(refused.map((b) => b.message).filter(Boolean))];
      setPlaced(
        [
          moved.length > 0
            ? `${moved.length} moved to the next line that runs`
            : "",
          refused.length > 0
            ? `${refused.length} could not be set${why.length > 0 ? `: ${why.join("; ")}` : ""}`
            : "",
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
    resumedRef.current?.();
  }

  async function resume(how: "continue" | "over" | "in" | "out") {
    if (!session || threadId === null) return;
    setState("running");
    setFrames([]);
    setVariables([]);
    // Not every adapter sends `continued` for a step, so the highlight is
    // cleared here as well — a stale arrow on a line the program has left is
    // worse than none.
    resumedRef.current?.();
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
          Go, TypeScript and C# work today.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {placed && <p className="hint">{placed}</p>}
      {/* Said once, on starting: the condition boxes in the editor are always
          there, and this is the only moment the adapter’s own answer is known. */}
      {conditions === false && (
        <p className="hint">
          This debugger does not evaluate breakpoint conditions, so any condition you have set
          holds its breakpoint back rather than being ignored.
        </p>
      )}
      {logPoints === false && (
        <p className="hint">
          This debugger cannot print a message instead of stopping, so any log message you have
          set holds its breakpoint back rather than turning it into an ordinary stop.
        </p>
      )}

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
                  <VariableTree
                    variables={variables}
                    at=""
                    opened={opened}
                    onToggle={toggleVariable}
                  />
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
