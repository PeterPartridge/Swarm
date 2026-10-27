import { useEffect, useState } from "react";
import ConsolePanes from "../components/code/ConsolePanes";
import { listSolutions, type Solution } from "../lib/backend";

/** The console, pulled out into its own OS window.
 *
 *  **It reads the Solution rather than being handed it.** A window is opened by
 *  URL and has no props, so the alternative was to encode the Solution's name,
 *  type and folder in query parameters — three copies of facts the database
 *  already holds, going stale the moment somebody renames it.
 *
 *  The shell survives the trip because the PTY lives in the backend: the id is
 *  passed and adopted, and `attach_terminal` hands back the recent output to
 *  catch up on. The debugger's output does not survive it — that is a stream of
 *  events with no replay — so this window says it starts from now. */
export default function StandaloneConsole({
  solutionId,
  terminalId,
}: {
  solutionId: number;
  /** A shell already running for this Solution, or null to start one. */
  terminalId: string | null;
}) {
  const [solution, setSolution] = useState<Solution | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const found = (await listSolutions()).find((s) => s.id === solutionId);
        if (!found) {
          setError("That Solution is not in this workspace any more.");
          return;
        }
        setSolution(found);
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [solutionId]);

  return (
    <div className="standalone-console">
      {error && <p role="alert">{error}</p>}
      {solution === null && error === null && <p className="hint">Opening…</p>}
      {solution && (
        <>
          <header className="standalone-console-head">
            <strong>{solution.name}</strong>
            <span className="card-mono">{solution.localPath ?? "no working copy"}</span>
          </header>
          <ConsolePanes solution={solution} adoptId={terminalId} fromNow />
        </>
      )}
    </div>
  );
}
