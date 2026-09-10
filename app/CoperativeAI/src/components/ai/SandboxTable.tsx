import { useCallback, useEffect, useState } from "react";
import {
  sandboxReport,
  type Protection,
  type SandboxReport,
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
 *  **There is no picker here yet, deliberately.** Neither sandbox runs anything
 *  — both refuse rather than quietly run a command outside the boundary that
 *  was asked for — so offering the choice today would be offering a way to stop
 *  the terminal working. The choice arrives with the first backend that can
 *  honour it.
 *
 *  Detection runs external tools, so it happens once when the panel opens and
 *  again only when somebody asks. Nothing is remembered between looks: the
 *  configuration underneath can be changed outside this app. */
export default function SandboxTable() {
  const [report, setReport] = useState<SandboxReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
                  {mode.id === report.chosen && <span className="badge">chosen</span>}
                  <span className="hint">{mode.summary}</span>
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
