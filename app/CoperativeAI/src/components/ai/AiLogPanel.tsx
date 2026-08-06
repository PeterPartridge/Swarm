import { useCallback, useEffect, useState } from "react";
import { listAiCalls, type AiCall, type AiCallTotals } from "../../lib/backend";
import { useWorkChanged } from "../../lib/workSignal";

/** Thousands separators, because six-figure token counts are unreadable without
 *  them and this panel is mostly six-figure token counts. */
function count(n: number): string {
  return n.toLocaleString();
}

/** How a call ended, said as an outcome rather than a database value. */
const OUTCOME_WORDS: Record<string, string> = {
  ok: "answered",
  declined: "asked a question",
  blocked: "never sent",
  refusal: "refused",
  error: "failed",
};

/** What the AI has actually been doing, in tokens and in words.
 *
 *  **Why tokens and not money.** The budget screens already answer "what has
 *  this cost", and for a metered provider that is the right question. It is not
 *  a question that has an answer for Claude Code on a plan: the allowance is
 *  charged where this app cannot see it, and there is no per-token rate to
 *  multiply by. Tokens *are* knowable for every provider, so counting them is a
 *  real answer where a price would be an invention.
 *
 *  **Why the exchange.** A tally says a call happened; it cannot tell you why a
 *  plan came back odd. What was asked and what came back is the thing you
 *  actually want when something reads wrong, and it was the one thing the ledger
 *  never kept.
 *
 *  Each call is collapsed by default. A page of prompts is a wall, and the point
 *  of the list is to find the one call worth reading. */
export default function AiLogPanel({ productId }: { productId: number }) {
  const [totals, setTotals] = useState<AiCallTotals | null>(null);
  const [calls, setCalls] = useState<AiCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const log = await listAiCalls(productId);
      setTotals(log.totals);
      setCalls(log.calls);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A finished job is a new row, so the log follows the same signal everything
  // else does rather than needing a refresh by hand.
  useWorkChanged(refresh);

  function toggle(id: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const sent = totals ? totals.calls - totals.blocked : 0;

  return (
    <section className="develop-card ai-log" aria-label="AI log">
      <h3>What the AI has done</h3>

      {error && <p role="alert">{error}</p>}

      {totals && (
        <>
          <dl className="ai-log-totals">
            <div>
              <dt>Sent to a provider</dt>
              <dd>{count(sent)}</dd>
            </div>
            <div>
              <dt>Tokens in</dt>
              <dd>{count(totals.inputTokens)}</dd>
            </div>
            <div>
              <dt>Tokens out</dt>
              <dd>{count(totals.outputTokens)}</dd>
            </div>
            <div>
              <dt>Read from cache</dt>
              <dd>{count(totals.cacheReadTokens)}</dd>
            </div>
          </dl>

          <p className="hint">
            Tokens, not money — the budget screens hold the cost where there is
            one. A Claude plan has no per-token price to quote, so this counts
            what was used rather than inventing what it was worth.
            {totals.blocked > 0 && (
              <>
                {" "}
                {count(totals.blocked)} more{" "}
                {totals.blocked === 1 ? "call was" : "calls were"} never sent —
                refused before reaching a provider, so they cost nothing and are
                counted apart.
              </>
            )}
          </p>
        </>
      )}

      {calls.length === 0 && !error && (
        <p className="hint">Nothing yet. Every AI call lands here as it happens.</p>
      )}

      <ul className="ai-log-list">
        {calls.map((call) => {
          const showing = open.has(call.id);
          const hasExchange = call.prompt !== "" || call.reply !== "";
          return (
            <li key={call.id} className={`ai-log-call outcome-${call.outcome}`}>
              <button
                type="button"
                className="ai-log-head"
                aria-expanded={showing}
                aria-label={`${showing ? "Hide" : "Show"} the ${call.purpose} call to ${call.provider}`}
                disabled={!hasExchange}
                onClick={() => toggle(call.id)}
              >
                <span className="ai-log-purpose">{call.purpose}</span>
                <span className="ai-log-model">
                  {call.provider}
                  {call.model && ` · ${call.model}`}
                </span>
                <span className={`ai-log-outcome ${call.outcome}`}>
                  {OUTCOME_WORDS[call.outcome] ?? call.outcome}
                </span>
                <span className="ai-log-tokens">
                  {call.inputTokens + call.outputTokens > 0
                    ? `${count(call.inputTokens)} in · ${count(call.outputTokens)} out`
                    : "no tokens reported"}
                </span>
              </button>

              {showing && (
                <div className="ai-log-exchange">
                  <h4>Asked</h4>
                  <pre>{call.prompt || "(not recorded)"}</pre>
                  <h4>Came back</h4>
                  <pre>{call.reply || "(not recorded)"}</pre>
                </div>
              )}

              {/* Said rather than left as a dead control: rows from before the
                  exchange was kept, and calls refused before they were sent,
                  genuinely have nothing to show. */}
              {!hasExchange && (
                <p className="hint ai-log-none">
                  {call.outcome === "blocked"
                    ? "Never sent, so there is nothing to read."
                    : "Recorded before the exchange was kept."}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
