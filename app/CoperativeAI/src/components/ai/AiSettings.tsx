import SectionTabs from "../common/SectionTabs";
import ClaudeTiers from "./ClaudeTiers";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  addAiProvider,
  addClaudeCodeProvider,
  addOllamaCloudProvider,
  addOllamaProvider,
  listAiProviders,
  removeAiProvider,
  testAiProvider,
  DEFAULT_OLLAMA_URL,
  DEFAULT_PROVIDER,
  type AiProvider,
} from "../../lib/backend";

/** AI Settings (Develop tab): providers with keys held in the OS credential
 *  store. The key is collected once and never redisplayed. */
export default function AiSettings() {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState(DEFAULT_PROVIDER.name);
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_PROVIDER.apiBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [ollamaName, setOllamaName] = useState("Ollama (local)");
  const [ollamaUrl, setOllamaUrl] = useState(DEFAULT_OLLAMA_URL);
  const [cloudName, setCloudName] = useState("Ollama Cloud");
  const [cloudUrl, setCloudUrl] = useState("https://ollama.com");
  const [cloudKey, setCloudKey] = useState("");
  const [cliName, setCliName] = useState("Claude Code (my plan)");
  const [cliExe, setCliExe] = useState("");
  /// Which provider family is showing. Claude and Ollama are different
  /// purchases with different setup, and one page of four forms made you read
  /// all of them to find the one you wanted.
  const [family, setFamily] = useState<"claude" | "ollama">("claude");

  const refresh = useCallback(async () => {
    try {
      setProviders(await listAiProviders());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !apiBaseUrl.trim() || !apiKey.trim()) return;
    try {
      await addAiProvider({
        name,
        apiBaseUrl,
        apiKey,
      });
      setApiKey(""); // the key leaves the form for the credential store
      setNotice(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function onAddOllama(e: FormEvent) {
    e.preventDefault();
    if (!ollamaName.trim() || !ollamaUrl.trim()) return;
    try {
      await addOllamaProvider(ollamaName, ollamaUrl);
      setNotice(null);
      setError(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function onAddOllamaCloud(e: FormEvent) {
    e.preventDefault();
    if (!cloudName.trim() || !cloudUrl.trim() || !cloudKey.trim()) return;
    try {
      await addOllamaCloudProvider(cloudName, cloudUrl, cloudKey);
      setCloudKey(""); // the key leaves the form for the credential store
      setNotice(null);
      setError(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function onAddClaudeCode(e: FormEvent) {
    e.preventDefault();
    if (!cliName.trim()) return;
    try {
      await addClaudeCodeProvider(cliName, cliExe);
      setNotice(null);
      setError(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function onTest(provider: AiProvider) {
    setNotice(null);
    try {
      setNotice(await testAiProvider(provider.id));
    } catch (err) {
      setNotice(String(err));
    }
  }

  async function onRemove(provider: AiProvider) {
    try {
      await removeAiProvider(provider.id);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <section className="develop-card" aria-label="AI Settings">
      <h2>AI Settings</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {/* Two families, two tabs. Claude and Ollama are different purchases
          with different setup, and one page of four forms made you read all
          of them to find the one you wanted. */}
      <SectionTabs
        label="Provider family"
        options={[
          { id: "claude", label: "Claude" },
          { id: "ollama", label: "Ollama" },
        ]}
        active={family}
        onSelect={(id) => setFamily(id as "claude" | "ollama")}
      />

      {family === "claude" && (
        <>
      <ClaudeTiers />
      <form onSubmit={onAdd} aria-label="Add AI provider">
        <input
          aria-label="Provider name"
          placeholder="Provider name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          aria-label="API base URL"
          placeholder="https://api.anthropic.com"
          value={apiBaseUrl}
          onChange={(e) => setApiBaseUrl(e.target.value)}
        />
        <input
          aria-label="API key"
          type="password"
          placeholder="API key (stored in the OS credential store)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <button type="submit">Add provider</button>
      </form>

      <form onSubmit={onAddClaudeCode} aria-label="Add Claude Code provider">
        <p className="hint">
          Or use <strong>Claude Code on this machine</strong>, signed in with your
          own Claude subscription. A Pro or Max plan covers the CLI but{" "}
          <strong>not</strong> the API above — that bills separate API credits
          against a key — so this is the way to use Claude with a plan and no
          credits. No key is asked for, and no spend is recorded against a budget:
          your plan's allowance is charged where this app cannot see it, and a
          figure it invented would be worse than none.
        </p>
        <input
          aria-label="Claude Code provider name"
          placeholder="Claude Code (my plan)"
          value={cliName}
          onChange={(e) => setCliName(e.target.value)}
        />
        <input
          aria-label="Claude Code executable"
          placeholder="claude — or a full path if it is not on PATH"
          value={cliExe}
          onChange={(e) => setCliExe(e.target.value)}
        />
        <button type="submit">Add Claude Code</button>
      </form>

        </>
      )}

      {family === "ollama" && (
        <>
      <form onSubmit={onAddOllama} aria-label="Add local Ollama provider">
        <p className="hint">
          A <strong>local Ollama</strong> server — no key, no cost. Put it
          last in a Product's provider order and work carries on after the AI
          budget runs out.
        </p>
        <input
          aria-label="Ollama provider name"
          placeholder="Ollama (local)"
          value={ollamaName}
          onChange={(e) => setOllamaName(e.target.value)}
        />
        <input
          aria-label="Ollama base URL"
          placeholder={DEFAULT_OLLAMA_URL}
          value={ollamaUrl}
          onChange={(e) => setOllamaUrl(e.target.value)}
        />
        <button type="submit">Add Ollama</button>
      </form>

      {/* Hosted Ollama. Its own form rather than a checkbox on the one above,
          because the difference that matters is not the URL — it is that this
          one costs money and that one does not. */}
      <form onSubmit={onAddOllamaCloud} aria-label="Add hosted Ollama provider">
        <p className="hint">
          <strong>Ollama's hosted service</strong> — bigger models than
          this machine can run. It is <strong>metered</strong>: it goes through
          the same budget and ledger as Claude, because it is someone else's
          hardware being paid for. Any free allowance on your account is not
          tracked here — no API reports how much of one is left, so counting from
          the first call overstates spend rather than letting a budget silently
          do nothing.
        </p>
        <input
          aria-label="Hosted Ollama provider name"
          placeholder="Ollama Cloud"
          value={cloudName}
          onChange={(e) => setCloudName(e.target.value)}
        />
        <input
          aria-label="Hosted Ollama base URL"
          placeholder="https://ollama.com"
          value={cloudUrl}
          onChange={(e) => setCloudUrl(e.target.value)}
        />
        <input
          aria-label="Hosted Ollama API key"
          type="password"
          placeholder="API key (stored in the OS credential store)"
          value={cloudKey}
          onChange={(e) => setCloudKey(e.target.value)}
        />
        <button type="submit">Add hosted Ollama</button>
      </form>

      {/* The subscription path. Worth its own form and its own explanation,
          because "I have Claude Pro" and "I have API credits" are different
          purchases and the form above quietly assumes the second one. */}
        </>
      )}

      <ul>
        {providers.map((p) => (
          <li key={p.id}>
            {/* "free" would be a lie for Claude Code — the plan is paid for, the
                allowance is finite, and this app simply cannot see the cost.
                Saying so is the honest third state between metered and free. */}
            <strong>{p.name}</strong> (
            {p.kind === "claudeCode"
              ? "on your plan — cost not visible here"
              : p.metered
                ? "metered"
                : "free"}
            ) — {p.kind === "claudeCode" ? p.apiBaseUrl || "claude" : p.apiBaseUrl} — models:{" "}
            {p.models.join(", ") || "none"} —{" "}
            {p.kind === "ollama"
              ? // Both kinds of Ollama live here now, told apart by whether a key
                // was stored — the same signal the backend authenticates on, so
                // this line cannot drift from what actually gets sent.
                p.keyStored
                ? "hosted, key stored"
                : "local, no key"
              : p.kind === "claudeCode"
                ? "signed in through the CLI, no key"
                : `key: ${p.keyStored ? "stored" : "not stored"}`}{" "}
            <button aria-label={`Test ${p.name}`} onClick={() => onTest(p)}>
              Test
            </button>{" "}
            <button aria-label={`Remove provider ${p.name}`} onClick={() => onRemove(p)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
