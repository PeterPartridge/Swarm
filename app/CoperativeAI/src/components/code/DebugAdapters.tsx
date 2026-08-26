import { useState } from "react";
import TerminalPanel from "./TerminalPanel";
import { useDebuggers } from "../../lib/debuggers";
import { debugCheck, openDebuggerInstall, type AdapterCheck } from "../../lib/backend";

/** What this machine can debug, and what it is missing.
 *
 *  **Found by running, not by looking.** Every candidate adapter is executed
 *  before it is called available — a filename proves nothing, and on Windows
 *  the `python` on PATH is usually the Microsoft Store stub, which is a real
 *  file that prints an advert and exits.
 *
 *  **Check goes further**, and the difference matters: it starts the adapter
 *  and completes the DAP `initialize` handshake. A binary that runs is not
 *  necessarily one that speaks the protocol, and the breakpoint UI will rest on
 *  the second claim rather than the first.
 *
 *  Where an adapter is missing this says so and gives the one command that
 *  installs it, rather than offering a gutter that cannot honour a click. */
export default function DebugAdapters() {
  /// The one shared read, so installing something and pressing Look again
  /// updates this list and the run picker's verdicts together. This panel kept
  /// its own copy until the picker started refusing presses on the strength of
  /// the same facts — two lists, and the one on screen was not the one deciding.
  const { adapters: found, settled, recheck } = useDebuggers();
  const [checks, setChecks] = useState<Record<string, AdapterCheck>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /// The shell an install is running in, and which adapter it is for.
  ///
  /// **One at a time.** Two installs in two shells is not a thing anybody means
  /// to do, and the second would scroll the first out of sight — which is the
  /// half worth reading when one of them fails.
  const [installing, setInstalling] = useState<{ language: string; id: string } | null>(
    null,
  );
  const adapters = found ?? [];
  const loading = !settled;

  /// Opens a shell in the home folder with the install command already typed
  /// in. Nothing is run behind the panel: what ran is in the scrollback with
  /// its output, so a failed install can be read, corrected and tried again in
  /// place.
  async function install(language: string) {
    setBusy(language);
    try {
      const opened = await openDebuggerInstall(language);
      setInstalling({ language, id: opened.id });
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function check(language: string) {
    setBusy(language);
    try {
      const result = await debugCheck(language);
      setChecks((prev) => ({ ...prev, [language]: result }));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const ready = adapters.filter((a) => a.available).length;

  return (
    <section className="debug-adapters" aria-label="Debuggers">
      <header className="debug-head">
        <div>
          <strong>Debuggers</strong>
          <p className="hint">
            One adapter per language, over the Debug Adapter Protocol. Each is
            started to check it, because being on PATH proves nothing.
          </p>
        </div>
        {!loading && (
          <span className={ready > 0 ? "debug-count on" : "debug-count"}>
            {ready} of {adapters.length} installed
          </span>
        )}
        {/* The install commands below are run in a terminal somewhere else, so
            nothing here can be told one finished. Returning to the window
            re-reads on its own; this is for the case where it did not. */}
        <button
          type="button"
          aria-label="Look for the debuggers again"
          disabled={loading}
          onClick={recheck}
        >
          {loading ? "Looking…" : "Look again"}
        </button>
      </header>

      {error && <p role="alert">{error}</p>}
      {loading && <p className="hint">Looking…</p>}

      <ul className="adapter-list">
        {adapters.map((a) => {
          const result = checks[a.language];
          return (
            <li key={a.language} className={a.available ? "adapter on" : "adapter"}>
              <div className="adapter-head">
                <span
                  className={a.available ? "adapter-dot on" : "adapter-dot"}
                  aria-hidden="true"
                />
                <strong>{a.label}</strong>
                <span className="adapter-name">{a.adapter}</span>
                <span className="adapter-transport">{a.transport}</span>
                <span className="process-spacer" />
                {a.version && <span className="adapter-version">{a.version}</span>}
                <button
                  type="button"
                  aria-label={`Check the ${a.label} debugger`}
                  disabled={!a.available || busy === a.language}
                  onClick={() => check(a.language)}
                >
                  {busy === a.language ? "Talking…" : "Check"}
                </button>
              </div>

              {a.available ? (
                <p className="adapter-program card-mono">{a.program}</p>
              ) : (
                <>
                  <p className="hint">{a.problem}</p>
                  <p className="adapter-install card-mono">{a.install}</p>
                  {/* **Only where there is a command to run.** Two of the four
                      are a download and an unzip; a button that typed that
                      sentence at a shell would report `command not found` and
                      read as a broken app rather than a manual step. */}
                  {a.installCommand !== "" && installing?.language !== a.language && (
                    <button
                      type="button"
                      aria-label={`Install the ${a.label} debugger here`}
                      disabled={busy === a.language}
                      onClick={() => void install(a.language)}
                    >
                      {busy === a.language ? "Opening…" : "Install it here"}
                    </button>
                  )}
                </>
              )}

              {/* The install, in a real shell, with its output. Nothing is run
                  behind the panel — the same rule the sign-in and the starters
                  follow — so a failure can be read and tried again in place. */}
              {installing?.language === a.language && (
                <div className="adapter-install-shell">
                  <p className="hint">
                    Running <code>{a.installCommand}</code> below. When it
                    finishes, press{" "}
                    <button type="button" className="link" onClick={recheck}>
                      Look again
                    </button>{" "}
                    — this app cannot tell when a command in a shell is done, so
                    it does not pretend to.
                  </p>
                  <TerminalPanel
                    where="this machine"
                    adoptId={installing.id}
                    // The shell outlives this panel: an install part-way through
                    // must not be killed by looking at something else.
                    keepAlive
                  />
                  <button
                    type="button"
                    aria-label={`Hide the ${a.label} install terminal`}
                    onClick={() => setInstalling(null)}
                  >
                    Hide
                  </button>
                </div>
              )}

              {result && (
                <p
                  className={result.speaksDap ? "adapter-result ok" : "adapter-result bad"}
                  role="status"
                >
                  {result.speaksDap ? (
                    <>
                      Speaks DAP. Breakpoints{" "}
                      {result.conditionalBreakpoints ? "can carry conditions" : "are plain"}
                      {result.functionBreakpoints ? ", can be set on a function" : ""}
                      {result.logPoints ? ", can print instead of stopping" : ""}
                      {result.hitCounts ? ", and can count hits first" : ""}.{" "}
                      {/* The absences are the useful half: this app offers all
                          three on every breakpoint, and an adapter that cannot
                          do one holds that breakpoint back rather than arming a
                          different one. Saying so here beats finding out on
                          starting. */}
                      {(!result.logPoints || !result.hitCounts) && (
                        <em>
                          No{" "}
                          {[
                            !result.logPoints ? "log points" : "",
                            !result.hitCounts ? "hit counts" : "",
                          ]
                            .filter(Boolean)
                            .join(" or ")}
                          , so a breakpoint using that is held back rather than armed plain.
                        </em>
                      )}
                    </>
                  ) : (
                    <>It started but did not complete the handshake: {result.problem}</>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <p className="hint">
        Setting breakpoints and stepping are the next piece. The protocol client
        and this search are built and tested; the gutter stays unclickable until
        it can honour a click.
      </p>
    </section>
  );
}
