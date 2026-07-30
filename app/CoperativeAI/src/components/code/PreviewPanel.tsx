import { useCallback, useEffect, useRef, useState } from "react";

/** Where a dev server is *probably* listening, given the command that starts it.
 *
 *  A guess, and labelled as one everywhere it is shown. The Solution's run
 *  command is detected from what is in the folder, not from a config that states
 *  a port, so the app genuinely does not know — and a URL presented as fact
 *  would send people hunting a bug in their server when the guess was simply
 *  wrong. First match wins; the ports are each framework's own default. */
export function guessDevUrl(runCommand: string): string {
  const command = runCommand.toLowerCase();
  const guesses: [RegExp, number][] = [
    [/\bnext\b/, 3000],
    [/\bnuxt\b/, 3000],
    [/\bvite\b|\bnpm run dev\b|\bpnpm dev\b|\byarn dev\b/, 5173],
    [/\bng serve\b/, 4200],
    [/\bdotnet\b/, 5000],
    [/\brails\b/, 3000],
    [/\bdjango\b|manage\.py runserver/, 8000],
    [/\bflask\b/, 5000],
    [/\buvicorn\b|\bfastapi\b/, 8000],
    [/\bcargo\b|\bair\b|\bgo run\b/, 8080],
  ];
  const match = guesses.find(([pattern]) => pattern.test(command));
  return `http://localhost:${match ? match[1] : 3000}`;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** One header line in the API caller. */
interface HeaderLine {
  name: string;
  value: string;
}

/** What came back from a call: enough to tell a 500 from a 200 with bad data. */
interface ApiResult {
  status: number;
  statusText: string;
  /** Milliseconds, because "is it slow?" is usually the next question. */
  elapsedMs: number;
  body: string;
  headers: HeaderLine[];
}

/** Parses `Name: value` lines into headers, ignoring blanks.
 *
 *  A textarea rather than a row of paired inputs: headers are usually pasted
 *  from documentation or a curl command, and pasting into one box beats typing
 *  into six. */
export function parseHeaders(text: string): HeaderLine[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && line.includes(":"))
    .map((line) => {
      const at = line.indexOf(":");
      return {
        name: line.slice(0, at).trim(),
        value: line.slice(at + 1).trim(),
      };
    })
    .filter((h) => h.name !== "");
}

/** Pretty-prints JSON, and leaves anything else exactly as it arrived.
 *
 *  Reformatting non-JSON would corrupt it — an HTML error page or a stack trace
 *  is most useful verbatim. */
export function formatBody(body: string, contentType: string): string {
  if (!contentType.includes("json")) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    // A truncated or malformed JSON response is itself the finding.
    return body;
  }
}

/** The output half of an agent's sub-panels: look at what it built.
 *
 *  Two modes, because "show me the app" and "show me the API" are different
 *  questions and a browser answers only the first. **App** frames the running
 *  dev server, so a front end is watched in place instead of in another window.
 *  **API** is a request builder — method, URL, headers, body — for the Solutions
 *  that have no page to look at, where the only way to see the change is to call
 *  it.
 *
 *  The URL is seeded from a guess and then remembered per Solution, because the
 *  guess is wrong often enough that correcting it every time would be the
 *  panel's most-used feature. */
