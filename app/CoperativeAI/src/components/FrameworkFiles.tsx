import { useState } from "react";
import { generateFrameworkFiles, type EmitReport } from "../lib/backend";

/** Generates the framework's own files for a Product — solution specs and page
 *  briefs — into its scaffold folder, so what the app holds becomes the source
 *  of truth Claude reads. Files edited by hand are reported, never overwritten. */
export default function FrameworkFiles({ productId }: { productId: number }) {
  const [report, setReport] = useState<EmitReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onGenerate() {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      setReport(await generateFrameworkFiles(productId));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="develop-card" aria-label="Framework files">
      <h2>Framework files</h2>
      <p className="hint">
        Writes this Product's solution specs and page briefs into its folder, so
        the framework's guardrails apply to what you planned here. Anything you
        have edited by hand is left alone and listed below.
      </p>
      {error && <p role="alert">{error}</p>}

      <button onClick={onGenerate} disabled={busy}>
        {busy ? "Generating…" : "Generate framework files"}
      </button>

      {report && (
        <div className="emit-report" role="status">
          <p>
            {report.written.length} written · {report.unchanged.length} already
            up to date · {report.conflicts.length} left alone
          </p>
          {report.written.length > 0 && (
            <details>
              <summary>Written ({report.written.length})</summary>
              <ul>
                {report.written.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            </details>
          )}
          {report.conflicts.length > 0 && (
            <details open>
              <summary>
                Left alone — edited since the app wrote them (
                {report.conflicts.length})
              </summary>
              <ul>
                {report.conflicts.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
              <p className="hint">
                Your edits are safe. To let the app regenerate one of these,
                delete it and generate again.
              </p>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
