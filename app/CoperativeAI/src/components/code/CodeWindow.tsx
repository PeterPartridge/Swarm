import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import {
  askCodingPal,
  writeSolutionFile,
  PAL_ACTION_LABELS,
  type PalAction,
  type PalAnswer,
} from "../../lib/backend";
import BlockedNote from "../ai/BlockedNote";
import { useThemeMode } from "../../lib/theme";

const PAL_ACTIONS = Object.keys(PAL_ACTION_LABELS) as PalAction[];

/** Only the slices of Monaco this file touches. Loose for the same reason as
 *  `EditorComponent`: it is loaded at runtime and stubbed in tests. */
interface MonacoEditor {
  addCommand: (keybinding: number, handler: () => void) => void;
  /** Puts an item in Monaco's own right-click menu. */
  addAction?: (action: {
    id: string;
    label: string;
    contextMenuGroupId: string;
    contextMenuOrder: number;
    run: () => void;
  }) => void;
  /** One of Monaco's built-in actions, when the language has it. */
  getAction?: (id: string) => { run: () => Promise<void> } | null;
  onDidChangeCursorSelection?: (cb: (ev: { selection: unknown }) => void) => void;
  getModel?: () => MonacoModel | null;
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
  languages?: {
    registerHoverProvider?: (
      language: string,
      provider: {
        provideHover: (
          model: MonacoModel,
          position: { lineNumber: number; column: number },
        ) => Promise<{ contents: { value: string }[] } | null>;
      },
    ) => { dispose: () => void };
  };
}

