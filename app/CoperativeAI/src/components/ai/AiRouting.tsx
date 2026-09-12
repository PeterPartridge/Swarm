import { useCallback, useEffect, useState } from "react";
import {
  clearAreaProvider,
  getAiRouting,
  setAreaProvider,
  type AreaProvider,
} from "../../lib/backend";

/** Which AI runs each area's work: a Main and an optional Secondary, per area.
 *
 *  **Two slots, three areas, one shape.** Saying what a provider is *for* is
 *  the thing somebody actually wants to set, and the flat list of providers
 *  never answered it — the routing table has existed for a while with nothing
 *  writing to it, which is why "I can't select a model" was a true statement
 *  about an app that already had a table for the answer.
 *
 *  **Secondary assumes nothing.** Every area starts with none, and nothing here
 *  implies one is missing. Its two jobs are the ones Main cannot do for itself:
 *  peer-reviewing a change, and carrying on when Main runs out of budget. */

const SLOTS = [
  {
    id: "main",
    label: "Main AI",
    blurb: "Does the work. The effort level on a work item picks which of its models runs a job.",
  },
  {
    id: "secondary",
    label: "Secondary AI",
    blurb:
      "Optional, and empty until you set it. It peer-reviews changes and carries on when the Main one runs out of budget.",
  },
] as const;

/** `test` is what the column has always held; the page says QA. */
const AREAS = [
  { id: "product", label: "Product" },
  { id: "develop", label: "Develop" },
  { id: "test", label: "QA" },
] as const;

const PLATFORMS = [
  { id: "none", label: "Not set" },
  { id: "claudeCode", label: "Claude Code (my plan)" },
  { id: "ollamaLocal", label: "Ollama — local" },
  { id: "ollamaCloud", label: "Ollama — hosted" },
] as const;

/** What each platform needs, and what it costs.
 *
 *  **Three options rather than two, because "Ollama" is two decisions.** A
 *  local server costs nothing and needs an address; the hosted one costs money
 *  and needs a key. One option for both would hide the only difference that
 *  matters, which is the bill. */
const NEEDS: Record<string, { url: boolean; key: boolean; metered: boolean; note: string }> = {
  claudeCode: {
    url: false,
    key: false,
    metered: false,
    note: "Uses the plan you are signed in to. Nothing to fill in, and no API spend.",
  },
  ollamaLocal: {
    url: true,
    key: false,
    metered: false,
    note: "A server on this machine — no key, no cost. Work carries on after an AI budget runs out.",
  },
  ollamaCloud: {
    url: true,
    key: true,
    metered: true,
    note: "Ollama's hosted service — bigger models than this machine can run. It is metered: it goes through the same budget and ledger as Claude.",
  },
};

const DEFAULT_URL: Record<string, string> = {
  ollamaLocal: "http://localhost:11434",
  ollamaCloud: "https://ollama.com",
};

