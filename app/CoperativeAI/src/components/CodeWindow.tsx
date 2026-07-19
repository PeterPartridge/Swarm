import { useEffect, useRef, useState, type ComponentType } from "react";
import { writeSolutionFile } from "../lib/backend";

/** Loosely typed on purpose: the editor component is loaded dynamically and
 *  jsdom tests substitute a plain textarea for it. */
type EditorComponent = ComponentType<{
  path: string;
  value: string;
  onChange: (value: string | undefined) => void;
  onMount: (editor: unknown, monaco: unknown) => void;
  theme: string;
  height: string;
  options: Record<string, unknown>;
  "aria-label"?: string;
}>;

/** A real editor over one file of a Solution's working copy.
 *
 *  Saving goes through the same containment rule as every other path into the
 *  repository, and nothing can write under `.git`. Dirty state is tracked
 *  against the last saved content, not the last keystroke, so an undo back to
 *  the saved text reads as clean. */
export default function CodeWindow({
  solutionId,
  path,
  initialContent,
  onSaved,
}: {
  solutionId: number;
  path: string;
  initialContent: string;
  onSaved: () => void;
}) {
  const [Editor, setEditor] = useState<EditorComponent | null>(null);
  const [value, setValue] = useState(initialContent);
  const [savedContent, setSavedContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ctrl+S is registered once on mount; the ref keeps it pointing at the
  // current save rather than the closure from the first render.
  const saveRef = useRef<() => void>(() => {});

  useEffect(() => {
    setValue(initialContent);
    setSavedContent(initialContent);
    setError(null);
  }, [path, initialContent]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const setup = await import("../lib/monacoSetup");
        await setup.ensureMonaco();
        const mod = await import("@monaco-editor/react");
        if (!cancelled) setEditor(() => mod.default as unknown as EditorComponent);
      } catch (e) {
        if (!cancelled) setError(`the editor could not load: ${String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = value !== savedContent;

  async function onSave() {
    setSaving(true);
    try {
      await writeSolutionFile(solutionId, path, value);
      setSavedContent(value);
      setError(null);
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }
  saveRef.current = () => void onSave();

  return (
    <div className="code-window">
      <div className="code-window-head">
        <span className="file-path">
          {path}
          {dirty && (
            <em className="code-dirty" aria-label={`${path} has unsaved changes`}>
              {" "}
              ● unsaved
            </em>
          )}
        </span>
        <button
          aria-label={`Save ${path}`}
          disabled={!dirty || saving}
          onClick={() => void onSave()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {Editor ? (
        <Editor
          path={path}
          value={value}
          onChange={(next) => setValue(next ?? "")}
          onMount={(editor, monaco) => {
            const e = editor as {
              addCommand: (keybinding: number, handler: () => void) => void;
            };
            const m = monaco as {
              KeyMod: { CtrlCmd: number };
              KeyCode: { KeyS: number };
            };
            e.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => saveRef.current());
          }}
          theme="vs"
          height="24rem"
          options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
          aria-label={`Editor for ${path}`}
        />
      ) : (
        !error && <p className="hint">Loading the editor…</p>
      )}
    </div>
  );
}
