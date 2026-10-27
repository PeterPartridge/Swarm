import { useCallback, useEffect, useState } from "react";
import {
  getClaudeTiers,
  setClaudeTiers,
  type ClaudeTier,
} from "../../lib/backend";
import {
  CLAUDE_MODELS,
  EFFORT_TIERS,
  OTHER_MODEL,
  effortsFor,
} from "../../lib/models";

/** What Claude does for each size of job.
 *
 *  **One setting, both ways of paying.** The API and a plan reach the same
 *  models, so asking for the choice in each provider's form invited them to
 *  drift — and "high complexity" meaning one thing through the API and another
 *  through the plan is a difference nobody wants and no one would notice until
 *  a bill or a bad plan turned up.
 *
 *  **Two choices per row, because they are two decisions.** The work item's
 *  author says how hard the job is; this page says what to do about it — which
 *  model, and how hard it thinks. They used to be one word, which meant "high"
 *  picked the last model in a list and nothing else, with no way to say "use
 *  the big model but do not labour over it".
 *
 *  Saves on change. There is no Save button because there is nothing to batch:
 *  each row is one setting, and a page that silently discarded a choice because
 *  a button was missed would be worse than one that keeps it. */
export default function ClaudeTiers() {
  const [tiers, setTiers] = useState<ClaudeTier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /// Which rows are typing a model rather than picking one. Held here so a
  /// half-typed name does not flip the control back on every keystroke.
  const [typing, setTyping] = useState<Record<number, boolean>>({});

  const refresh = useCallback(async () => {
    try {
      setTiers(await getClaudeTiers());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(next: ClaudeTier[]) {
    // Shown before the round trip, so the control never lags the click. A
    // failure puts it back from the database rather than leaving a choice on
    // screen that was not kept.
    setTiers(next);
    try {
      await setClaudeTiers(next);
      setNotice("Saved.");
      setError(null);
    } catch (e) {
      // Reload *first*, then say what went wrong: `refresh` clears the error on
      // success, so setting it beforehand made the failure vanish the instant
      // it appeared — the control went back and said nothing about why.
      await refresh();
      setError(String(e));
      setNotice(null);
    }
  }

  if (!tiers) {
    return (
      <section className="develop-card" aria-label="Claude complexity">
        {error ? <p role="alert">{error}</p> : <p className="hint">Loading…</p>}
      </section>
    );
  }

  const known = (model: string) => CLAUDE_MODELS.some((m) => m.id === model);

  return (
    <section className="develop-card claude-tiers" aria-label="Claude complexity">
      <h3>Complexity</h3>
      <p className="hint">
        A work item says how hard its job is; this says what Claude does about
        it. The same for both ways of paying — the API and your plan reach the
        same models.
      </p>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {tiers.map((tier, index) => {
        const meta = EFFORT_TIERS[index];
        const isTyping = typing[index] || !known(tier.model);
        const chosen = CLAUDE_MODELS.find((m) => m.id === tier.model);
        const efforts = effortsFor(tier.model);
        const set = (change: Partial<ClaudeTier>) =>
          void save(tiers.map((t, i) => (i === index ? { ...t, ...change } : t)));

        return (
          <div key={meta.id} className="claude-tier">
            <strong>{meta.label.replace(" effort", "")} complexity</strong>
            <p className="hint">{meta.forWhat}</p>

            <div className="claude-tier-choices">
              <label>
                Model
                {isTyping ? (
                  <input
                    aria-label={`${meta.id} complexity model`}
                    placeholder="claude-opus-5"
                    value={tier.model}
                    onChange={(e) => set({ model: e.target.value })}
                  />
                ) : (
                  <select
                    aria-label={`${meta.id} complexity model`}
                    value={tier.model}
                    onChange={(e) => {
                      if (e.target.value === OTHER_MODEL) {
                        setTyping({ ...typing, [index]: true });
                        return;
                      }
                      set({ model: e.target.value });
                    }}
                  >
                    {CLAUDE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                    {/* The list is one somebody maintains, so a model released
                        after it was written must still be reachable. */}
                    <option value={OTHER_MODEL}>Other — type a model name…</option>
                  </select>
                )}
              </label>

              <label>
                Effort
                {/* Offered per model, because support is not uniform: Haiku
                    takes no effort at all, and `xhigh` is newer than `max`, so
                    a model can have the second and not the first. Showing a
                    level the model rejects would turn a settings choice into a
                    failed call much later, somewhere else. */}
                <select
                  aria-label={`${meta.id} complexity effort`}
                  value={tier.effort}
                  disabled={efforts.length === 0}
                  onChange={(e) => set({ effort: e.target.value })}
                >
                  {efforts.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {efforts.length === 0 && (
              <p className="hint">
                This model has no effort setting — it answers the same way every
                time.
              </p>
            )}

            {chosen && <p className="hint claude-tier-note">{chosen.note}</p>}

            {isTyping && known(tier.model) && (
              <button
                type="button"
                className="model-tier-back"
                aria-label={`Choose the ${meta.id} complexity model from the list instead`}
                onClick={() => setTyping({ ...typing, [index]: false })}
              >
                Choose from the list instead
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
