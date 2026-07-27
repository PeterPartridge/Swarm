import { useCallback, useEffect, useState } from "react";
import {
  setSolutionRunCommand,
  suggestDevCommand,
  type DevCommand,
  type Solution,
} from "../../lib/backend";

/** Runs a Solution while working on it, into the terminal below.
 *
 *  Two buttons, because they answer the two halves of the request. **Run**
 *  spins the front end up — a Vite or Next dev server that reloads itself, so
 *  saving a file refreshes the browser with no further help. **Hot refresh** is
 *  for the backends that do not reload themselves: `cargo run` builds once and
 *  stops, so a compiled service is kept fresh by a watcher (`cargo watch`,
 *  `dotnet watch`, `air`) that rebuilds and restarts on change. The panel only
 *  shows the second button when there is a watcher to show.
 *
 *  The command is detected from what is in the folder, and overridable per
 *  Solution for the toolchains detection does not know — the same escape hatch
 *  as the test command, so a wrong guess is never permanent. Both go into the
 *  same shell the AI panel uses, typed in rather than run behind it, so what
 *  started is visible in the scrollback like anything else. */
export default function DevServerPanel({
  solution,
  onRunInTerminal,
  terminalReady,
}: {
  solution: Solution;
  /** Hands a command line to the terminal panel below. */
  onRunInTerminal: (command: string) => void;
  /** False when no shell is open yet, so the buttons can say why. */
  terminalReady: boolean;
}) {
  const [dev, setDev] = useState<DevCommand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /// The override editor: closed until asked for, so the common case is the
  /// detected command with one button, not a form.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await suggestDevCommand(solution.id);
      setDev(d);
      setError(null);
    } catch (e) {
      setDev(null);
      setError(String(e));
    }
  }, [solution.id]);

  useEffect(() => {
    void load();
  }, [load]);

  function run(command: string, sent: string) {
    if (!command) return;
    onRunInTerminal(command);
    setNotice(sent);
  }

  async function saveOverride(command: string | null) {
    setSaving(true);
    try {
      await setSolutionRunCommand(solution.id, command);
      setEditing(false);
      setNotice(command ? "Run command saved for this Solution." : "Back to detection.");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="dev-server-panel" aria-label="Run">
      <h3>Run</h3>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {dev?.unavailable && !editing && (
        <p className="hint">
          {dev.unavailable}. Set a run command below and it will be remembered.
        </p>
      )}

      {dev && !dev.unavailable && (
        <>
          <p className="hint">
            {dev.custom
              ? "This Solution's own run command."
              : `Detected from ${dev.foundBy}.`}
          </p>

          <div className="dev-command">
            <code>{dev.start}</code>
            <button onClick={() => run(dev.start, "Started in the terminal below.")}
              disabled={!terminalReady}>
              Run
            </button>
          </div>

          {/* The watcher only exists for backends that do not reload themselves;
              a front end's Run already refreshes, so no second button for it. */}
          {dev.watch && (
            <div className="dev-command">
              <code>{dev.watch}</code>
              <button
                onClick={() => run(dev.watch, "Hot refresh started in the terminal below.")}
                disabled={!terminalReady}
              >
                Hot refresh
              </button>
            </div>
          )}

          {dev.watch && dev.watchNeeds && (
            <p className="hint">
              Hot refresh needs {dev.watchNeeds}. If it is missing, the terminal
              will say so and Run still works without it.
            </p>
          )}
        </>
      )}

      {!terminalReady && dev && !dev.unavailable && (
        <p className="hint">Open the terminal below first.</p>
      )}

      {editing ? (
        <div className="dev-override">
          <label>
            Run command for {solution.name}
            <input
              aria-label="Run command"
              placeholder="npm run dev"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <div className="dev-override-actions">
            <button onClick={() => void saveOverride(draft)} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            {dev?.custom && (
              <button onClick={() => void saveOverride(null)} disabled={saving}>
                Clear — use detection
              </button>
            )}
            <button onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="dev-override-open"
          onClick={() => {
            setDraft(dev?.custom ? dev.start : "");
            setEditing(true);
          }}
        >
          {dev?.custom ? "Change run command" : "Set a run command"}
        </button>
      )}
    </section>
  );
}
