import { useCallback, useEffect, useState } from "react";
import {
  sandboxReport,
  setAgentSandbox,
  setUpSandbox,
  type Protection,
  type SandboxMode,
  type SandboxReport,
  type SetUpResult,
} from "../../lib/backend";

/** What this machine can offer an agent, and what it cannot.
 *
 *  **This is the honest half of the sandbox, and it comes first on purpose.**
 *  The point of running an agent inside a boundary is defeated by a boundary
 *  that is only nominally one — and the commonest such boundary is a stock WSL
 *  distribution, which mounts the whole Windows drive and therefore stops
 *  nothing at all. So the app establishes what is really true of this machine
 *  and shows that, rather than showing what the chosen option is *called*.
 *
 *  **The choice is offered only where it can be honoured.** A mode that is not
 *  built, or one that is built but has nothing set up on this machine, would
 *  refuse every command the moment somebody opened a terminal. So it appears,
 *  disabled, with the reason beside it — the app saying no and saying why beats
 *  a setting that breaks something quietly two screens away.
 *
 *  Detection runs external tools, so it happens once when the panel opens and
 *  again only when somebody asks. Nothing is remembered between looks: the
 *  configuration underneath can be changed outside this app. */
export default function SandboxTable() {
  const [report, setReport] = useState<SandboxReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which mode is being set up, so only its own button says so. */
  const [building, setBuilding] = useState("");
  const [result, setResult] = useState<SetUpResult | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setReport(await sandboxReport());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  async function choose(mode: SandboxMode) {
    try {
      await setAgentSandbox(mode.id);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
    await check();
  }

  async function setUp(mode: SandboxMode) {
    setBuilding(mode.id);
    setResult(null);
    try {
      setResult(await setUpSandbox(mode.id));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBuilding("");
      await check();
    }
  }

  return (
    <section className="sandbox-table" aria-label="Where agents can run">
      <h3>Where agents can run</h3>
      <p className="hint">
        What this machine actually enforces — established by asking WSL and
        Docker, not by the name of the option. Nothing here is remembered
        between looks, because it can be changed outside this app.
      </p>

      {error && <p role="alert">{error}</p>}

      <button type="button" onClick={() => void check()} disabled={checking}>
        {checking ? "Checking…" : "Check again"}
      </button>

      {!report && !error && <p className="hint">Asking this machine…</p>}

      {report && (
        <table>
          <thead>
            <tr>
              <th scope="col">Protection</th>
              {report.modes.map((mode) => (
                <th key={mode.id} scope="col">
                  {mode.label}
                  {/* The header carries this, not a footnote: a column read
                      without it looks like a list of protections in force. */}
                  {!mode.built && <span className="badge">not built yet</span>}
                  {/* **The choice, offered only where it can be honoured.** A
                      mode with nothing set up would refuse every command the
                      moment somebody used the terminal, so it is disabled and
                      the reason sits under it rather than being a mystery. */}
                  <label>
                    <input
                      type="radio"
                      name="agent-sandbox"
                      checked={mode.id === report.chosen}
                      disabled={!mode.canChoose || building !== ""}
                      onChange={() => void choose(mode)}
                    />
                    Run agents here
                  </label>
                  <span className="hint">{mode.chooseDetail}</span>
                  <span className="hint">{mode.summary}</span>
                  {mode.id !== "off" && (
                    <>
                      <button
                        type="button"
                        onClick={() => void setUp(mode)}
                        disabled={!mode.canSetUp || building !== ""}
                      >
                        {building === mode.id ? "Setting up…" : "Set this up"}
                      </button>
                      {/* Always shown, enabled or not: what it would do, or
                          why it cannot. A disabled button with no reason
                          beside it is a dead end. */}
                      <span className="hint">{mode.setUpDetail}</span>
                    </>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.modes[0]?.protections.map((row, index) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                {report.modes.map((mode) => (
                  <Cell key={mode.id} protection={mode.protections[index]} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {result && (
        <section className="set-up-result" aria-label="What setting up did">
          <p>{result.summary}</p>
          <ol>
            {result.steps.map((step) => (
              <li key={step.name}>
                <span>
                  {step.name} — {step.succeeded ? "done" : "failed"}
                </span>
                {/* Whole, and in the tool's own words. When a download fails
                    or a package is missing, this is the only thing that says
                    which one. */}
                {step.output && <pre>{step.output}</pre>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}

/** One verdict, in words.
 *
 *  **No padlock and no tick.** A symbol is read as reassurance before it is
 *  read at all, and three of these states are not reassuring. Each cell says
 *  what it is and why, because the reason is the useful part — "no boundary"
 *  and "no boundary *because your distribution mounts C:*" send somebody to
 *  very different next steps. */
function Cell({ protection }: { protection: Protection | undefined }) {
  if (!protection) {
    return <td />;
  }
  const words: Record<Protection["state"], string> = {
    enforced: "In force",
    availableNotBuilt: "This machine could — not built yet",
    unavailable: "No",
  };
  return (
    <td className={`sandbox-cell ${protection.state}`}>
      <span className="verdict">{words[protection.state]}</span>
      <span className="hint">{protection.detail}</span>
    </td>
  );
}
