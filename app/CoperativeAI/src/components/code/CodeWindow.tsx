import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import {
  askCodingPal,
  writeSolutionFile,
  PAL_ACTION_LABELS,
  type PalAction,
  type PalAnswer,
} from "../../lib/backend";

const PAL_ACTIONS = Object.keys(PAL_ACTION_LABELS) as PalAction[];

/** Only the slices of Monaco this file touches. Loose for the same reason as
 *  `EditorComponent`: it is loaded at runtime and stubbed in tests. */
interface MonacoEditor {
  addCommand: (keybinding: number, handler: () => void) => void;
  onDidChangeCursorSelection?: (cb: (ev: { selection: unknown }) => void) => void;
  getModel?: () => { getValueInRange?: (range: unknown) => string } | null;
  onMouseDown?: (cb: (ev: MonacoMouseEvent) => void) => void;
  deltaDecorations?: (old: string[], next: unknown[]) => string[];
  revealLineInCenterIfOutsideViewport?: (line: number) => void;
}

interface MonacoMouseEvent {
  target: { type: number; position?: { lineNumber: number } };
}

interface MonacoNamespace {
  KeyMod: { CtrlCmd: number };
  KeyCode: { KeyS: number };
  editor?: { MouseTargetType?: { GUTTER_GLYPH_MARGIN?: number } };
  Range?: new (a: number, b: number, c: number, d: number) => unknown;
}

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
 *  **Controlled.** The buffer lives in the parent, keyed by path, so switching
 *  between open files keeps each one's unsaved edits. Holding it here would
 *  mean every tab switch unmounted the editor and threw the work away.
 *
 *  Saving goes through the same containment rule as every other path into the
 *  repository, and nothing can write under `.git`. Dirty state is tracked
 *  against the last saved content, not the last keystroke, so an undo back to
 *  the saved text reads as clean. */
