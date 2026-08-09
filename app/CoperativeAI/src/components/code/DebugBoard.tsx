import { useCallback, useEffect, useState } from "react";
import DebugAdapters from "./DebugAdapters";
import DebugSession from "./DebugSession";
import DevServerPanel from "./DevServerPanel";
import TerminalPanel from "./TerminalPanel";
import { guessDevPort } from "../../lib/devServer";
import { hueFor, markFor } from "../ai/AgentLane";
import {
  listTerminals,
  suggestDevCommand,
  type RunningTerminal,
  type Solution,
} from "../../lib/backend";

/** Ctrl-C, as the keystroke a PTY expects. Named rather than inlined: an
 *  invisible control character in a template literal is unreadable in a diff and
 *  survives a careless edit only by luck. */
const INTERRUPT = "";

/** How long a shell has been open here, in the coarsest unit that still says
 *  something. Timed from when this window opened it, which is the only start
 *  the app can honestly claim to know. */
export function uptime(since: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** The ticking clock, alone in its own component.
 *
 *  It used to live on the board, which meant every attached shell, every run
 *  panel and every terminal re-rendered once a second to move one number. Only
 *  this span re-renders now. */
function Uptime({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{uptime(since, now)}</>;
}

/** Debug: every Solution's process, running at once.
 *
 *  **What this is.** A real PTY per Solution, in its own working copy, with that
 *  Solution's detected run command ready to type into it. Several run side by
 *  side, which is the thing the Code tab's single terminal could never do — you
 *  can have the front end, the API and the worker all up and watch all three.
 *
 *  **What it deliberately is not.** The design this came from drew a debugger:
 *  step in/over/out, a call stack, variables you could edit mid-run, breakpoints
 *  and per-run environment overrides. This app has no debug adapter and manages
 *  no environment, so every one of those controls would have been furniture that
 *  looks like it works — the worst kind, because a breakpoint that silently does
 *  nothing costs more than no breakpoint at all. Nor are there CPU and memory
 *  figures: the app does not read the process table.
 *
 *  What it does know is which shells it opened, in which folder, running what,
 *  and for how long. That is what it shows.
 *
 *  **Nothing is attached until asked.** A terminal is a real child process, so
 *  opening one per Solution on arrival would spawn several the moment somebody
 *  clicked Debug to look. */
export default function DebugBoard({
  solutions,
  active = true,
}: {
  solutions: Solution[];
  /** False while Debug is mounted but behind another Build pane. The shells
   *  keep running; only their terminals stop being measured. */
  active?: boolean;
}) {
  /// Which Solutions have a shell mounted, and when each reported itself open.
  const [attached, setAttached] = useState<number[]>([]);
  const [openedAt, setOpenedAt] = useState<Record<number, number>>({});
  const [pending, setPending] = useState<Record<number, string | null>>({});
  /// Each Solution's run command, read once so the header can show the port this
  /// would probably listen on without waiting for anybody to attach.
  const [commands, setCommands] = useState<Record<number, string>>({});
  /// Hide the Solutions that cannot run at all, so the ones that can are not
  /// buried under them.
  const [showAll, setShowAll] = useState(true);
  /// Shells already running when this board mounted — the registry's whole
  /// point. Keyed by Solution, newest kept.
  const [existing, setExisting] = useState<Record<number, RunningTerminal>>({});

  const setOpen = useCallback((id: number, open: boolean) => {
    setOpenedAt((prev) => {
      if (open && prev[id]) return prev;
      if (!open && !prev[id]) return prev;
      const next = { ...prev };
      if (open) next[id] = Date.now();
      else delete next[id];
      return next;
    });
  }, []);

  // What is already up. Asked once on mount rather than polled: the registry
  // only changes when this window changes it, and a board that re-read it on a
  // timer would fight its own Attach.
  useEffect(() => {
    let dropped = false;
    void (async () => {
      try {
        const open = await listTerminals();
        if (dropped) return;
        const byId: Record<number, RunningTerminal> = {};
        for (const t of open) byId[t.solutionId] = t;
        setExisting(byId);
        // Anything already running is shown running, without being asked for:
        // it is this board's own process from before it unmounted.
        setAttached((prev) => [
          ...prev,
          ...open.map((t) => t.solutionId).filter((id) => !prev.includes(id)),
        ]);
      } catch {
        // No registry answer just means nothing is offered to pick up.
      }
    })();
    return () => {
      dropped = true;
    };
  }, []);

  // One read per Solution with a folder, for the port guess in the header. A
  // failure just means no guess for that one.
  useEffect(() => {
    let dropped = false;
    void (async () => {
      const found: Record<number, string> = {};
      await Promise.all(
        solutions
          .filter((s) => s.localPath)
          .map(async (s) => {
            try {
              const dev = await suggestDevCommand(s.id);
              if (dev.start) found[s.id] = dev.start;
            } catch {
              // No guess for this one; the rest still get theirs.
            }
          }),
      );
      if (!dropped) setCommands(found);
    })();
    return () => {
      dropped = true;
    };
  }, [solutions]);

  /** Ctrl-C, then the run command again.
   *
   *  Restart rather than Detach-and-Attach because closing the shell loses the
   *  scrollback, which is usually the thing you wanted to read before restarting
   *  in the first place. Both the interrupt and the command after it go in as
   *  keystrokes, so they land in the scrollback like anything else typed —
   *  nothing is run behind the panel. */
  const restart = useCallback(
    (id: number) => {
      const command = commands[id];
      if (!command) return;
      setPending((prev) => ({ ...prev, [id]: `${INTERRUPT}${command}` }));
    },
    [commands],
  );

  const runnable = solutions.filter((s) => s.localPath);
  const stranded = solutions.length - runnable.length;
  const shown = showAll ? solutions : runnable;
  const running = Object.keys(openedAt).length;

  return (
    <section className="debug-board" aria-label="Debug">
      <header className="debug-head">
        <div>
          <strong>Debug — every Solution at once</strong>
          <p className="hint">
            A real shell per Solution, in its own working copy. Attach the ones
            you want up; they keep running while you work elsewhere in Build.
          </p>
        </div>
        <span className={running > 0 ? "debug-count on" : "debug-count"}>
          {running} of {runnable.length} running
        </span>
      </header>

      {/* The strip: what is up, at a glance, without scrolling the shells. */}
      <ul className="debug-strip">
        {shown.map((s) => {
          const up = openedAt[s.id];
          return (
            <li
              key={s.id}
              className={up ? "on" : ""}
              style={{ "--agent-hue": hueFor(s.id) } as React.CSSProperties}
            >
              <span className="strip-mark" aria-hidden="true">
                {markFor(s.name)}
              </span>
              <span className="strip-name">{s.name}</span>
              <span className="strip-state">
                {!s.localPath ? "no folder" : up ? <Uptime since={up} /> : "not started"}
              </span>
            </li>
          );
        })}
      </ul>

      {solutions.length === 0 && (
        <p className="hint">This Product has no Solutions to run.</p>
      )}

      {stranded > 0 && (
        <button
          type="button"
          className="debug-filter"
          aria-pressed={!showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll
            ? `Hide the ${stranded} with no working copy`
            : `Show the ${stranded} with no working copy`}
        </button>
      )}

      <div className="debug-processes">
        {shown.map((s) => {
          const isAttached = attached.includes(s.id);
          const command = commands[s.id];
          return (
            <section
              key={s.id}
              className="debug-process"
              aria-label={`Process for ${s.name}`}
              style={{ "--agent-hue": hueFor(s.id) } as React.CSSProperties}
            >
              <header className="process-head">
                <span
                  className={openedAt[s.id] ? "process-dot on" : "process-dot"}
                  aria-hidden="true"
                />
                <strong>{s.name}</strong>
                <span className="process-type">{s.solutionType}</span>
                {/* A guess, and said to be one — the run command is detected
                    from the folder, not read from a config that states a port,
                    so a URL presented as fact would send somebody hunting a bug
                    in their server when the guess was simply wrong. */}
                {command && (
                  <span className="process-port" title="Guessed from the run command">
                    probably {guessDevPort(command)}
                  </span>
                )}
                <span className="process-spacer" />
                {openedAt[s.id] && (
                  <span className="process-uptime">
                    up <Uptime since={openedAt[s.id]} />
                  </span>
                )}
                {isAttached && openedAt[s.id] && command && (
                  <button
                    type="button"
                    aria-label={`Restart ${s.name}`}
                    onClick={() => restart(s.id)}
                  >
                    Restart
                  </button>
                )}
                <button
                  type="button"
                  aria-label={
                    isAttached ? `Detach ${s.name}` : `Attach a shell to ${s.name}`
                  }
                  disabled={!s.localPath}
                  onClick={() =>
                    setAttached((prev) =>
                      isAttached ? prev.filter((id) => id !== s.id) : [...prev, s.id],
                    )
                  }
                >
                  {isAttached ? "Detach" : "Attach"}
                </button>
              </header>

              {!s.localPath && (
                <p className="hint">
                  No working copy on this machine, so there is nowhere to run it.
                  Point it at a folder on the Map tab.
                </p>
              )}

              {/* The debugger sits with the process it debugs: running
                  something and stopping it mid-line are two questions about
                  the same Solution. */}
              {s.localPath && <DebugSession solution={s} />}

              {isAttached && s.localPath && (
                <div className="process-body">
                  {/* The detected run command, typed into the shell below rather
                      than executed behind it — so what started is in the
                      scrollback like anything else. */}
                  <DevServerPanel
                    solution={s}
                    terminalReady={!!openedAt[s.id]}
                    onRunInTerminal={(c) =>
                      setPending((prev) => ({ ...prev, [s.id]: c }))
                    }
                  />
                  <TerminalPanel
                    solution={s}
                    active={active}
                    // The registry keeps these: leaving Build must not kill a
                    // dev server somebody started here.
                    keepAlive
                    adoptId={existing[s.id]?.id ?? null}
                    pendingCommand={pending[s.id] ?? null}
                    onCommandSent={() => setPending((prev) => ({ ...prev, [s.id]: null }))}
                    onOpenChange={(open) => setOpen(s.id, open)}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* The debuggers, under the processes: running something and stopping it
          mid-line are two different questions, and the first one works today. */}
      <DebugAdapters />

      <p className="hint">
        The process board reads no CPU or memory — what it knows is which shells
        it opened, where, and for how long.
      </p>
    </section>
  );
}
