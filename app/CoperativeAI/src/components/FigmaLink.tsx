import { useCallback, useEffect, useState } from "react";
import {
  clearFigmaToken,
  figmaStatus,
  setFigmaToken,
  type FigmaFile,
} from "../lib/backend";

/** Connecting a Figma account and pointing at a file.
 *
 *  The token goes to the OS credential store and is never returned, so this
 *  only ever knows whether one is stored — the same rule as the GitHub token
 *  and the AI keys.
 *
 *  What Figma's REST API allows is stated here rather than discovered through
 *  a failure: it cannot create frames on any plan, and design tokens need
 *  Enterprise. Saying so up front is cheaper than a 403 nobody can act on. */
export default function FigmaLink({
  fileRef,
  onFileRefChange,
  file,
  onRead,
  busy,
}: {
  fileRef: string;
  onFileRefChange: (value: string) => void;
  file: FigmaFile | null;
  onRead: () => void;
  busy: boolean;
}) {
  const [connected, setConnected] = useState(false);
  const [token, setToken] = useState("");
  const [account, setAccount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConnected((await figmaStatus()).connected);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onConnect() {
    try {
      setAccount(await setFigmaToken(token));
      setToken("");
      setError(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section className="figma-link" aria-label="Figma">
      <h3>Figma</h3>
      {error && <p role="alert">{error}</p>}

      {!connected ? (
        <div className="figma-connect">
          <p className="hint">
            A personal access token, kept in your operating system's credential
            store — never in this app's database or files.
          </p>
          <div className="field">
            <span>Personal access token</span>
            <input
              type="password"
              aria-label="Figma personal access token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <button
            aria-label="Connect Figma"
            disabled={token.trim() === ""}
            onClick={onConnect}
          >
            Connect
          </button>
        </div>
      ) : (
        <div className="figma-connected">
          <p role="status">
            Connected{account ? ` as ${account}` : ""}.
          </p>
          <button
            aria-label="Disconnect Figma"
            onClick={() =>
              void clearFigmaToken()
                .then(refresh)
                .catch((e) => setError(String(e)))
            }
          >
            Disconnect
          </button>
        </div>
      )}

      <div className="field">
        <span>File URL or key</span>
        <input
          aria-label="Figma file URL or key"
          value={fileRef}
          onChange={(e) => onFileRefChange(e.target.value)}
          placeholder="https://www.figma.com/design/…"
        />
      </div>
      <button
        aria-label="Read Figma file"
        disabled={!connected || busy || fileRef.trim() === ""}
        onClick={onRead}
      >
        Read the file
      </button>

      {file && (
        <div className="figma-digest">
          <p>
            <strong>{file.name}</strong> — {file.pages.length} page
            {file.pages.length === 1 ? "" : "s"}, {file.components.length} component
            {file.components.length === 1 ? "" : "s"}
          </p>
          <ul>
            {file.pages.map((page) => (
              <li key={page.name}>
                {page.name}: {page.frames.length} screen
                {page.frames.length === 1 ? "" : "s"}, {page.textCount} text
                {page.textTruncated && " (some left out)"}
              </li>
            ))}
          </ul>
          {/* The whole point of the digest is that a real file is far too big
              to send. Showing the size makes that visible before it is paid for. */}
          <p className="hint">
            The AI is sent a summary of about{" "}
            {Math.ceil(file.promptPreview.length / 4)} tokens, not the whole
            file.
          </p>
        </div>
      )}

      <p className="hint figma-limits">
        Figma's API can read this file and post comments on any plan. It{" "}
        <strong>cannot create frames or layouts</strong> — no plan allows that
        without a Figma plugin. Pushing design tokens as variables needs an{" "}
        <strong>Enterprise</strong> plan; on any other, export{" "}
        <code>design/tokens.json</code> and import it in Figma instead.
      </p>
    </section>
  );
}
