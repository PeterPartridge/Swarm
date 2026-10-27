import { useCallback, useEffect, useRef, useState } from "react";
import { readinessOf, useDebuggers } from "../../lib/debuggers";
import {
  setSolutionRunCommand,
  suggestDevCommand,
  type DevCommand,
  type Solution,
} from "../../lib/backend";

/** What one press of Debug, Run or Hot reload asks for. */
export interface RunRequest {
  solutionIds: number[];
  /** `run` types the plain command into a shell, `watch` the one that rebuilds
   *  on change, and `debug` launches the program under its debug adapter.
   *
   *  **Debug is not "run, plus something".** An adapter starts the program
   *  itself, so typing the run command as well would start a second copy — the
   *  board picks one or the other per Solution. */
  how: "run" | "watch" | "debug";
  /** So asking twice for the same thing still moves. */
  at: number;
}

/** Which Solutions to run, what to run in each, and the two presses.
 *
 *  **A picker, not the Solution you happen to be on.** Defaulting to the one
 *  being browsed is right nearly always, and wrong exactly when it matters: the
 *  front end you are reading is not the API you need up to read it. So the
 *  default is the Solution you are in and the control is a multi-select, which
 *  can also be none of them.
 *
 *  **The command is a dropdown per Solution.** Detection gets it right for a
 *  repository laid out the usual way and cannot for anything else, and the
 *  escape hatch used to be a form somewhere else. The choices are what
 *  detection found plus whatever this Solution has been given, and "Something
 *  else…" opens a box that is remembered against the Solution. */
