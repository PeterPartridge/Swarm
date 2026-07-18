import { useCallback, useEffect, useState } from "react";
import {
  getProductPolicy,
  listAiProviders,
  setProductPolicy,
  EFFORT_TIERS,
  type AiProvider,
  type ProductPolicy,
} from "../lib/backend";

const CLOSED: Omit<ProductPolicy, "productId"> = {
  allowRead: false,
  allowGenerate: false,
  providerId: null,
  effortTier: "low",
};

/** Product-level AI policy — deny-by-default, and what gates "Generate work"
 *  on a Deliverable. Deliberately coarser than a work-item policy: it covers
 *  every Deliverable of this Product at once, which the panel says out loud. */
export default function ProductAiPolicy({ productId }: { productId: number }) {
  const [policy, setPolicy] = useState({ ...CLOSED });
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedPolicy, loadedProviders] = await Promise.all([
        getProductPolicy(productId),
        listAiProviders(),
      ]);
      setPolicy(loadedPolicy ?? { ...CLOSED });
      setProviders(loadedProviders);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(changes: Partial<typeof policy>) {
    const next = { ...policy, ...changes };
    setPolicy(next);
    try {
      await setProductPolicy({ productId, ...next });
      setError(null);
    } catch (e) {
      setError(String(e));
      await refresh();
    }
  }

  return (
    <section className="product-ai-policy" aria-label="Product AI policy">
      <h3>AI planning policy</h3>
      <p className="hint">
        Off by default. This covers <strong>every Deliverable</strong> of this
        Product — turning it on lets the AI read the Product brief and strategy
        and create work items.
      </p>
      {error && <p role="alert">{error}</p>}

      <label>
        <input
          type="checkbox"
          aria-label="Allow AI to read this Product"
          checked={policy.allowRead}
          onChange={(e) => save({ allowRead: e.target.checked })}
        />
        Allow reading the Product brief and strategy
      </label>
      <label>
        <input
          type="checkbox"
          aria-label="Allow AI to generate work items"
          checked={policy.allowGenerate}
          onChange={(e) => save({ allowGenerate: e.target.checked })}
        />
        Allow creating work items
      </label>
      <label>
        AI provider
        <select
          aria-label="Product AI provider"
          value={policy.providerId ?? ""}
          onChange={(e) =>
            save({ providerId: e.target.value === "" ? null : Number(e.target.value) })
          }
        >
          <option value="">None (blocked)</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Effort
        <select
          aria-label="Product AI effort"
          value={policy.effortTier}
          onChange={(e) => save({ effortTier: e.target.value })}
        >
          {EFFORT_TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
