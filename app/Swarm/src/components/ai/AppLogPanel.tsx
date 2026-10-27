import { useCallback, useEffect, useState } from "react";
import {
  appBuild,
  clearAppLog,
  listAppLog,
  type BuildInfo,
  type LogEntry,
} from "../../lib/backend";

/** What the app did, in order — the trail for "nothing happened".
 *
 *  **Because the two halves of a press are logged in different places.** The
 *  screen knows what was clicked and what came back; the commands know what
 *  they decided. A press that was refused before it reached a command — a guard
 *  that returned early, a gate that said no — wrote nothing anywhere until
 *  this existed, and the only honest answer to "why did Execute do nothing?"
 *  was to guess.
 *
 *  Newest first, because the question is always about the last thing. Times are
 *  full timestamps rather than "2 minutes ago": this is read while comparing it
 *  against what somebody remembers doing, and a relative time makes that
 *  arithmetic. */
export default function AppLogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loaded, info] = await Promise.all([listAppLog(200), appBuild()]);
      setEntries(loaded);
      setBuild(info);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="app-log" aria-label="Activity log">
      <header className="app-log-head">
        <div>
          <h3>Activity log</h3>
          <p className="hint">
            What the app did, newest first — every press, and what each command
            decided. The last 500 lines; nothing sensitive, and no prompts.
          </p>
          {/* **Which build is running, where somebody is already looking when
              something did not work.** An installed app and a rebuilt one are
              two binaries on one machine; without this, "it does nothing" and
              "that fix is not in this copy" look exactly the same. */}
          {build && (
            <p className="hint app-build">
              Running version {build.version}, built{" "}
              {build.builtAt > 0
                ? new Date(build.builtAt).toLocaleString()
                : "at an unknown time"}
              .
            </p>
          )}
        </div>
        <span className="row-actions">
          <button onClick={() => void refresh()}>Refresh</button>
          <button
            onClick={() =>
              void clearAppLog()
                .then(refresh)
                .catch((e: unknown) => setError(String(e)))
            }
          >
            Clear
          </button>
        </span>
      </header>

      {error && <p role="alert">{error}</p>}

      {entries.length === 0 ? (
        <p className="hint">
          Nothing logged yet. Press something and it appears here.
        </p>
      ) : (
        <ul className="app-log-list" aria-label="Log entries">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="app-log-when">
                {new Date(e.at).toLocaleString()}
              </span>
              <span className="app-log-area">{e.area}</span>
              <span className="app-log-message">{e.message}</span>
              {/* The long half, kept because it is usually the answer: an
                  error, a path, the reason a gate said no. */}
              {e.detail && <span className="app-log-detail">{e.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