export default function CodeWindow({
  solutionId,
  path,
  value,
  saved,
  onChange,
  onSaved,
  breakpoints,
  onToggleBreakpoint,
  stoppedLine,
}: {
  solutionId: number;
  path: string;
  /** The working buffer — the parent's, so it survives a tab switch. */
  value: string;
  /** What is on disk, for the dirty comparison. */
  saved: string;
  onChange: (next: string) => void;
  /** Called with the content that reached disk. */
  onSaved: (savedContent: string) => void;
  /** Lines with a breakpoint on them, drawn in the gutter. */
  breakpoints?: number[];
  /** A click in the gutter. Absent, the gutter is not drawn at all — a margin
   *  you can click that does nothing is worse than no margin. */
  onToggleBreakpoint?: (line: number) => void;
  /** The line the debugger is stopped on, when it is stopped in this file.
   *  Scrolled to and highlighted, because "where am I?" is the first question
   *  after a program stops and hunting for it is the whole friction. */
  stoppedLine?: number | null;
}) {
  const [Editor, setEditor] = useState<EditorComponent | null>(null);
  /// The editor instance and its Monaco namespace, kept so the breakpoint
  /// decorations can be redrawn when the set changes rather than only on mount.
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<MonacoNamespace | null>(null);
  const decorations = useRef<string[]>([]);
  const stopMark = useRef<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [palAction, setPalAction] = useState<PalAction>("explain");
  const [palInstruction, setPalInstruction] = useState("");
  const [palAnswer, setPalAnswer] = useState<PalAnswer | null>(null);
  const [palBusy, setPalBusy] = useState(false);
  /// What the developer has selected in the editor, kept as text so the pal
  /// can be pointed at "this bit" rather than the whole file.
  const [selection, setSelection] = useState("");
  // Ctrl+S is registered once on mount; the ref keeps it pointing at the
  // current save rather than the closure from the first render.
  const saveRef = useRef<() => void>(() => {});

  // A different file is a different set of problems: clear the last one's
  // error and pal answer rather than showing them over the new file.
  useEffect(() => {
    setError(null);
    setPalAnswer(null);
    setSelection("");
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const setup = await import("../../lib/monacoSetup");
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

  const dirty = value !== saved;

  async function onSave() {
    setSaving(true);
    try {
      await writeSolutionFile(solutionId, path, value);
      setError(null);
      onSaved(value);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }
  saveRef.current = () => void onSave();

  async function onAskPal() {
    setPalBusy(true);
    try {
      // The file itself is read from disk at the backend — unsaved edits are
      // the developer's, and paying to reason about a moving target buys a
      // stale answer. The selection travels from the editor, because "this
      // bit" only exists there.
      setPalAnswer(
        await askCodingPal({
          solutionId,
          path,
          action: palAction,
          instruction: palInstruction,
          selection: selection.trim() === "" ? null : selection,
        }),
      );
      setError(null);
    } catch (e) {
      setPalAnswer(null);
      setError(String(e));
    } finally {
      setPalBusy(false);
    }
  }

  /** Redraws the gutter dots from `breakpoints`.
   *
   *  `deltaDecorations` replaces the previous set rather than adding to it,
   *  which is why the ids are kept — without them every redraw would leave the
   *  old dots behind and the margin would fill up with stale breakpoints. */
  const drawBreakpoints = useCallback(() => {
    const e = editorRef.current;
    const m = monacoRef.current;
    if (!e?.deltaDecorations || !m?.Range) return;
    const Range = m.Range;
    const next = (breakpoints ?? []).map((line: number) => ({
      range: new Range(line, 1, line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: "breakpoint-dot",
        glyphMarginHoverMessage: { value: `Breakpoint on line ${line}` },
      },
    }));
    decorations.current = e.deltaDecorations(decorations.current, next);
  }, [breakpoints]);

  useEffect(() => {
    drawBreakpoints();
  }, [drawBreakpoints]);

  /** The stopped line: a highlight, and a scroll to it if it is off screen.
   *
   *  Its own decoration set rather than sharing the breakpoints' — `deltaDecorations`
   *  replaces whichever set you hand it, so one call would clear the other and
   *  the dots would vanish every time the program stepped. */
  useEffect(() => {
    const e = editorRef.current;
    const m = monacoRef.current;
    if (!e?.deltaDecorations || !m?.Range) return;
    const Range = m.Range;
    const next =
      stoppedLine == null
        ? []
        : [
            {
              range: new Range(stoppedLine, 1, stoppedLine, 1),
              options: {
                isWholeLine: true,
                className: "stopped-line",
                glyphMarginClassName: "stopped-arrow",
              },
            },
          ];
    stopMark.current = e.deltaDecorations(stopMark.current, next);
    if (stoppedLine != null) e.revealLineInCenterIfOutsideViewport?.(stoppedLine);
  }, [stoppedLine]);

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
          onChange={(next) => onChange(next ?? "")}
          onMount={(editor, monaco) => {
            const e = editor as MonacoEditor;
            const m = monaco as MonacoNamespace;
            editorRef.current = e;
            monacoRef.current = m;
            e.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => saveRef.current());
            e.onDidChangeCursorSelection?.((ev) => {
              setSelection(e.getModel?.()?.getValueInRange?.(ev.selection) ?? "");
            });
            // A click in the glyph margin is the one gesture everybody already
            // knows for a breakpoint, so it is the gesture.
            if (onToggleBreakpoint) {
              const gutter = m.editor?.MouseTargetType?.GUTTER_GLYPH_MARGIN;
              e.onMouseDown?.((ev) => {
                if (gutter === undefined || ev.target.type !== gutter) return;
                const line = ev.target.position?.lineNumber;
                if (line) onToggleBreakpoint(line);
              });
            }
            drawBreakpoints();
          }}
          theme="vs"
          height="24rem"
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            // Only where a click would do something.
            glyphMargin: !!onToggleBreakpoint || stoppedLine != null,
          }}
          aria-label={`Editor for ${path}`}
        />
      ) : (
        !error && <p className="hint">Loading the editor…</p>
      )}

      <section className="coding-pal" aria-label={`Coding pal for ${path}`}>
        <div className="pal-ask">
          <select
            aria-label="Pal action"
            value={palAction}
            onChange={(e) => setPalAction(e.target.value as PalAction)}
          >
            {PAL_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {PAL_ACTION_LABELS[a]}
              </option>
            ))}
          </select>
          <input
            aria-label="Pal instruction"
            placeholder="anything specific? (optional)"
            value={palInstruction}
            onChange={(e) => setPalInstruction(e.target.value)}
          />
          <button aria-label={`Ask the pal about ${path}`} onClick={onAskPal} disabled={palBusy}>
            {palBusy ? "Thinking…" : "Ask"}
          </button>
        </div>
        {selection.trim() !== "" && (
          <p className="hint" role="status">
            Asking about the selected code — clear the selection to ask about
            the whole file.
          </p>
        )}

        {palAnswer && palAnswer.blocked && (
          <p role="status">
            The pal stopped rather than guessing: {palAnswer.blocked.reason}{" "}
            {palAnswer.blocked.whatIsNeeded}
          </p>
        )}
        {palAnswer && !palAnswer.blocked && (
          <div className="pal-answer">
            {/* Shown before apply, not after save — but never enforced,
                because accepting is ungated everywhere in this app. */}
            {palAnswer.violations.length > 0 && (
              <p role="alert">
                The proposal uses technology the developer rules forbid:{" "}
                {palAnswer.violations.join(", ")}.
              </p>
            )}
            <pre className="pal-explanation" aria-label={`Pal explanation for ${path}`}>
              {palAnswer.explanation}
            </pre>
            {palAnswer.replacement !== "" && (
              <button
                aria-label={`Apply the pal's revision to ${path}`}
                onClick={() => {
                  onChange(palAnswer.replacement);
                  setPalAnswer(null);
                }}
              >
                Apply to the editor
              </button>
            )}
            <p className="hint">
              {palAnswer.provider} · {palAnswer.reason}. Applying only changes the
              editor — your save is what touches the file.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
