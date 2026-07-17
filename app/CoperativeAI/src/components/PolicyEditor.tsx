import { useCallback, useEffect, useState } from "react";
import {
  getWorkItemPolicy,
  listAiProviders,
  setWorkItemPolicy,
  EFFORT_TIERS,
  type AiProvider,
  type WorkItemPolicy,
} from "../lib/backend";

interface PolicyEditorProps {
  workItemId: number;
  itemTitle: string;
  onClose: () => void;
}

const CLOSED: Omit<WorkItemPolicy, "workItemId"> = {
  allowRead: false,
  allowEdit: false,
  allowGenerateTests: false,
  providerId: null,
  effortTier: "low",
};

/** Per-work-item AI policy editor — deny-by-default; nothing is allowed
 *  until this panel says so. */
export default function PolicyEditor({ workItemId, itemTitle, onClose }: PolicyEditorProps) {
  const [policy, setPolicy] = useState({ ...CLOSED });
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedPolicy, loadedProviders] = await Promise.all([
        getWorkItemPolicy(workItemId),
        listAiProviders(),
      ]);
      setPolicy(loadedPolicy ?? { ...CLOSED });
      setProviders(loadedProviders);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [workItemId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(changes: Partial<typeof policy>) {
    const next = { ...policy, ...changes };
    setPolicy(next);
    try {
      await setWorkItemPolicy({ workItemId, ...next });
      setError(null);
    } catch (e) {
      setError(String(e));
      await refresh();
    }
  }

  return (
    <div className="policy-editor" aria-label={`AI policy for ${itemTitle}`}>
      <strong>AI policy</strong>
      {error && <p role="alert">{error}</p>}
      <label>
        <input
          type="checkbox"
          checked={policy.allowRead}
          onChange={(e) => save({ allowRead: e.target.checked })}
        />
        AI may read this item
      </label>
      <label>
        <input
          type="checkbox"
          checked={policy.allowEdit}
          onChange={(e) => save({ allowEdit: e.target.checked })}
        />
        AI may edit code for it
      </label>
      <label>
        <input
          type="checkbox"
          checked={policy.allowGenerateTests}
          onChange={(e) => save({ allowGenerateTests: e.target.checked })}
        />
        AI may generate tests
      </label>
      <label>
        Provider
        <select
          aria-label={`Provider for ${itemTitle}`}
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
          aria-label={`Effort for ${itemTitle}`}
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
      <button onClick={onClose}>Close</button>
    </div>
  );
}
