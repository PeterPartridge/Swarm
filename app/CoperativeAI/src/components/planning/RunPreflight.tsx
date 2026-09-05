import { useCallback, useEffect, useState } from "react";
import { runGates, type RunGate } from "../../lib/backend";
import { useWorkChanged } from "../../lib/workSignal";

/** One Solution's name, for the heading over its checks. */
export interface PreflightSolution {
  id: number;
  name: string;
}

/** What has to be true before Execute will start an agent, read before it is
 *  pressed.
 *
 *  **The way to find out what was missing was to fail.** A run needs an
 *  approved plan, permission for the AI to change the code, a Solution with a
 *  repository in it — and each of those said its piece only when Execute was
 *  pressed and refused. One at a time, in an error box, after the press. Read
 *  beforehand the same facts are a checklist.
 *
 *  **The same list the backend enforces.** `run_gates` is the function
 *  `prepare_run` itself walks, so what is shown here is exactly what would
 *  refuse. A second copy of these conditions written for a screen would drift
 *  from the ones that actually refuse, and a panel that disagrees with its own
 *  button is worse than no panel.
 *
 *  Met checks are shown as well as unmet ones. A list of only the problems
 *  cannot say what else was looked at, so "nothing wrong" reads the same as
 *  "nothing checked". */
export default function RunPreflight({
  workItemId,
  solutions,
  agentProblem,
}: {
  workItemId: number;
  /** The Solutions this work lands in — one run, and one list, each. */
  solutions: PreflightSolution[];
  /** What is wrong with the coding agent on this machine, when something is.
   *
   *  Passed in rather than probed here: the panel above already asks, and two
   *  components probing the same binary would run it twice for one screen. */
  agentProblem?: string | null;
}) {
  const [gates, setGates] = useState<Record<number, RunGate[]>>({});
  const [error, setError] = useState<string | null>(null);

  // Keyed by id and joined, so the effect re-runs when the Solutions change
  // rather than on every render that rebuilds the array.
  const key = solutions.map((s) => s.id).join(",");

  const refresh = useCallback(async () => {
    if (solutions.length === 0) {
      setGates({});
      return;
    }
    try {
      const read = await Promise.all(
        solutions.map(async (s) => [s.id, await runGates(workItemId, s.id)] as const),
      );
      setGates(Object.fromEntries(read));
      setError(null);
    } catch (e) {
      // **Not silence.** A checklist that cannot be read must not render as an
      // empty list, which reads as "all clear" on no evidence.
      setError(String(e));
    }
    // `key` stands in for the Solutions: the array is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workItemId, key]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Approving a plan or changing a policy happens on another panel, and this
  // one should not still be saying they are missing.
  useWorkChanged(refresh);

  if (solutions.length === 0) return null;

  return (
    <div className="run-preflight">
      {error && <p role="alert">{error}</p>}

      {solutions.map((solution) => {
        const checks = gates[solution.id] ?? [];
        if (checks.length === 0) return null;
        const unmet = checks.filter((c) => !c.ok).length;
        return (
          <div key={solution.id} className="preflight-group">
            <span className="palette-label">
              {solution.name}
              {unmet > 0 && (
                <span className="preflight-count"> · {unmet} outstanding</span>
              )}
            </span>
            <ul
              className="preflight-list"
              aria-label={`Before Execute: ${solution.name}`}
            >
              {checks.map((check) => (
                <li key={check.id} className={check.ok ? "met" : "unmet"}>
                  <span className="preflight-mark" aria-hidden="true">
                    {check.ok ? "✓" : "✗"}
                  </span>
                  <span className="preflight-label">{check.label}</span>
                  {/* Only when it is unmet: a detail beside a green row reads as
                      a warning about something that is fine. */}
                  {!check.ok && <span className="preflight-detail">{check.detail}</span>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {/* **Beside the gates, not among them.** Preparing a run makes a checkout
          and writes a brief, both of which are useful with no agent installed;
          what needs the agent is the command that runs afterwards. Somebody
          about to press Execute wants to know, and the backend does not refuse
          for it — so it is shown, and shown apart. */}
      {agentProblem && (
        <p className="preflight-agent" role="status" aria-label="The agent that will run it">
          {agentProblem}
        </p>
      )}
    </div>
  );
}
