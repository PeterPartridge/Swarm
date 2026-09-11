import { useState } from "react";
import {
  devicePolicyExport,
  pickFolder,
  saveDevicePolicyExport,
  type DevicePolicyExportKind,
} from "../../lib/backend";

/** The device-policy settings this app's sandbox wants, as a file to hand over.
 *
 *  **Exported, never installed, and the panel says so rather than implying it
 *  by the absence of a button.** This app cannot deploy an Intune policy:
 *  policies reach a device from its organisation's tenant over MDM, and an
 *  application is not in that path. The one thing it could do locally is write
 *  the policy registry key itself — which would make the machine read as
 *  *managed* to this app's own detection, so the app would be manufacturing the
 *  evidence it then reports back in the table above. That is the failure this
 *  whole area exists to prevent, which is why there is no Apply button here and
 *  why its absence is explained.
 *
 *  **Shown before it is saved**, like the policy file beside it. This one goes
 *  to somebody's tenant and is applied to machines other than this one, so
 *  reading it first matters more rather than less. */
export default function DevicePolicyExport() {
  const [kind, setKind] = useState<DevicePolicyExportKind>("registry");
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState("");

  async function show(next: DevicePolicyExportKind) {
    setKind(next);
    setSaved("");
    setBusy("show");
    try {
      setText(await devicePolicyExport(next));
      setError(null);
    } catch (e) {
      setError(String(e));
      setText("");
    } finally {
      setBusy("");
    }
  }

  async function save() {
    const folder = await pickFolder();
    // Cancelling the picker is an ordinary thing to do, not a failure.
    if (folder === null) return;
    setBusy("save");
    try {
      setSaved(await saveDevicePolicyExport(kind, folder));
      setError(null);
    } catch (e) {
      setError(String(e));
      setSaved("");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="policy-source" aria-label="Device policy export">
      <h4>Settings for your organisation to apply</h4>
      {/* **What it is and what it is not, in the first breath.** Somebody
          reading "device policy" in an app naturally expects the app to set it,
          and finding out otherwise three clicks later wastes their time. */}
      <p className="hint">
        These are the WSL settings this app&rsquo;s sandbox wants, as a file you
        can hand to whoever administers your machines. This app cannot apply
        them: an Intune policy reaches a device from its tenant, and nothing an
        application does on the device is that. Writing the keys here would only
        make this machine <em>look</em> managed to the table above.
      </p>

      {error && <p role="alert">{error}</p>}

      <div className="policy-actions">
        <label>
          Form
          <select
            value={kind}
            onChange={(e) => void show(e.target.value as DevicePolicyExportKind)}
          >
            <option value="registry">Registry file (.reg)</option>
            <option value="script">PowerShell, for Intune device scripts</option>
          </select>
        </label>
        <button type="button" onClick={() => void show(kind)} disabled={busy !== ""}>
          {busy === "show" ? "Reading…" : "Show it"}
        </button>
        <button type="button" onClick={() => void save()} disabled={busy !== ""}>
          {busy === "save" ? "Saving…" : "Save to a folder…"}
        </button>
      </div>

      {saved && <p className="hint">Saved to {saved}.</p>}

      {text && (
        <div className="policy-read">
          <pre>{text}</pre>
        </div>
      )}

      {/* **The better route, named rather than left to be discovered.** A
          settings-catalog profile reports compliance; a file applied by hand
          does not, and somebody managing a fleet should know which they are
          choosing before they choose it. */}
      <p className="hint">
        For a fleet, setting these in Intune directly is better than either file
        — Devices &rsaquo; Configuration &rsaquo; Settings catalog, then search
        for &ldquo;Windows Subsystem for Linux&rdquo;. A profile there reports
        compliance back; a file applied by hand does not.
      </p>
      {/* **The limit that keeps the two mechanisms apart.** Said here as well
          as on the table row, because this is where somebody is most likely to
          believe they have just secured what an agent can reach. */}
      <p className="hint">
        None of these settings reach inside the distribution. They decide whether
        WSL may exist and how it may be configured from Windows — what an agent
        can reach once it is inside is what a policy file does, above.
      </p>
    </section>
  );
}