export default function PreviewPanel({
  solutionId,
  runCommand,
  label,
}: {
  solutionId: number;
  /** The Solution's detected or overridden run command — only ever used to
   *  narrow the port guess. */
  runCommand: string;
  /** Names what is being previewed, for the region label. */
  label: string;
}) {
  const storageKey = `coperativeai.preview.${solutionId}`;
  const [mode, setMode] = useState<"app" | "api">("app");
  const [url, setUrl] = useState("");
  /** Bumped to force the iframe to reload the same URL — React will not
   *  re-render an unchanged src, and "it should have picked up my change" is the
   *  most common reason to press Reload. */
  const [reloads, setReloads] = useState(0);
  const guessed = useRef(false);

  const [method, setMethod] = useState<(typeof METHODS)[number]>("GET");
  const [apiPath, setApiPath] = useState("/");
  const [headerText, setHeaderText] = useState("");
  const [requestBody, setRequestBody] = useState("");
  const [result, setResult] = useState<ApiResult | null>(null);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      setUrl(saved);
      guessed.current = false;
      return;
    }
    setUrl(guessDevUrl(runCommand));
    guessed.current = true;
  }, [storageKey, runCommand]);

  const remember = useCallback(
    (next: string) => {
      setUrl(next);
      guessed.current = false;
      // Only a corrected URL is worth keeping; storing the guess would make it
      // look like a decision somebody made.
      if (next.trim() !== "") localStorage.setItem(storageKey, next.trim());
    },
    [storageKey],
  );

  async function call() {
    setCalling(true);
    setError(null);
    const base = url.trim().replace(/\/$/, "");
    const target = `${base}${apiPath.startsWith("/") ? "" : "/"}${apiPath}`;
    const started = performance.now();
    try {
      const headers = parseHeaders(headerText);
      const response = await fetch(target, {
        method,
        headers: Object.fromEntries(headers.map((h) => [h.name, h.value])),
        // GET and DELETE with a body are rejected by fetch itself.
        body: method === "GET" || method === "DELETE" ? undefined : requestBody,
      });
      const text = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      setResult({
        status: response.status,
        statusText: response.statusText,
        elapsedMs: Math.round(performance.now() - started),
        body: formatBody(text, contentType),
        headers: [...response.headers.entries()].map(([name, value]) => ({ name, value })),
      });
    } catch (e) {
      // A failed fetch here almost always means nothing is listening, which is a
      // different problem from a 500 — so it is said differently.
      setError(
        `Could not reach ${target} — ${String(e)}. If the app is not started yet, start it from the run's terminal first.`,
      );
      setResult(null);
    } finally {
      setCalling(false);
    }
  }

  return (
    <section className="preview-panel" aria-label={`Preview of ${label}`}>
      <div className="preview-controls">
        <div role="tablist" aria-label="Preview mode">
          <button
            role="tab"
            aria-selected={mode === "app"}
            className={mode === "app" ? "view-active" : ""}
            onClick={() => setMode("app")}
          >
            App
          </button>
          <button
            role="tab"
            aria-selected={mode === "api"}
            className={mode === "api" ? "view-active" : ""}
            onClick={() => setMode("api")}
          >
            API
          </button>
        </div>

        <label className="preview-url">
          Address
          <input
            aria-label="Preview address"
            value={url}
            placeholder="http://localhost:5173"
            onChange={(e) => remember(e.target.value)}
          />
        </label>

        {mode === "app" && (
          <button aria-label="Reload the preview" onClick={() => setReloads((n) => n + 1)}>
            Reload
          </button>
        )}
      </div>

      {/* Said plainly, once, while it is still a guess: the app reads the run
          command to pick a port, it does not know one. */}
      {guessed.current && (
        <p className="hint">
          Guessed from the run command — correct it if the server is elsewhere,
          and it will be remembered for this Solution.
        </p>
      )}

      {mode === "app" ? (
        url.trim() === "" ? (
          <p className="hint">Give an address above to frame the running app.</p>
        ) : (
          <iframe
            key={`${url}-${reloads}`}
            className="preview-frame"
            title={`Running app for ${label}`}
            src={url}
          />
        )
      ) : (
        <div className="api-caller">
          <div className="api-request-line">
            <label>
              Method
              <select
                aria-label="Request method"
                value={method}
                onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="api-path">
              Path
              <input
                aria-label="Request path"
                value={apiPath}
                placeholder="/api/health"
                onChange={(e) => setApiPath(e.target.value)}
              />
            </label>
            <button
              aria-label="Send the request"
              disabled={calling || url.trim() === ""}
              onClick={call}
            >
              {calling ? "Sending…" : "Send"}
            </button>
          </div>

          <label className="api-headers">
            Headers — one per line, <code>Name: value</code>
            <textarea
              aria-label="Request headers"
              rows={3}
              value={headerText}
              placeholder={"Content-Type: application/json"}
              onChange={(e) => setHeaderText(e.target.value)}
            />
          </label>

          {method !== "GET" && method !== "DELETE" && (
            <label className="api-body">
              Body
              <textarea
                aria-label="Request body"
                rows={5}
                value={requestBody}
                placeholder={'{ "name": "value" }'}
                onChange={(e) => setRequestBody(e.target.value)}
              />
            </label>
          )}

          {error && <p role="alert">{error}</p>}

          {result && (
            <div className="api-result">
              {/* The status is the headline, and the class carries the colour so
                  a 500 is not read as a success at a glance. */}
              <p
                role="status"
                className={`api-status ${result.status < 400 ? "ok" : "bad"}`}
              >
                {result.status} {result.statusText} — {result.elapsedMs} ms
              </p>
              <pre className="api-response" aria-label="Response body">
                {result.body === "" ? "(empty response)" : result.body}
              </pre>
              <details>
                <summary>Response headers ({result.headers.length})</summary>
                <ul className="api-response-headers">
                  {result.headers.map((h) => (
                    <li key={h.name}>
                      <code>{h.name}</code>: {h.value}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
