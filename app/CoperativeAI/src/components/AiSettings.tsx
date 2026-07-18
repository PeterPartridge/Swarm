import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  addAiProvider,
  addOllamaProvider,
  listAiProviders,
  removeAiProvider,
  testAiProvider,
  DEFAULT_OLLAMA_URL,
  DEFAULT_PROVIDER,
  type AiProvider,
} from "../lib/backend";

/** AI Settings (Develop tab): providers with keys held in the OS credential
 *  store. The key is collected once and never redisplayed. */
export default function AiSettings() {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState(DEFAULT_PROVIDER.name);
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_PROVIDER.apiBaseUrl);
  const [models, setModels] = useState(DEFAULT_PROVIDER.models);
  const [apiKey, setApiKey] = useState("");
  const [ollamaName, setOllamaName] = useState("Ollama (local)");
  const [ollamaUrl, setOllamaUrl] = useState(DEFAULT_OLLAMA_URL);

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
        models: models
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean),
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
          aria-label="Models (comma separated)"
          placeholder="claude-haiku-4-5, claude-sonnet-5, claude-opus-4-8"
          value={models}
          onChange={(e) => setModels(e.target.value)}
        />
        <p className="hint">
          List models <strong>cheapest first</strong>. A work item's effort tier
          picks from this order — low uses the first, high the last — so the
          ordering decides what each task costs.
        </p>
        <input
          aria-label="API key"
          type="password"
          placeholder="API key (stored in the OS credential store)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <button type="submit">Add provider</button>
      </form>

      <form onSubmit={onAddOllama} aria-label="Add local Ollama provider">
        <p className="hint">
          Or add a <strong>local Ollama</strong> server — no key, no cost. Put it
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

      <ul>
        {providers.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong> ({p.metered ? "metered" : "free"}) —{" "}
            {p.apiBaseUrl} — models: {p.models.join(", ") || "none"} —{" "}
            {p.kind === "ollama" ? "local, no key" : `key: ${p.keyStored ? "stored" : "not stored"}`}{" "}
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