export default function AiRouting({ productId }: { productId: number | null }) {
  const [cells, setCells] = useState<AreaProvider[]>([]);
  const [slot, setSlot] = useState<string>("main");
  const [area, setArea] = useState<string>("develop");
  const [platform, setPlatform] = useState<string>("none");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const current = cells.find((c) => c.area === area && c.slot === slot) ?? null;

  const load = useCallback(async () => {
    if (productId === null) return;
    try {
      setCells(await getAiRouting(productId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The form follows the cell being looked at, so switching tabs shows what is
  // actually set rather than whatever was last typed somewhere else.
  useEffect(() => {
    const cell = cells.find((c) => c.area === area && c.slot === slot);
    setPlatform(cell?.platform ?? "none");
    setUrl(cell?.apiBaseUrl ?? "");
    setKey("");
    setNotice("");
    setError(null);
  }, [area, slot, cells]);

  function pick(next: string) {
    setPlatform(next);
    // Prefilled only when moving to a platform that wants one, and only when
    // the field is empty — so it never overwrites an address somebody typed.
    if (DEFAULT_URL[next] && !url) setUrl(DEFAULT_URL[next]);
    setNotice("");
    setError(null);
  }

  async function save() {
    if (productId === null) return;
    setBusy("save");
    try {
      await setAreaProvider(productId, area, slot, platform, url, key);
      setKey("");
      setNotice("Saved.");
      setError(null);
      await load();
    } catch (e) {
      // The refusal is the useful part: the address and key are checked
      // against the real server before anything is stored.
      setError(String(e));
      setNotice("");
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    if (productId === null) return;
    setBusy("clear");
    try {
      await clearAreaProvider(productId, area, slot);
      setNotice("Cleared.");
      setError(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }

  if (productId === null) {
    return (
      <section className="admin-card" aria-label="Which AI runs each area">
        <h3>Which AI runs each area</h3>
        <p className="hint">Choose a Product above to set this.</p>
      </section>
    );
  }

  const needs = NEEDS[platform];
  const slotInfo = SLOTS.find((s) => s.id === slot);

  return (
    <section className="admin-card ai-routing" aria-label="Which AI runs each area">
      <h3>Which AI runs each area</h3>
      <p className="hint">
        This says what is <em>available</em> per area. Which of its models runs a
        particular job is decided by the <strong>effort level on the work item</strong>.
      </p>

      {error && <p role="alert">{error}</p>}

      <div className="routing-tabs" role="tablist" aria-label="AI slot">
        {SLOTS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={slot === s.id}
            className={slot === s.id ? "tab here" : "tab"}
            onClick={() => setSlot(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="hint">{slotInfo?.blurb}</p>

      <div className="routing-tabs areas" role="tablist" aria-label="Area">
        {AREAS.map((a) => {
          const cell = cells.find((c) => c.area === a.id && c.slot === slot);
          return (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={area === a.id}
              className={area === a.id ? "tab here" : "tab"}
              onClick={() => setArea(a.id)}
            >
              {a.label}
              {/* Words, not a dot: "set" and "not set" are the two states
                  somebody is looking for, and a symbol is read as reassurance
                  before it is read at all. */}
              <span className="tab-state">
                {cell && cell.platform !== "none" ? "set" : "not set"}
              </span>
            </button>
          );
        })}
      </div>

      <label>
        Platform
        <select value={platform} onChange={(e) => pick(e.target.value)}>
          {PLATFORMS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {needs && <p className="hint">{needs.note}</p>}

      {needs?.url && (
        <label>
          Address
          <input
            type="text"
            value={url}
            placeholder={DEFAULT_URL[platform] ?? ""}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
      )}

      {needs?.key && (
        <label>
          API key
          <input
            type="password"
            value={key}
            placeholder={current?.providerId ? "stored — type to replace" : "required"}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
      )}

      <div className="routing-actions">
        <button
          type="button"
          onClick={() => void save()}
          disabled={platform === "none" || busy !== ""}
        >
          {busy === "save" ? "Checking…" : "Save"}
        </button>
        {/* Offered only when there is something to clear, so the button is
            never a no-op somebody presses twice wondering what happened. */}
        {current && current.platform !== "none" && (
          <button type="button" onClick={() => void remove()} disabled={busy !== ""}>
            {busy === "clear" ? "Clearing…" : "Clear this one"}
          </button>
        )}
        {notice && <span className="hint">{notice}</span>}
      </div>

      {current && current.platform !== "none" ? (
        <p className="hint">
          Currently <strong>{current.providerName}</strong>
          {current.apiBaseUrl && <> at {current.apiBaseUrl}</>} —{" "}
          {current.metered ? "metered, so it spends from the budget" : "not metered"}.{" "}
          {current.models.length} model{current.models.length === 1 ? "" : "s"} available.
        </p>
      ) : (
        <p className="hint">
          {slot === "secondary"
            ? "No Secondary for this area. Reviews will not happen for it, and there is nothing to fall back to when the budget runs out."
            : "Nothing set for this area, so its AI work has no provider to use."}
        </p>
      )}
    </section>
  );
}
