import { useState } from "react";
import {
  recommendForWorkItem,
  formatMoney,
  type Recommendations,
} from "../lib/backend";

const KIND_LABELS: Record<string, string> = {
  fastest: "Fastest",
  costEfficient: "Most cost-efficient",
};

/** The two ways of doing a piece of work — fastest and cheapest — with what
 *  each is expected to cost and how long it should take. The source of every
 *  figure is shown: an estimate from the price table is a stated guess, and
 *  saying so is the difference between an honest number and a confident one. */
export default function CostRecommendation({
  workItemId,
  itemTitle,
  purpose = "solutionStrategy",
}: {
  workItemId: number;
  itemTitle: string;
  purpose?: string;
}) {
  const [result, setResult] = useState<Recommendations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onEstimate() {
    setBusy(true);
    setError(null);
    try {
      setResult(await recommendForWorkItem(workItemId, purpose));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cost-recommendation" aria-label={`AI cost options for ${itemTitle}`}>
      <button
        aria-label={`Estimate AI cost for ${itemTitle}`}
        disabled={busy}
        onClick={onEstimate}
      >
        {busy ? "Estimating…" : "What would AI cost?"}
      </button>

      {error && <p role="alert">{error}</p>}

      {result && (
        <div className="cost-options">
          {result.options.map((option) => (
            <div
              key={option.kind}
              className={`cost-option ${option.affordable ? "" : "unaffordable"}`}
              aria-label={`${KIND_LABELS[option.kind] ?? option.kind} option`}
            >
              <p className="option-head">
                <strong>{KIND_LABELS[option.kind] ?? option.kind}</strong> —{" "}
                {option.provider} · {option.model}
              </p>
              <p className="option-figures">
                ~{option.estTokens.toLocaleString()} tokens ·{" "}
                <strong>{formatMoney(option.estCostMicropence)}</strong> · ~
                {option.estMinutes} min
              </p>
              <p className="option-source">
                {option.source === "history"
                  ? "estimate: median of your recorded calls"
                  : "estimate: price table, no history yet"}
              </p>
              {!option.affordable && (
                <p className="option-warning">
                  This would exceed what is left of the AI budget.
                </p>
              )}
            </div>
          ))}
          {result.note && <p className="option-note">{result.note}</p>}
        </div>
      )}
    </div>
  );
}
