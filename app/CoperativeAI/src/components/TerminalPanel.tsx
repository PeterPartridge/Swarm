import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  closeTerminal,
  openTerminal,
  resizeTerminal,
  writeTerminal,
  type Solution,
} from "../lib/backend";

/** A real shell at the bottom of the Code tab.
 *
 *  xterm.js over a PTY, not a command box. That distinction is the whole point:
 *  a PTY means prompts, colour, Ctrl-C and full-screen TUIs all work, which is
 *  what lets Claude Code actually run in here rather than merely be handed off
 *  to.
 *
 *  xterm.js is loaded on demand, like Monaco — an editor and a terminal in the
 *  startup bundle would be paid for by everyone who never opens either.
 *
 *  Nothing is persisted. Scrollback lives in the widget and dies with it, which
 *  is what the page brief asks for: terminal output can contain anything
 *  somebody pastes. */
export default function TerminalPanel({
  solution,
  pendingCommand,
  onCommandSent,
  onOpenChange,
}: {
  solution: Solution;
  /** A command line the AI panel wants run. Sent on the next render once a
   *  shell is open, then cleared by `onCommandSent`. */
  pendingCommand?: string | null;
  onCommandSent?: () => void;
  /** Lets the AI panel above know whether there is a shell to run in. */
  onOpenChange?: (open: boolean) => void;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const term = useRef<{
    write: (d: string) => void;
    dispose: () => void;
    cols: number;
    rows: number;
  } | null>(null);
  const fit = useRef<{ fit: () => void } | null>(null);
  const sessionId = useRef<string | null>(null);
  const [status, setStatus] = useState<"closed" | "opening" | "open" | "ended">("closed");
  const [error, setError] = useState<string | null>(null);
  const [shell, setShell] = useState("");

  const start = useCallback(async () => {
    if (status === "opening" || status === "open") return;
    setStatus("opening");
    setError(null);
    try {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      await import("@xterm/xterm/css/xterm.css");

      const terminal = new Terminal({
        fontSize: 12,
        fontFamily: "ui-monospace, Consolas, monospace",
        theme: { background: "#111827", foreground: "#e5e7eb" },
        convertEol: false,
        cursorBlink: true,
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      if (!holder.current) return;
      terminal.open(holder.current);
      fitAddon.fit();

      term.current = terminal as unknown as typeof term.current;
      fit.current = fitAddon;

      const opened = await openTerminal(solution.id, terminal.cols, terminal.rows);
      sessionId.current = opened.id;
      setShell(opened.shell);
      setStatus("open");

      // Keystrokes go through as bytes: xterm hands over escape sequences for
      // the arrow keys and \x03 for Ctrl-C, and both must survive intact.
      terminal.onData((data: string) => {
        if (sessionId.current) void writeTerminal(sessionId.current, data);
      });
      terminal.focus();
    } catch (e) {
      setError(String(e));
      setStatus("closed");
    }
  }, [solution.id, status]);

  // Output arrives as events, because a shell speaks when it feels like it.
  useEffect(() => {
    const unlisten = listen<{ id: string; data: string }>("terminal-output", (event) => {
      if (event.payload.id === sessionId.current) term.current?.write(event.payload.data);
    });
    const unlistenClosed = listen<string>("terminal-closed", (event) => {
      if (event.payload === sessionId.current) {
        setStatus("ended");
        sessionId.current = null;
      }
    });
    return () => {
      void unlisten.then((off) => off());
      void unlistenClosed.then((off) => off());
    };
  }, []);

  // A shell that is not told its new size keeps wrapping at the old width.
  useEffect(() => {
    if (status !== "open") return;
    const onResize = () => {
      fit.current?.fit();
      if (sessionId.current && term.current) {
        void resizeTerminal(sessionId.current, term.current.cols, term.current.rows);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [status]);

  useEffect(() => {
    onOpenChange?.(status === "open");
  }, [status, onOpenChange]);

  // A command handed over by the AI panel. Typed into the shell rather than
  // executed behind it, so what ran is visible in the scrollback like anything
  // else somebody typed.
  useEffect(() => {
    if (!pendingCommand || status !== "open" || !sessionId.current) return;
    void writeTerminal(sessionId.current, `${pendingCommand}\r`);
    onCommandSent?.();
  }, [pendingCommand, status, onCommandSent]);

  // Closing the panel ends the shell: one orphan per open-and-close is a leak
  // that only shows up after an afternoon.
  useEffect(() => {
    return () => {
      if (sessionId.current) void closeTerminal(sessionId.current);
      term.current?.dispose();
    };
  }, []);

  async function stop() {
    if (sessionId.current) await closeTerminal(sessionId.current);
    sessionId.current = null;
    setStatus("ended");
  }

  return (
    <section className="terminal-panel" aria-label="Terminal">
      <div className="terminal-head">
        <strong>Terminal</strong>
        <span className="hint">
          {status === "open"
            ? `${shell} in ${solution.name}`
            : status === "ended"
              ? "the shell has ended"
              : `will open in ${solution.name}`}
        </span>
        {status !== "open" ? (
          <button onClick={start} disabled={status === "opening" || !solution.localPath}>
            {status === "opening" ? "Opening…" : status === "ended" ? "Reopen" : "Open terminal"}
          </button>
        ) : (
          <button onClick={stop}>Close shell</button>
        )}
      </div>

      {!solution.localPath && (
        <p className="hint">
          This Solution has no folder on this machine yet — point it at a working
          copy to open a terminal in it.
        </p>
      )}
      {error && <p role="alert">{error}</p>}

      {/* xterm draws into this; jsdom cannot, so tests never reach here. */}
      <div className="terminal-surface" ref={holder} />
    </section>
  );
}
