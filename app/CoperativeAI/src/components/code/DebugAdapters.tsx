import { useCallback, useEffect, useState } from "react";
import {
  debugAdapters,
  debugCheck,
  type AdapterCheck,
  type AdapterStatus,
} from "../../lib/backend";

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
  const [adapters, setAdapters] = useState<AdapterStatus[]>([]);
  const [checks, setChecks] = useState<Record<string, AdapterCheck>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setAdapters(await debugAdapters());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
                </>
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
                      {result.functionBreakpoints ? ", and can be set on a function" : ""}.
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
