import { useState } from "react";
import {
  CLAUDE_MODELS,
  EFFORT_TIERS,
  OTHER_MODEL,
  type ModelChoice,
} from "../../lib/models";

/** Which model does which size of job.
 *
 *  **Why three named choices and not a list to order.** The stored array is
 *  indexed by effort — first for low, middle for medium, last for high — so the
 *  old field asked people to type models "cheapest first" and hold that mapping
 *  in their head. Nothing on screen said which one "high" would reach for, and
 *  getting the order wrong sent architecture work to the cheapest model without
 *  ever announcing it. Three labelled dropdowns say the mapping outright.
 *
 *  **Why a dropdown with a way out.** No endpoint lists the models an account
 *  can use, so this list is one somebody maintains — good enough to spare you
 *  typing `claude-opus-5` from memory, not good enough to be the only option. A
 *  model released after the list was written must still be reachable, so every
 *  tier can be typed instead. */
export default function ModelTierPicker({
  choices = CLAUDE_MODELS,
  value,
  onChange,
}: {
  /** The offered models, cheapest first. Defaults to the Claude set; Ollama
   *  passes whatever its server actually has pulled. */
  choices?: ModelChoice[];
  value: { low: string; medium: string; high: string };
  onChange: (next: { low: string; medium: string; high: string }) => void;
}) {
  /** Which tiers are being typed rather than picked. Held here rather than
   *  inferred from the value, so a half-typed model name does not flip the
   *  control back to the dropdown on every keystroke. */
  const [typing, setTyping] = useState<Record<string, boolean>>({});

  const known = (id: string) => choices.some((c) => c.id === id);

  return (
    <fieldset className="model-tiers">
      <legend>Which model for which job</legend>
      <p className="hint">
        A work item's effort decides which of these is asked. Nothing else reads
        this order, so it is safe to use the same model for more than one.
      </p>

      {EFFORT_TIERS.map((tier) => {
        const current = value[tier.id];
        // Typing when asked for, or when what is stored is not on the list —
        // a model chosen before this list was updated must still show.
        const isTyping = typing[tier.id] || (current !== "" && !known(current));
        const chosen = choices.find((c) => c.id === current);

        return (
          <div key={tier.id} className="model-tier">
            <label>
              {tier.label}
              {isTyping ? (
                <input
                  aria-label={`${tier.label} model`}
                  placeholder="claude-opus-5"
                  value={current}
                  onChange={(e) => onChange({ ...value, [tier.id]: e.target.value })}
                />
              ) : (
                <select
                  aria-label={`${tier.label} model`}
                  value={current}
                  onChange={(e) => {
                    if (e.target.value === OTHER_MODEL) {
                      setTyping({ ...typing, [tier.id]: true });
                      onChange({ ...value, [tier.id]: "" });
                      return;
                    }
                    onChange({ ...value, [tier.id]: e.target.value });
                  }}
                >
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                  <option value={OTHER_MODEL}>Other — type a model name…</option>
                </select>
              )}
            </label>

            <p className="hint model-tier-for">{tier.forWhat}</p>
            {/* What the chosen model is good at, from the Project brief. Shown
                against the choice rather than in documentation nobody opens. */}
            {chosen && <p className="hint model-tier-note">{chosen.note}</p>}

            {isTyping && (
              <button
                type="button"
                className="model-tier-back"
                aria-label={`Choose ${tier.label} from the list instead`}
                onClick={() => {
                  setTyping({ ...typing, [tier.id]: false });
                  onChange({ ...value, [tier.id]: tier.suggested });
                }}
              >
                Choose from the list instead
              </button>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
