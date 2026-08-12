import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { absoluteFor, loadBreakpoints } from "../../lib/breakpoints";
import {
  addWatch,
  loadWatches,
  removeWatch,
  watchesIn,
  type WatchStore,
} from "../../lib/watches";
import {
  debugResume,
  debugSetBreakpoints,
  debugEvaluate,
  debugExpand,
  debugRestartFrame,
  debugStack,
  debugStart,
  debugStop,
  debugThreads,
  debugVariables,
  type DebugThread,
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

/** What one watched expression last came to in the selected frame.
 *
 *  **A problem is an ordinary answer here**, not a failure: an expression that
 *  is out of scope in the frame you happen to have selected is a normal thing
 *  to be looking at, because you set it for a different one. */
interface Watched {
  value?: DebugVariable;
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
  onStopped?: (at: {
    session: string;
    threadId: number;
    frame: Frame;
    /** Whether this adapter answers a hover, so the editor knows whether to
     *  offer one rather than finding out per pointer movement. */
    hovers: boolean;
  }) => void;
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
  /// Every thread, and which one the adapter stopped on. They are different
  /// questions: the stopped one is where the breakpoint hit, the selected one
  /// is what you are looking at and what a step will act on.
  const [threads, setThreads] = useState<DebugThread[]>([]);
  const [stoppedOn, setStoppedOn] = useState<number | null>(null);
  /// The expressions being kept an eye on, and what each last came to.
  ///
  /// The list lives on this machine and outlasts the session — see lib/watches
  /// — while the answers belong to one frame and are thrown away with it.
  const [watches, setWatches] = useState<WatchStore>(() => loadWatches());
  const [watched, setWatched] = useState<Record<string, Watched>>({});
  const [typed, setTyped] = useState("");
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
  /// The same again, for counting hits before stopping.
  const [hitCounts, setHitCounts] = useState<boolean | null>(null);
  /// Whether a frame can be run again. Unlike the three breakpoint extras this
  /// is not about breakpoints at all — it is the only per-frame operation DAP
  /// has, and so the only thing selecting a frame can actually do.
  const [canRestartFrame, setCanRestartFrame] = useState<boolean | null>(null);

  /// The session id as the event listener sees it. A listener registered once
  /// would otherwise capture the id from the render it was created in, and stop
  /// recognising its own session the moment a second one started.
  const current = useRef<string | null>(null);
  current.current = session;
  /// The selected thread, for the same reason: `showFrame` reports where we
  /// are and needs to name the thread without being re-made whenever it changes.
  const threadRef = useRef<number | null>(null);
  threadRef.current = threadId;

  /// The callbacks, held in refs for the same reason as the session id: the
  /// listener is registered once, and a parent that re-renders would otherwise
  /// leave it calling a stale copy.
  const stoppedRef = useRef(onStopped);
  stoppedRef.current = onStopped;
  const resumedRef = useRef(onResumed);
  resumedRef.current = onResumed;

  /// The watches, in a ref so evaluating them does not re-make `showFrame` on
  /// every keystroke in the add box — which would re-run the effect that calls
  /// it and re-fetch the variables for no reason.
  const watchesRef = useRef<string[]>([]);
  watchesRef.current = watchesIn(watches, solution.id);

  /// Works out every watch against one frame.
  ///
  /// **Re-run rather than remembered**, for the same reason an expansion is:
  /// the answer belongs to a frame and a moment, and showing yesterday's value
  /// under today's expression is worse than showing nothing.
  ///
  /// Each expression is asked for on its own so one that is out of scope leaves
  /// the others alone — a single failed watch must not blank the pane.
  const evaluateWatches = useCallback(async (id: string, frame: number) => {
    const wanted = watchesRef.current;
    if (wanted.length === 0) {
      setWatched({});
      return;
    }
    const answers = await Promise.all(
      wanted.map(async (expression): Promise<[string, Watched]> => {
        try {
          return [expression, { value: await debugEvaluate(id, expression, frame) }];
        } catch (e) {
          return [expression, { problem: String(e) }];
        }
      }),
    );
    setWatched(Object.fromEntries(answers));
  }, []);

  /// The adapter's hover answer, in a ref: it is settled once at the start of a
  /// session and read from inside callbacks that must not be re-made for it.
  const hoversRef = useRef(false);

  const showFrame = useCallback(
    async (id: string, picked: Frame) => {
      const frame = picked.id;
      setFrameId(frame);
      // **The editor follows the selection, not only the stop.** Picking a
      // caller is a request to look at that frame, so the highlight moves to
      // its line and a hover there is evaluated in its scope — which is a
      // different question from the same name in the innermost frame.
      stoppedRef.current?.({
        session: id,
        threadId: threadRef.current ?? 0,
        frame: picked,
        hovers: hoversRef.current,
      });
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
      // After the variables rather than beside them: a watch is usually about
      // something in this frame, and the frame's own values are what somebody
      // looks at first.
      await evaluateWatches(id, frame);
    },
    [evaluateWatches],
  );

  /// Shows one thread: its stack, its innermost frame, and that frame's
  /// variables.
  ///
  /// Used both when the adapter stops and when somebody picks a different
  /// thread, because they are the same thing — and the editor follows either
  /// way, since with every thread stopped the program really is at that line
  /// too.
  const showThread = useCallback(
    async (id: string, thread: number) => {
      setThreadId(thread);
      try {
        const stack = await debugStack(id, thread);
        setFrames(stack);
        // The innermost frame is where it stopped, which is the one anybody
        // wants first — and the one the editor should open.
        if (stack[0]) {
          // `showFrame` tells the workspace where we are, so it is not also
          // told here — two notifications for one stop would fight over which
          // line the editor draws.
          await showFrame(id, stack[0]);
        } else {
          // A thread with no frames is a real answer — one that has not started
          // or has just finished — and clearing is better than leaving the last
          // thread's stack under this one's name.
          setFrames([]);
          setVariables([]);
          setOpened({});
        }
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    },
    [showFrame],
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
        setStoppedOn(thread);
        void (async () => {
          // Asked for at every stop rather than once: threads come and go while
          // a program runs, and a list from the last stop would be showing
          // threads that have since ended.
          try {
            setThreads(await debugThreads(from));
          } catch (e) {
            setError(String(e));
          }
          await showThread(from, thread);
        })();
      } else if (event === "continued") {
        setState("running");
        setFrames([]);
        setVariables([]);
        setOpened({});
        // The answers go, the expressions stay: what a watch came to belonged
        // to a frame that no longer exists, but the question is still the
        // question.
        setWatched({});
        // The list goes too: while the program runs it is a snapshot of a
        // moment that has passed, and a picker offering threads that may have
        // ended is worse than none.
        setThreads([]);
        setStoppedOn(null);
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
        setWatched({});
        setThreads([]);
        setStoppedOn(null);
        resumedRef.current?.();
      } else if (event === "dap-broken") {
        setState("ended");
        setError(String(body?.message ?? "the adapter stopped making sense"));
      }
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, [showThread]);

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
      setHitCounts(started.hitCounts);
      setCanRestartFrame(started.restartFrame);
      hoversRef.current = started.hovers;

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

  /// Opening a watch reuses the variable machinery exactly: a watch that comes
  /// back a struct is a struct, and its fields are fetched a level at a time
  /// like any other. Only the top row differs, because that one has an
  /// expression rather than a name and can carry a problem instead of a value.
  const onToggleWatch = toggleVariable;

  /// Starts watching an expression, and works it out straight away.
  ///
  /// Evaluated on adding rather than at the next stop, because the reason
  /// somebody types one is to see it **now** — waiting for the next step would
  /// make the box feel broken.
  async function watch() {
    const expression = typed.trim();
    if (expression === "") return;
    setWatches((prev) => addWatch(prev, solution.id, expression));
    setTyped("");
    if (!session || frameId === null) return;
    try {
      const value = await debugEvaluate(session, expression, frameId);
      setWatched((prev) => ({ ...prev, [expression]: { value } }));
    } catch (e) {
      setWatched((prev) => ({ ...prev, [expression]: { problem: String(e) } }));
    }
  }

  function unwatch(expression: string) {
    setWatches((prev) => removeWatch(prev, solution.id, expression));
    setWatched((prev) => {
      const next = { ...prev };
      delete next[expression];
      return next;
    });
  }

  /// Puts the program back at the start of one call.
  ///
  /// Not treated as a resume: the adapter answers with a fresh `stopped`, so
  /// the highlight and the stack are replaced by that event rather than
  /// guessed at here.
  async function restartFrame(frame: number) {
    if (!session) return;
    try {
      await debugRestartFrame(session, frame);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  /// Continue, or one of the three steps.
  ///
  /// **Acts on the selected thread**, not on the one that stopped. Unlike a
  /// frame, a thread is something DAP's step requests can be pointed at — they
  /// carry a `threadId` — so picking a thread and stepping it is a real
  /// operation rather than a UI that only looks like one.
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
  const kept = watchesIn(watches, solution.id);

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
      {hitCounts === false && (
        <p className="hint">
          This debugger cannot count hits, so any hit count you have set holds its breakpoint back
          rather than stopping on the first time round.
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

          {/* **Why this is a list and not a line.** The thread that stopped is
              rarely the one holding the lock, so a debugger that only ever
              showed the stopped thread could not show a deadlock at all. Only
              drawn when there is more than one: a single-threaded program has
              nothing to pick between. */}
          {stopped && threads.length > 1 && (
            <div className="session-threads" role="group" aria-label="Threads">
              <span className="palette-label">Threads</span>
              <div className="thread-row">
                {threads.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={threadId === t.id ? "thread on" : "thread"}
                    aria-pressed={threadId === t.id}
                    aria-label={`Thread ${t.name}`}
                    onClick={() => session && showThread(session, t.id)}
                  >
                    {t.name}
                    {/* Which one the breakpoint actually hit. Everything else
                        is stopped too, but only one of them is why. */}
                    {t.id === stoppedOn && <em className="thread-here">stopped here</em>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {stopped && (
            <div className="session-panes">
              <div className="session-stack">
                <span className="palette-label">Call stack</span>
                <ul>
                  {frames.map((f, depth) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        className={frameId === f.id ? "frame on" : "frame"}
                        aria-pressed={frameId === f.id}
                        aria-label={`Frame ${f.name}`}
                        onClick={() => session && showFrame(session, f)}
                      >
                        <span className="frame-name">{f.name}</span>
                        {/* A frame with no source is a real frame — runtime
                            internals — and hiding it would make the stack lie
                            about how the program got here. */}
                        <span className="frame-at card-mono">
                          {f.path ? `${f.path.split(/[/\\]/).pop()}:${f.line}` : "no source"}
                        </span>
                      </button>
                      {/* The only thing DAP lets a *frame* be told to do. It is
                          offered per frame rather than once, because a runtime
                          frame cannot be restarted even where its neighbours
                          can — `canRestart` says which. */}
                      {canRestartFrame && f.canRestart && depth > 0 && (
                        <button
                          type="button"
                          className="frame-again"
                          aria-label={`Run ${f.name} again`}
                          onClick={() => restartFrame(f.id)}
                        >
                          Run again
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {/* **The mismatch this round is really about.** Selecting a
                    caller and stepping steps the innermost frame, because DAP's
                    step requests carry a thread and nothing else. Saying so is
                    the only honest option: there is no version of this app that
                    could make stepping follow the selection. */}
                {frames.length > 1 && frameId !== frames[0]?.id && (
                  <p className="hint">
                    Stepping always acts on <strong>{frames[0]?.name}</strong>, the innermost
                    frame — the debugger steps a thread, not a frame. Running a frame again is
                    the one thing that acts on the frame you picked.
                  </p>
                )}
              </div>

              <div className="session-watch">
                <span className="palette-label">Watch</span>
                {/* **What the variable list cannot answer.** That shows what
                    happens to have a name in scope; this shows what somebody
                    wants to know — `subtotal + tax`, `len(items)` — none of
                    which are variables anywhere. */}
                <form
                  className="watch-add"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void watch();
                  }}
                >
                  <input
                    type="text"
                    aria-label="Watch an expression"
                    placeholder={`an expression in ${solution.language ?? "the program's language"}`}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                  />
                  <button type="submit" disabled={typed.trim() === ""}>
                    Watch
                  </button>
                </form>

                {kept.length === 0 ? (
                  <p className="hint">
                    Nothing watched. An expression here is worked out by the debugger inside the
                    running program, in the frame selected above.
                  </p>
                ) : (
                  <ul className="watch-list">
                    {kept.map((expression) => {
                      const answer = watched[expression];
                      const path = `watch/${expression}`;
                      const open = opened[path];
                      return (
                        <li key={expression}>
                          <div className="var-row">
                            {answer?.value && answer.value.children > 0 ? (
                              <button
                                type="button"
                                className="var-open"
                                aria-expanded={open !== undefined}
                                aria-label={`${open !== undefined ? "Close" : "Open"} ${expression}`}
                                onClick={() => onToggleWatch(path, answer.value!.children)}
                              >
                                {open !== undefined ? "▾" : "▸"}
                              </button>
                            ) : (
                              <span className="var-open empty" aria-hidden="true" />
                            )}
                            <span className="var-name">{expression}</span>
                            {/* An expression out of scope in *this* frame is an
                                ordinary answer — you set it for another one —
                                so it is said on the row rather than raised over
                                the panel. */}
                            <span
                              className={answer?.problem ? "var-value hint" : "var-value card-mono"}
                            >
                              {answer?.problem ?? answer?.value?.value ?? "—"}
                            </span>
                            {answer?.value?.kind && (
                              <span className="var-kind">{answer.value.kind}</span>
                            )}
                            <button
                              type="button"
                              className="watch-drop"
                              aria-label={`Stop watching ${expression}`}
                              onClick={() => unwatch(expression)}
                            >
                              ×
                            </button>
                          </div>
                          {open?.problem && <p className="hint var-problem">{open.problem}</p>}
                          {open?.fields && open.fields.length > 0 && (
                            <VariableTree
                              variables={open.fields}
                              at={path}
                              opened={opened}
                              onToggle={toggleVariable}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
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
