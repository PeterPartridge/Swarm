import { useCallback, useEffect, useState } from "react";
import {
  installModel,
  listModelStatus,
  refreshProviderModels,
  setModelVision,
  PROBE_LABELS,
  type ModelStatus,
  type ValidationReport,
} from "../lib/backend";

const STATE_LABELS: Record<string, string> = {
  detected: "New — not yet installed",
  installed: "Installed",
  failed: "Failed validation",
};

/** Models the platform has seen, and whether each may be used.
 *
 *  A model appearing on a provider does not make it usable: Ollama lists
 *  whatever has been pulled, and a provider's model list is typed in by hand.
 *  Neither says whether the model can produce the structured output the
 *  platform depends on, so a new model is refused until it has been installed
 *  and validated. */
export default function ModelInstalls({ productId }: { productId: number | null }) {
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setModels(await listModelStatus());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onRefreshProvider(providerId: number) {
    try {
      const found = await refreshProviderModels(providerId);
      setNotice(
        found.length === 0
          ? "No new models on that server."
          : `Found ${found.length} new model${found.length === 1 ? "" : "s"}: ${found.join(", ")}. Install to use.`,
      );
      setError(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function onInstall(entry: ModelStatus) {
    if (productId === null) {
      setError(
        "Installing needs a Product with a folder — the capability pack is written beside its briefs.",
      );
      return;
    }
    setBusy(entry.model);
    setError(null);
    setNotice(null);
    try {
      const report: ValidationReport = await installModel(
        entry.providerId,
        entry.model,
        productId,
      );
      setNotice(
        report.passed
          ? `${entry.model} passed every check and is ready to use.`
          : `${entry.model} did not pass. It stays blocked — see the report below.`,
      );
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onVisionChange(entry: ModelStatus, canSee: boolean) {
    try {
      await setModelVision(entry.providerId, entry.model, canSee);
      setError(null);
      setNotice(
        canSee
          ? `${entry.model} will be shown UI mockups when generating code changes.`
          : `${entry.model} will be told mockups exist but not shown them.`,
      );
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  function reportOf(entry: ModelStatus): ValidationReport | null {
    try {
      const parsed = JSON.parse(entry.validationReport);
      return parsed && Array.isArray(parsed.probes) ? parsed : null;
    } catch {
      return null;
    }
  }

  const providerIds = [...new Set(models.map((m) => m.providerId))];

  return (
    <section className="develop-card" aria-label="Models">
      <h2>Models</h2>
      <p className="hint">
        A model must be installed before the platform will use it. Installing
        builds a capability pack from this Product's rules and then tests the
        model against it — <strong>every check must pass</strong>.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {providerIds.map((id) => (
        <button
          key={id}
          aria-label={`Check for new models on provider ${id}`}
          onClick={() => onRefreshProvider(id)}
        >
          Check for new models
        </button>
      ))}

      {models.length === 0 && <p>No models yet — add an AI provider first.</p>}

      <ul className="model-list">
        {models.map((entry) => {
          const report = reportOf(entry);
          return (
            <li key={`${entry.providerId}-${entry.model}`} className={`model state-${entry.state}`}>
              <div className="model-head">
                <strong>{entry.model}</strong>{" "}
                <span className="model-provider">{entry.provider}</span>
                <span className={`model-state ${entry.state}`}>
                  {STATE_LABELS[entry.state] ?? entry.state}
                </span>
                {entry.state !== "installed" && (
                  <button
                    aria-label={`Install ${entry.model}`}
                    disabled={busy === entry.model}
                    onClick={() => onInstall(entry)}
                  >
                    {busy === entry.model ? "Testing…" : "Install"}
                  </button>
                )}
                {entry.state === "installed" && (
                  <button
                    aria-label={`Re-validate ${entry.model}`}
                    disabled={busy === entry.model}
                    onClick={() => onInstall(entry)}
                  >
                    {busy === entry.model ? "Testing…" : "Re-validate"}
                  </button>
                )}
              </div>

              <label className="model-vision">
                <input
                  type="checkbox"
                  checked={entry.supportsVision}
                  onChange={(e) => onVisionChange(entry, e.target.checked)}
                />{" "}
                This model can see pictures
                <span className="hint">
                  {" "}
                  — UI mockups on a work item are sent to it. Leave off if you
                  are not sure: a text-only model spends the call on an error.
                </span>
              </label>

              {report && report.probes.length > 0 && (
                <ul className="probe-list">
                  {report.probes.map((probe) => (
                    <li key={probe.probe} className={probe.passed ? "pass" : "fail"}>
                      <span className="probe-mark">{probe.passed ? "✓" : "✗"}</span>{" "}
                      {PROBE_LABELS[probe.probe] ?? probe.probe} —{" "}
                      <span className="probe-detail">{probe.detail}</span>
                    </li>
                  ))}
                </ul>
              )}

              {report && report.suggestedFixes.length > 0 && (
                <ul className="fix-list">
                  {report.suggestedFixes.map((fix) => (
                    <li key={fix}>{fix}</li>
                  ))}
                </ul>
              )}

              {entry.packPath && (
                <p className="pack-path">Capability pack: {entry.packPath}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