export default function RunBar({
  solutions,
  browsing,
  startNow,
  onRun,
}: {
  /** Bumped when something else — the Debug button — wants what is picked
   *  started. A timestamp, so asking twice still moves.
   *
   *  **Asked of this component rather than read out of it.** Which Solutions
   *  are picked and which of them can actually run is this picker's business;
   *  lifting it out so a button elsewhere could read it would put the same
   *  judgement in two places. */
  startNow?: number;
  /** The Product's Solutions. Ones with no working copy are listed and cannot
   *  be ticked — saying why beats leaving them out and being asked where they
   *  went. */
  solutions: Solution[];
  /** The Solution the bar has selected, which is the default to run. */
  browsing: number | null;
  onRun: (request: RunRequest) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [commands, setCommands] = useState<Record<number, DevCommand>>({});
  /// The Solution whose command is being typed, and the text so far.
  const [editing, setEditing] = useState<{ id: number; typed: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);
  /// What this machine can actually debug — read once, by running each
  /// candidate adapter rather than looking for a filename.
  const { adapters, settled, recheck } = useDebuggers();

  // The Solution you are on is the default, and follows the bar until somebody
  // makes a choice of their own — after which it stays put, because a selection
  // that quietly re-pointed itself when you clicked a tab would run the wrong
  // thing and look like it had run the right one.
  const chosen = useRef(false);
  useEffect(() => {
    if (!chosen.current) setPicked(browsing === null ? [] : [browsing]);
  }, [browsing]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (holder.current && !holder.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const load = useCallback(async () => {
    const found: Record<number, DevCommand> = {};
    await Promise.all(
      solutions
        .filter((s) => s.localPath)
        .map(async (s) => {
          try {
            found[s.id] = await suggestDevCommand(s.id);
          } catch {
            // No guess for this one; the rest still get theirs, and its row
            // says there is nothing to run rather than showing an empty box.
          }
        }),
    );
    setCommands(found);
  }, [solutions]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveCommand(id: number, command: string | null) {
    try {
      await setSolutionRunCommand(id, command);
      setEditing(null);
      setError(null);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  const runnable = picked.filter((id) => (commands[id]?.start ?? "") !== "");
  /// Only where there is a watcher to run. A front end's Run already reloads
  /// itself, so a second button for it would do the same thing under a name
  /// that promised something different.
  const watchable = picked.filter((id) => (commands[id]?.watch ?? "") !== "");

  // The Debug press, arriving from the bar. Held in refs so the effect can
  // fire the current selection without being re-made every time it changes.
  const pickedRef = useRef<number[]>([]);
  pickedRef.current = picked;
  const runRef = useRef(onRun);
  runRef.current = onRun;
  useEffect(() => {
    if (!startNow) return;
    if (pickedRef.current.length === 0) return;
    // Everything picked, not only what has a run command: a Solution launched
    // under its debugger does not need one, so filtering by it here would drop
    // exactly the Solutions Debug is for.
    runRef.current({ solutionIds: pickedRef.current, how: "debug", at: startNow });
  }, [startNow]);

  const label =
    picked.length === 0
      ? "Nothing picked"
      : picked.length === 1
        ? (solutions.find((s) => s.id === picked[0])?.name ?? "One Solution")
        : `${picked.length} Solutions`;

  return (
    <div className="run-bar" ref={holder}>
      <button
        type="button"
        className="run-picker"
        aria-expanded={open}
        aria-label="Choose what to run"
        onClick={() => setOpen((v) => !v)}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="run-menu" role="group" aria-label="What to run">
          {error && <p role="alert">{error}</p>}
          {solutions.length === 0 && (
            <p className="hint">This Product has no Solutions to run.</p>
          )}
          {solutions.map((s) => {
            const dev = commands[s.id];
            const isEditing = editing?.id === s.id;
            const debugger_ = readinessOf(s.language, adapters);
            return (
              <div className="run-row" key={s.id}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Run ${s.name}`}
                    checked={picked.includes(s.id)}
                    disabled={!s.localPath}
                    onChange={(e) => {
                      chosen.current = true;
                      setPicked((prev) =>
                        e.target.checked
                          ? [...prev, s.id]
                          : prev.filter((id) => id !== s.id),
                      );
                    }}
                  />{" "}
                  {s.name}
                </label>

                {!s.localPath ? (
                  <span className="hint">
                    no working copy here — point it at a folder on the Map tab
                  </span>
                ) : isEditing ? (
                  <span className="run-command-edit">
                    <input
                      type="text"
                      aria-label={`Run command for ${s.name}`}
                      placeholder="npm run dev"
                      value={editing.typed}
                      autoFocus
                      onChange={(e) => setEditing({ id: s.id, typed: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveCommand(s.id, editing.typed);
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                    <button type="button" onClick={() => void saveCommand(s.id, editing.typed)}>
                      Save
                    </button>
                  </span>
                ) : (
                  /* What detection found, what this Solution was given, and the
                     way out of both. One control, where the override used to be
                     a form on another panel. */
                  <select
                    aria-label={`Command for ${s.name}`}
                    value={dev?.custom ? "custom" : "detected"}
                    onChange={(e) => {
                      if (e.target.value === "edit") {
                        setEditing({ id: s.id, typed: dev?.start ?? "" });
                      } else if (e.target.value === "detected") {
                        void saveCommand(s.id, null);
                      }
                    }}
                  >
                    {dev?.start ? (
                      <option value={dev.custom ? "custom" : "detected"}>
                        {dev.start}
                        {dev.custom ? " (this Solution's own)" : ` (from ${dev.foundBy})`}
                      </option>
                    ) : (
                      <option value="detected">
                        {dev?.unavailable ?? "nothing detected"}
                      </option>
                    )}
                    {dev?.custom && <option value="detected">Back to detection</option>}
                    <option value="edit">Something else…</option>
                  </select>
                )}

                {/* **What Debug will do to this one, before it is pressed.**
                    Finding out that Delve is not installed by pressing Debug
                    and reading a DAP failure is the worst version of this: the
                    answer is one command, and it can be shown now. */}
                {s.localPath && (
                  <span
                    className={`run-debugger ${debugger_.state}`}
                    // The install line is long and belongs to one row, so it is
                    // a title rather than another line in an already busy menu.
                    title={
                      debugger_.state === "missing" && debugger_.install !== ""
                        ? `${debugger_.problem} Install with: ${debugger_.install}`
                        : undefined
                    }
                  >
                    {debugger_.state === "ready"
                      ? `debugs with ${debugger_.label}`
                      : debugger_.state === "missing"
                        ? `${debugger_.label} not installed — runs in a shell`
                        : debugger_.state === "unknown"
                          ? // A read that finished and told us nothing is not
                            // still going, and saying it is would leave that
                            // word on screen for ever.
                            settled
                            ? "could not tell — Debug will try"
                            : "checking the debugger…"
                          : "no debugger for its language — runs in a shell"}
                  </span>
                )}
              </div>
            );
          })}

          {/* The command itself, copyable, for whichever rows are missing one.
              A tooltip is fine for reading and useless for pasting. */}
          {solutions
            .map((s) => readinessOf(s.language, adapters))
            .filter(
              (r, i, all): r is Extract<typeof r, { state: "missing" }> =>
                r.state === "missing" &&
                r.install !== "" &&
                // one line per adapter, not per Solution using it
                all.findIndex((o) => o.state === "missing" && o.label === r.label) === i,
            )
            .map((r) => (
              <p className="hint run-install" key={r.label}>
                To debug {r.label}: <code>{r.install}</code>{" "}
                {/* Installed in a terminal somewhere else, so nothing here can
                    be told it happened. Returning to the window re-reads on its
                    own; this is for the case where it did not. */}
                <button type="button" className="link" onClick={recheck}>
                  Look again
                </button>
              </p>
            ))}
        </div>
      )}

      <button
        type="button"
        aria-label="Run the picked Solutions"
        disabled={runnable.length === 0}
        onClick={() => onRun({ solutionIds: runnable, how: "run", at: Date.now() })}
      >
        Run
      </button>
      {/* Checked before the press rather than discovered as a shell error
          after it: a button that cannot work should say so. */}
      <button
        type="button"
        aria-label="Hot reload the picked Solutions"
        disabled={watchable.length === 0}
        title={
          watchable.length === 0
            ? "Nothing picked has a watcher. A front end's Run already reloads itself."
            : undefined
        }
        onClick={() => onRun({ solutionIds: watchable, how: "watch", at: Date.now() })}
      >
        Hot reload
      </button>
    </div>
  );
}
