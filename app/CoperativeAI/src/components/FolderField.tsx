import { useState } from "react";
import { pickFolder } from "../lib/backend";

interface FolderFieldProps {
  label: string;
  value: string;
  onChange: (path: string) => void;
}

/** A folder chooser that opens the native OS folder explorer — no typing.
 *  Reusable anywhere a folder is needed (Product scaffold, repositories). */
export default function FolderField({ label, value, onChange }: FolderFieldProps) {
  const [error, setError] = useState<string | null>(null);

  async function choose() {
    try {
      const path = await pickFolder();
      if (path) onChange(path);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="folder-field">
      <span className="folder-field-label">{label}</span>
      <div className="folder-field-row">
        <button type="button" aria-label={`Choose folder: ${label}`} onClick={choose}>
          Choose folder…
        </button>
        <span className="folder-field-value">
          {value || "No folder chosen"}
        </span>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
