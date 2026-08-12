import { useCallback, useEffect, useState } from "react";
import CodeWindow from "./CodeWindow";
import { hueFor, markFor } from "../ai/AgentLane";
import {
  linesIn,
  loadBreakpoints,
  logLinesIn,
  marksIn,
  setCondition,
  setHits,
  setLog,
  toggleBreakpoint,
  type BreakpointStore,
} from "../../lib/breakpoints";
import { readSolutionFile, type Solution } from "../../lib/backend";

/** The file picked in the Files pane, open for editing.
 *
 *  **Why it is separate from `CodeEditor`.** That component is a whole workspace
 *  — its own Solution picker, its own explorer, its own tabs — and Build already
 *  has all three: the Solution bar, the Files pane and the agent lane. Rendering
 *  it here meant two explorers side by side, each with its own idea of what was
 *  open. This is the editor half on its own, pointed at whatever the shared
 *  Files pane last handed it.
 *
 *  The buffer is held here rather than in `CodeWindow` so switching files and
 *  coming back does not silently drop an unsaved edit — it is reloaded from
 *  disk only when the file actually changes. */
export default function BuildFileEditor({
  solution,
  path,
  onClose,
  stoppedLine,
}: {
  solution: Solution;
  path: string;
  onClose: () => void;
  /** The line the debugger is stopped on, when the stop is in this file. */
  stoppedLine?: number | null;
}) {
  const [saved, setSaved] = useState("");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /// Breakpoints live on this machine, not in the database — see lib/breakpoints.
  const [marks, setMarks] = useState<BreakpointStore>(() => loadBreakpoints());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const contents = await readSolutionFile(solution.id, path);
      setSaved(contents);
      setValue(contents);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [solution.id, path]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = value !== saved;
  /// The breakpoints in this file, so each can be given a condition. Only shown
  /// when there is at least one — an empty strip would be a control with
  /// nothing to act on.
  const marksHere = marksIn(marks, solution.id, path);

  return (
    <section
      className="build-file"
      aria-label={`${path} in ${solution.name}`}
      style={{ "--agent-hue": hueFor(solution.id) } as React.CSSProperties}
    >
      <header className="build-file-head">
        <span className="build-file-mark" aria-hidden="true">
          {markFor(solution.name)}
        </span>
        <div className="build-file-who">
          <strong>{path.split("/").pop()}</strong>
          <span className="card-mono">
            {solution.name} · {path}
          </span>
        </div>
        {dirty && <span className="build-file-dirty">unsaved</span>}
        <button type="button" aria-label={`Close ${path}`} onClick={onClose}>
          Close
        </button>
      </header>

      {marksHere.length > 0 && (
        <div className="build-file-breaks" aria-label={`Breakpoints in ${path}`}>
          {marksHere.map((m) => (
            <div className="build-break" key={m.line}>
              <span className="build-break-line card-mono">
                line {m.line}
                {/* A log point does not stop, and the row has to say so — a
                    mark that never stops otherwise reads as a debugger that is
                    not working. */}
                {m.log !== "" && <em className="build-break-kind">logs</em>}
              </span>
              <input
                type="text"
                aria-label={`Condition for line ${m.line}`}
                placeholder={m.log === "" ? "stop every time" : "log every time"}
                value={m.condition}
                onChange={(e) =>
                  setMarks((prev) =>
                    setCondition(prev, solution.id, path, m.line, e.target.value),
                  )
                }
              />
              <input
                type="text"
                className="build-break-hits"
                aria-label={`Hit count for line ${m.line}`}
                placeholder="every hit"
                value={m.hits}
                onChange={(e) =>
                  setMarks((prev) => setHits(prev, solution.id, path, m.line, e.target.value))
                }
              />
              <input
                type="text"
                aria-label={`Message for line ${m.line}`}
                placeholder="print instead of stopping"
                value={m.log}
                onChange={(e) =>
                  setMarks((prev) => setLog(prev, solution.id, path, m.line, e.target.value))
                }
              />
            </div>
          ))}
          {/* The expression is the debugged program's own language — Go for a
              Go Solution — because the adapter evaluates it in the running
              process, not here. Saying so beats somebody trying JavaScript. */}
          <p className="hint">
            Conditions are written in {solution.language ?? "the program's own language"} and
            evaluated by the debugger, in the running program. A message makes the line{" "}
            <strong>print and carry on</strong> instead of stopping — <code>{"{i}"}</code> inside it
            is evaluated the same way, and the output appears in the debugger panel. A hit count
            waits for that many visits first, in the debugger&rsquo;s own grammar
            (<code>7</code> for js-debug, <code>== 7</code> for Delve).
          </p>
        </div>
      )}

      {error && <p role="alert">{error}</p>}
      {loading && <p className="hint">Reading…</p>}

      {!loading && error === null && (
        <CodeWindow
          // Keyed by Solution *and* path: two Solutions can each hold a
          // `src/main.rs`, and one buffer for both would show the wrong file.
          key={`${solution.id}:${path}`}
          solutionId={solution.id}
          path={path}
          value={value}
          saved={saved}
          onChange={setValue}
          onSaved={(contents) => setSaved(contents)}
          breakpoints={linesIn(marks, solution.id, path)}
          logPoints={logLinesIn(marks, solution.id, path)}
          onToggleBreakpoint={(line) =>
            setMarks((prev) => toggleBreakpoint(prev, solution.id, path, line))
          }
          stoppedLine={stoppedLine}
        />
      )}
    </section>
  );
}
