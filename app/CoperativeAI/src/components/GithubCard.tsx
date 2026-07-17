import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  githubStatus,
  removeGithubToken,
  setGithubToken,
} from "../lib/backend";

/** GitHub connection (Develop tab): a Personal Access Token held in the OS
 *  credential store, used to create/link repositories on Solutions. The token
 *  is entered once and never redisplayed. `onChange` lets the parent refresh
 *  the per-Solution repo controls when the connection state changes. */
export default function GithubCard({ onChange }: { onChange?: () => void }) {
  const [connected, setConnected] = useState(false);
  const [login, setLogin] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConnected((await githubStatus()).connected);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onConnect(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    try {
      const who = await setGithubToken(token);
      setToken(""); // the token leaves the form for the credential store
      setLogin(who);
      setConnected(true);
      setNotice(`Connected as ${who}`);
      setError(null);
      onChange?.();
    } catch (err) {
      setError(String(err));
    }
  }

  async function onDisconnect() {
    try {
      await removeGithubToken();
      setConnected(false);
      setLogin(null);
      setNotice(null);
      onChange?.();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <section className="develop-card" aria-label="GitHub">
      <h2>GitHub</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {connected ? (
        <div className="github-connected">
          <p>
            Connected{login ? ` as ${login}` : ""}. You can create or link
            repositories on any Solution below.
          </p>
          <button aria-label="Disconnect GitHub" onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
      ) : (
        <form onSubmit={onConnect} aria-label="Connect GitHub">
          <p className="hint">
            Paste a personal access token with <code>repo</code> scope. It is
            stored in your OS credential store, never in the project.
          </p>
          <input
            aria-label="GitHub token"
            type="password"
            placeholder="ghp_… (personal access token)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button type="submit">Connect</button>
        </form>
      )}
    </section>
  );
}
