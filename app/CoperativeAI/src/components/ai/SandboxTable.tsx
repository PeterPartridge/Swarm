import { useCallback, useEffect, useState } from "react";
import DevicePolicyExport from "./DevicePolicyExport";
import PolicySource from "./PolicySource";
import {
  sandboxReport,
  setAgentSandbox,
  setUpSandbox,
  type Protection,
  type SandboxMode,
  type SandboxReport,
  type SetUpResult,
} from "../../lib/backend";

/** Where agents run, and what that really enforces on this machine.
 *
 *  **The honest half of the sandbox, arranged so it can be read.** The point of
 *  running an agent inside a boundary is defeated by a boundary that is only
 *  nominally one — and the commonest such boundary is a stock WSL distribution,
 *  which mounts the whole Windows drive and stops nothing at all. So the app
 *  establishes what is true of *this* machine and shows that, rather than what
 *  the chosen option is called.
 *
 *  **The decision comes first and the evidence sits under it.** An earlier
 *  version led with a five-by-three grid of prose, which is the whole truth and
 *  unreadable: somebody arriving to choose where their agents run had to parse
 *  fifteen cells before finding the one sentence that mattered. Now the current
 *  state is one line, each option is a card saying what it would give and what
 *  it needs, and the full table is a disclosure for whoever wants to check the
 *  claim. Nothing is hidden — it is ordered.
 *
 *  **The choice is offered only where it can be honoured.** A mode that is not
 *  built, or built but not set up here, would refuse every command the moment
 *  somebody opened a terminal. So it appears, disabled, with the reason beside
 *  it: the app saying no and saying why beats a setting that quietly breaks
 *  something two screens away. */
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

  /** The machine is looked at again before this is stored, so a mode that has
   *  quietly stopped being ready is refused rather than saved. */
  async function choose(mode: SandboxMode) {
    try {
      await setAgentSandbox(mode.id);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
    await check();
  }

  /** **The one press here that changes this computer.** It registers a
   *  distribution or builds an image, so it hands back everything it printed —
   *  a five-minute install reduced to "done" is one whose failure nobody can
   *  act on. The table is read again afterwards, because whether the verdicts
   *  changed is the entire point. */
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

  const chosen = report?.modes.find((mode) => mode.id === report.chosen);

  return (
    <section className="admin-card sandbox-panel" aria-label="Where agents run">
      <header className="sandbox-head">
        <h3>Where agents run</h3>
        <button type="button" onClick={() => void check()} disabled={checking}>
          {checking ? "Checking…" : "Check again"}
        </button>
      </header>

      {/* One sentence for the state everything else is about. */}
      {chosen && (
        <p className="sandbox-now">
          Agents run in <strong>{chosen.label}</strong>. {chosen.summary}
        </p>
      )}
      <p className="hint">
        Established by asking WSL and Docker, not by the name of the option, and
        never remembered between looks — it can be changed outside this app.
      </p>

      {error && <p role="alert">{error}</p>}
      {!report && !error && <p className="hint">Asking this machine…</p>}

      {report && (
        <>
          <div className="sandbox-modes" role="radiogroup" aria-label="Where agents run">
            {report.modes.map((mode) => (
              <article
                key={mode.id}
                aria-label={mode.label}
                className={`sandbox-mode${mode.id === report.chosen ? " chosen" : ""}`}
              >
                <label className="sandbox-pick">
                  <input
                    type="radio"
                    name="agent-sandbox"
                    checked={mode.id === report.chosen}
                    disabled={!mode.canChoose || building !== ""}
                    onChange={() => void choose(mode)}
                  />
                  <span className="sandbox-name">{mode.label}</span>
                </label>

                {/* In the card, never a footnote: a column read without this
                    looks like a list of protections in force. */}
                {!mode.built && <span className="badge">not built yet</span>}

                {/* **What this machine says about this option**, on the option
                    itself. Moving it to the one line at the top would have said
                    it only about whichever mode is already chosen — and the
                    ones you are deciding between are exactly the others. */}
                <p className="hint">{mode.summary}</p>
                <p className="hint">{mode.chooseDetail}</p>

                {mode.id !== "off" && (
                  <div className="sandbox-setup">
                    <button
                      type="button"
                      onClick={() => void setUp(mode)}
                      disabled={!mode.canSetUp || building !== ""}
                    >
                      {building === mode.id ? "Setting up…" : "Set this up"}
                    </button>
                    {/* Shown enabled or not: what it would do, or why it
                        cannot. A disabled button with no reason is a dead end. */}
                    <span className="hint">{mode.setUpDetail}</span>
                  </div>
                )}
              </article>
            ))}
          </div>

          {/* **Available, not hidden.** The claim above is only worth anything
              if the evidence for it can be read, so it is one click away rather
              than fifteen cells in the way. */}
          <details className="sandbox-detail">
            <summary>What each one actually enforces</summary>
            <div className="sandbox-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Protection</th>
                    {report.modes.map((mode) => (
                      <th key={mode.id} scope="col">
                        {mode.label}
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
            </div>
          </details>

          {/* Inside this card on purpose: a policy without a boundary keeps
              nothing from anybody, and a panel of its own would read as
              protection in its own right. */}
          <PolicySource />
          {/* Below the policy file, in the order somebody meets them: what an
              agent can reach is this app's to enforce, while whether WSL may
              exist at all belongs to whoever manages the machine. */}
          <DevicePolicyExport />
        </>
      )}

      {result && (
        <section className="sandbox-result" aria-label="What setting up did">
          {/* **Said, and said as a live region.** Setting up takes minutes and
              ends with a wall of a tool's own output; without a plain line at
              the top, "has it finished?" is answered by reading the whole thing
              and inferring. `role="status"` because it arrives after an action
              rather than being on the page all along.

              It reports the **set-up**, never the protection. What is actually
              in force is the table's business, and the table is re-read the
              moment this appears — so this line says a job ended, and the row
              beneath says what that bought. */}
          <p role="status" className={`sandbox-verdict ${result.succeeded ? "done" : "failed"}`}>
            {result.succeeded ? "Set up complete." : "Set up stopped."}
          </p>
          <p>{result.summary}</p>
          <ol>
            {result.steps.map((step) => (
              <li key={step.name} className={step.succeeded ? "done" : "failed"}>
                <span>
                  {step.name} — {step.succeeded ? "done" : "failed"}
                </span>
                {/* Whole, in the tool's own words. When a download fails or a
                    package is missing, this is the only thing naming it. */}
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
 *  read at all, and most of these verdicts are not reassuring. Each cell says
 *  what it is and why — "no boundary" and "no boundary *because your
 *  distribution mounts C:*" send somebody to very different next steps. Colour
 *  supports the words; it never replaces them. */
function Cell({ protection }: { protection: Protection | undefined }) {
  if (!protection) {
    return <td />;
  }
  const words: Record<Protection["state"], string> = {
    enforced: "In force",
    availableNotBuilt: "Could — not built yet",
    unavailable: "No",
  };
  return (
    <td className={`sandbox-cell ${protection.state}`}>
      <span className="verdict">{words[protection.state]}</span>
      <span className="hint">{protection.detail}</span>
    </td>
  );
}
