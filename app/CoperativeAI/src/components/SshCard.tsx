import { useCallback, useEffect, useState } from "react";
import { generateSshKey, sshStatus, testGithubSsh, type SshStatus } from "../lib/backend";

/** Setting up an SSH key for GitHub.
 *
 *  **The private key never leaves the machine and never reaches this screen.**
 *  `ssh-keygen` writes it to disk with the permissions ssh expects; everything
 *  here works with the public half. Same rule as the API keys and the GitHub
 *  token, and it matters more here — a leaked private key is push access to
 *  every repository the account can reach.
 *
 *  The key is added to GitHub by **you**, in GitHub's own settings. This app
 *  shows the public half and copies it; it does not reach into the account and
 *  add it, because changing the settings of somebody's GitHub account is not a
 *  thing a desktop tool should do quietly on their behalf. */
export default function SshCard() {
  const [status, setStatus] = useState<SshStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await sshStatus());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function generate() {
    setBusy(true);
    try {
      await generateSshKey("coperativeai");
      setNotice("Key made. Add the public half to GitHub, then test it.");
      setError(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      setNotice(await testGithubSsh());
      setError(null);
    } catch (e) {
      setNotice(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!status?.publicKey) return;
    try {
      await navigator.clipboard.writeText(status.publicKey);
      setNotice("Public key copied.");
    } catch {
      // Clipboard permission is not worth an alert — the key is on screen.
    }
  }

  return (
    <section className="develop-card" aria-label="SSH">
      <h2>SSH</h2>
      <p className="hint">
        An SSH key means git stops asking for a token on every push. The private
        half stays on this machine and is never shown here or stored by this
        app.
      </p>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {status && !status.canGenerate && (
        <p className="hint">
          <code>ssh-keygen</code> is not on this machine — install OpenSSH (it
          ships with Git for Windows) and reopen this.
        </p>
      )}

      {status && !status.hasKey && status.canGenerate && (
        <>
          <p className="hint">
            No key yet. This makes an ed25519 key at{" "}
            <code>{status.keyPath}</code> — its own name, so it can never
            replace a key you already rely on.
          </p>
          <p className="hint">
            It is made without a passphrase, because the app runs git commands
            itself and a passphrase it cannot supply would leave them waiting
            for input nobody can see.
          </p>
          <button onClick={generate} disabled={busy}>
            {busy ? "Making…" : "Make an SSH key"}
          </button>
        </>
      )}

      {status?.publicKey && (
        <>
          <p className="hint">
            Public key — add this to GitHub under Settings → SSH and GPG keys:
          </p>
          <pre className="ssh-public-key">{status.publicKey}</pre>
          <div className="ssh-actions">
            <button onClick={copy}>Copy</button>
            <button onClick={test} disabled={busy}>
              {busy ? "Testing…" : "Test against GitHub"}
            </button>
          </div>
          <p className="hint">
            A repository cloned over HTTPS keeps asking for a token however well
            the key is set up — switch its remote to SSH on the Solution itself.
          </p>
        </>
      )}
    </section>
  );
}
