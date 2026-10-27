import { useCallback, useEffect, useState } from "react";
import {
  agentRunModes,
  getAgentRunMode,
  setAgentRunMode,
} from "../../lib/backend";

/** How much an agent stops to ask while it works.
 *
 *  **The point of the framework is that it does not stop.** An agent that asks
 *  before every edit is a person doing the work with extra keystrokes, and the
 *  terminal fills with prompts nobody wants to answer — which is the complaint
 *  this exists to answer.
 *
 *  **And "never ask" is a real decision, so it is made here and not by
 *  default.** An agent running unattended can do anything the shell can, inside
 *  its own checkout and outside it. The option says so in the words the flag
 *  uses rather than in a friendlier phrase that hides what it turns on. The
 *  default is the middle one: writes inside the run's own checkout go through,
 *  and anything else still stops. */
export default function AgentRunMode() {
  const [modes, setModes] = useState<[string, string][]>([]);
  const [mode, setMode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loaded, current] = await Promise.all([agentRunModes(), getAgentRunMode()]);
      setModes(loaded);
      setMode(current);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function choose(next: string) {
    setMode(next);
    try {
      await setAgentRunMode(next);
      setError(null);
    } catch (e) {
      setError(String(e));
      await refresh();
    }
  }

  return (
    <section className="agent-run-mode" aria-label="How agents run">
      <h3>How agents run</h3>
      <p className="hint">
        What an agent stops to ask about while it works in its own checkout.
        This is the command every run hands to its terminal.
      </p>

      {error && <p role="alert">{error}</p>}

      <div role="radiogroup" aria-label="How agents run" className="run-mode-list">
        {modes.map(([id, label]) => (
          <label key={id}>
            <input
              type="radio"
              name="agent-run-mode"
              checked={mode === id}
              onChange={() => void choose(id)}
            />
            {label}
          </label>
        ))}
      </div>

      {mode === "never" && (
        // Said where the choice was made, not buried in a doc: this is the one
        // option that can do something nobody watched happen.
        <p className="hint warn">
          Agents will run unattended, with no prompt before anything they do —
          including commands outside their own checkout. Only worth it when you
          trust the brief and the repository it runs in.
        </p>
      )}
    </section>
  );
}
