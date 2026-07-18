import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  getProductBudget,
  getSpendSummary,
  listAiProviders,
  setProductBudget,
  formatMoney,
  micropenceToPounds,
  poundsToMicropence,
  type AiProvider,
  type SpendSummary,
} from "../lib/backend";
import { usePermissions } from "../lib/permissions";

const DEFAULTS = {
  totalBudget: "0.00",
  aiBudget: "0.00",
  tokenLimit: "0",
  warnPct: 75,
  handoverPct: 90,
  hardStopPct: 100,
  periodDays: 30,
};

/** Budgets and AI spend for a Product: what may be spent, what has been, and
 *  which provider the router will use next. The state shown is the router's own
 *  decision (returned by get_spend_summary) rather than one re-derived here, so
 *  what the user reads cannot drift from what is enforced. */
export default function BudgetPanel({ productId }: { productId: number }) {
  const [summary, setSummary] = useState<SpendSummary | null>(null);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [chain, setChain] = useState<number[]>([]);
  const [form, setForm] = useState({ ...DEFAULTS });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Spend is shown to anyone who can reach the Product area; only a role with
  // canManageBudget gets the controls that decide what may be spent.
  const { canManageBudget } = usePermissions();

  const refresh = useCallback(async () => {
    try {
      const [budget, spend, loadedProviders] = await Promise.all([
        getProductBudget(productId),
        getSpendSummary(productId),
        listAiProviders(),
      ]);
      setProviders(loadedProviders);
      setSummary(spend);
      if (budget) {
        setForm({
          totalBudget: micropenceToPounds(budget.totalBudgetMicropence),
          aiBudget: micropenceToPounds(budget.aiBudgetMicropence),
          tokenLimit: String(budget.tokenLimit),
          warnPct: budget.warnPct,
          handoverPct: budget.handoverPct,
          hardStopPct: budget.hardStopPct,
          periodDays: budget.periodDays,
        });
        setChain(budget.providerChain);
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    try {
      await setProductBudget({
        productId,
        totalBudgetMicropence: poundsToMicropence(form.totalBudget),
        aiBudgetMicropence: poundsToMicropence(form.aiBudget),
        tokenLimit: Number(form.tokenLimit) || 0,
        warnPct: form.warnPct,
        handoverPct: form.handoverPct,
        hardStopPct: form.hardStopPct,
        periodDays: form.periodDays,
        providerChain: chain,
      });
      setNotice("Budget saved.");
      setError(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  function moveInChain(providerId: number, checked: boolean) {
    setChain((current) =>
      checked
        ? [...current, providerId]
        : current.filter((id) => id !== providerId),
    );
  }

  const providerName = (id: number) =>
    providers.find((p) => p.id === id)?.name ?? `Provider ${id}`;

  return (
    <section className="budget-panel" aria-label="AI budget">
      <h3>AI budget</h3>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {summary && summary.state !== "none" && (
        <div className={`spend-bar state-${summary.state}`} aria-label="AI spend">
          <div className="spend-track">
            <div
              className="spend-fill"
              style={{ width: `${Math.min(summary.usedPct, 100)}%` }}
            />
          </div>
          <p className="spend-figures">
            <strong>
              {formatMoney(summary.spentMicropence)} of{" "}
              {formatMoney(summary.aiBudgetMicropence)}
            </strong>{" "}
            — {summary.usedPct}% · {summary.spentTokens.toLocaleString()} tokens ·{" "}
            {summary.calls} call{summary.calls === 1 ? "" : "s"} this period
          </p>
          <p className="spend-reason">
            {summary.activeProvider
              ? `Next call: ${summary.activeProvider} — ${summary.reason}`
              : summary.reason}
          </p>
        </div>
      )}
      {summary?.state === "none" && (
        <p className="hint">
          No budget set — AI calls are limited only by each work item's policy.
        </p>
      )}

      {!canManageBudget() ? (
        <p className="hint">
          Your role can see AI spend but not change the budget.
        </p>
      ) : (
      <form onSubmit={onSave} aria-label="Budget settings">
        <label>
          Total Product budget (£)
          <input
            aria-label="Total Product budget in pounds"
            value={form.totalBudget}
            onChange={(e) => setForm({ ...form, totalBudget: e.target.value })}
          />
        </label>
        <label>
          AI budget (£)
          <input
            aria-label="AI budget in pounds"
            value={form.aiBudget}
            onChange={(e) => setForm({ ...form, aiBudget: e.target.value })}
          />
        </label>
        <label>
          Token limit (0 = no limit)
          <input
            aria-label="Token limit"
            value={form.tokenLimit}
            onChange={(e) => setForm({ ...form, tokenLimit: e.target.value })}
          />
        </label>
        <label>
          Warn at (%)
          <input
            type="number"
            aria-label="Warn threshold"
            value={form.warnPct}
            onChange={(e) => setForm({ ...form, warnPct: Number(e.target.value) })}
          />
        </label>
        <label>
          Hand over at (%)
          <input
            type="number"
            aria-label="Handover threshold"
            value={form.handoverPct}
            onChange={(e) =>
              setForm({ ...form, handoverPct: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Stop at (%)
          <input
            type="number"
            aria-label="Hard stop threshold"
            value={form.hardStopPct}
            onChange={(e) =>
              setForm({ ...form, hardStopPct: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Period (days)
          <input
            type="number"
            aria-label="Budget period in days"
            value={form.periodDays}
            onChange={(e) =>
              setForm({ ...form, periodDays: Number(e.target.value) })
            }
          />
        </label>

        <fieldset className="provider-chain">
          <legend>Provider order</legend>
          <p className="hint">
            Spend the first provider until the handover threshold, then move to
            the next. Put a local (free) provider last so work continues after
            the budget runs out.
          </p>
          {providers.length === 0 ? (
            <p>No AI providers configured yet — add one in AI Settings.</p>
          ) : (
            providers.map((p) => (
              <label key={p.id} className="chain-option">
                <input
                  type="checkbox"
                  aria-label={`Use ${p.name} in the chain`}
                  checked={chain.includes(p.id)}
                  onChange={(e) => moveInChain(p.id, e.target.checked)}
                />
                {p.name}
              </label>
            ))
          )}
          {chain.length > 0 && (
            <p className="chain-order">
              Order: {chain.map(providerName).join(" → ")}
            </p>
          )}
        </fieldset>

        <button type="submit">Save budget</button>
      </form>
      )}
    </section>
  );
}