interface MonacoModel {
  getValueInRange?: (range: unknown) => string;
  getLanguageId?: () => string;
  getWordAtPosition?: (position: { lineNumber: number; column: number }) =>
    | { word: string; startColumn: number; endColumn: number }
    | null;
  getLineContent?: (line: number) => string;
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
  logPoints,
  onToggleBreakpoint,
  stoppedLine,
  onHover,
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
  /** Lines that print instead of stopping. Drawn differently on purpose: a log
   *  point wearing a breakpoint's dot is a mark that never stops, which reads
   *  as a debugger that is broken. */
  logPoints?: number[];
  /** A click in the gutter. Absent, the gutter is not drawn at all — a margin
   *  you can click that does nothing is worse than no margin. */
  onToggleBreakpoint?: (line: number) => void;
  /** The line the debugger is stopped on, when it is stopped in this file.
   *  Scrolled to and highlighted, because "where am I?" is the first question
   *  after a program stops and hunting for it is the whole friction. */
  stoppedLine?: number | null;
  /** Works out what a name under the pointer comes to, or null when there is
   *  nothing to say.
   *
   *  Absent, no hover provider is registered at all — an editor that answered
   *  every hover with "no debugger" would be worse than one that stays quiet,
   *  and a provider that always returns nothing still costs a round trip
   *  through Monaco on every pointer movement. */
  onHover?: (expression: string) => Promise<{ value: string; kind: string } | null>;
}) {
  const theme = useThemeMode();
  const [Editor, setEditor] = useState<EditorComponent | null>(null);
  /// The editor instance and its Monaco namespace, kept so the breakpoint
  /// decorations can be redrawn when the set changes rather than only on mount.
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<MonacoNamespace | null>(null);
  const decorations = useRef<string[]>([]);
  /// The hover callback, in a ref: the provider is registered once on mount and
  /// would otherwise capture the first render's copy and go stale the moment
  /// the program stepped.
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;
  const stopMark = useRef<string[]>([]);
  /// The registered hover provider, so it goes when the editor does. Monaco's
  /// providers are global to a language rather than to an editor, so leaving
  /// one behind would have a closed file still answering hovers.
  const hover = useRef<{ dispose: () => void } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [palAction, setPalAction] = useState<PalAction>("explain");
  const [palAnswer, setPalAnswer] = useState<PalAnswer | null>(null);
  const [palBusy, setPalBusy] = useState(false);
  /// What the developer has selected in the editor, kept as text so the pal
  /// can be pointed at "this bit" rather than the whole file.
  const [selection, setSelection] = useState("");
  // Ctrl+S is registered once on mount; the ref keeps it pointing at the
  // current save rather than the closure from the first render.
  const saveRef = useRef<() => void>(() => {});
  /// The same trick for the right-click menu: Monaco keeps the handler it was
  /// given when the editor mounted, and a captured one would go on asking about
  /// whichever file was open then.
  const palRef = useRef<(action: PalAction) => void>(() => {});

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
  palRef.current = (action) => void askPal(action);

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

  /// Asks the pal, for the action the right-click menu chose.
  ///
  /// **In a ref, because Monaco keeps the first copy.** Actions are registered
  /// once when the editor mounts, and a handler captured then would go on
  /// asking about the file that was open at the time.
  async function askPal(action: PalAction) {
    setPalAction(action);
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
          action,
          // No instruction box any more: the menu is the whole question, and a
          // field asking "anything specific?" under every file was a line of
          // furniture people scrolled past.
          instruction: "",
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
    const next = [
      ...(breakpoints ?? []).map((line: number) => ({
        range: new Range(line, 1, line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: "breakpoint-dot",
          glyphMarginHoverMessage: { value: `Breakpoint on line ${line}` },
        },
      })),
      ...(logPoints ?? []).map((line: number) => ({
        range: new Range(line, 1, line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: "breakpoint-dot logpoint",
          glyphMarginHoverMessage: {
            value: `Log point on line ${line} — prints, does not stop`,
          },
        },
      })),
    ];
    decorations.current = e.deltaDecorations(decorations.current, next);
  }, [breakpoints, logPoints]);

  useEffect(() => {
    drawBreakpoints();
  }, [drawBreakpoints]);

  // Monaco's hover providers belong to a language rather than to an editor, so
  // one left registered would have a closed file still answering hovers — with
  // a callback pointing at a debug session that has since ended.
  useEffect(() => {
    return () => {
      hover.current?.dispose();
      hover.current = null;
    };
  }, []);

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

            // **The menu people already right-click for.** These were a select,
            // a text box and an Ask button under every editor — three controls
            // and a line of vertical space, permanently, for something asked
            // occasionally. Monaco has a context menu; this puts them in it.
            for (const [index, action] of PAL_ACTIONS.entries()) {
              e.addAction?.({
                id: `pal-${action}`,
                label: PAL_ACTION_LABELS[action],
                contextMenuGroupId: "coperativeai",
                contextMenuOrder: index,
                run: () => void palRef.current(action),
              });
            }
            // Formatting is Monaco's own, not the AI's: it is instant, free and
            // deterministic, and paying a model to indent code would be a
            // strange thing to do. Not every language has a formatter in this
            // build, so a language without one says so rather than doing
            // nothing at all.
            e.addAction?.({
              id: "format-document",
              label: "Format code",
              contextMenuGroupId: "coperativeai",
              contextMenuOrder: PAL_ACTIONS.length,
              run: () => {
                const format = e.getAction?.("editor.action.formatDocument");
                if (!format) {
                  setError(
                    "No formatter for this language is loaded in the editor — the file is unchanged.",
                  );
                  return;
                }
                void format.run();
              },
            });
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
            // **Hover the name, get the value.** The same `evaluate` the watch
            // pane uses, asked with a different reason — see `debugEvaluate`.
            // Registered only when there is something to ask, and only for this
            // file's language, so a Go editor does not answer hovers in a
            // TypeScript one.
            if (onHover && m.languages?.registerHoverProvider) {
              const language = e.getModel?.()?.getLanguageId?.() ?? "plaintext";
              hover.current = m.languages.registerHoverProvider(language, {
                provideHover: async (model, position) => {
                  const ask = hoverRef.current;
                  if (!ask) return null;
                  const word = model.getWordAtPosition?.(position)?.word;
                  if (!word) return null;
                  const answer = await ask(word);
                  if (!answer) return null;
                  return {
                    contents: [
                      { value: `\`${word}\` = \`${answer.value}\`` },
                      ...(answer.kind ? [{ value: `_${answer.kind}_` }] : []),
                    ],
                  };
                },
              });
            }
            drawBreakpoints();
          }}
          // **White code in a dark app glares.** Every other surface is themed
          // by variables on `:root[data-theme]`; Monaco paints itself and takes
          // a theme name, so it is the one surface that has to be told.
          theme={theme === "dark" ? "vs-dark" : "vs"}
          // **The editor is the point of this pane.** It was a fixed 24rem —
          // about twenty lines — with a permanent ask-bar underneath, so
          // reading a file meant scrolling a small window inside a large empty
          // one. It now takes the height it is given, and the pane gives it
          // what is left after the header.
          height="100%"
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
        {palBusy && (
          <p className="hint" role="status">
            {PAL_ACTION_LABELS[palAction]}: thinking…
          </p>
        )}
        {!palBusy && selection.trim() !== "" && (
          <p className="hint" role="status">
            Right-click asks about the selected code — clear the selection to
            ask about the whole file.
          </p>
        )}

        {palAnswer && palAnswer.blocked && (
          <BlockedNote blocked={palAnswer.blocked} what="guessing" />
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
