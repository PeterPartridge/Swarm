import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  attachTerminal,
  closeTerminal,
  openTerminal,
  resizeTerminal,
  writeTerminal,
  type Solution,
} from "../../lib/backend";

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
  active = true,
  keepAlive = false,
  adoptId = null,
}: {
  solution: Solution;
  /** When set, unmounting leaves the shell running. Debug uses this so a dev
   *  server survives leaving Build; the Code tab does not, because a terminal
   *  nobody can see and nobody asked to keep is a leak. */
  keepAlive?: boolean;
  /** An already-running shell to pick up instead of starting a new one. */
  adoptId?: string | null;
  /** A command line the AI panel wants run. Sent on the next render once a
   *  shell is open, then cleared by `onCommandSent`. */
  pendingCommand?: string | null;
  onCommandSent?: () => void;
  /** Lets the AI panel above know whether there is a shell to run in. */
  onOpenChange?: (open: boolean) => void;
  /** False while this panel is mounted but hidden — Debug keeps its shells
   *  alive behind other Build panes rather than killing a dev server every time
   *  somebody looks at a diff. A hidden element has no size, so xterm measures
   *  zero and stays that way until it is told to measure again on the way
   *  back. */
  active?: boolean;
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

      if (adoptId) {
        // Picking up a shell that has been running while nothing watched it.
        // Its recent output goes in first, so the panel opens on what has been
        // happening rather than on a blank box that reads as a failed start.
        const held = await attachTerminal(adoptId);
        sessionId.current = held.id;
        setShell(held.shell);
        if (held.replay) terminal.write(held.replay);
        await resizeTerminal(held.id, terminal.cols, terminal.rows);
      } else {
        const opened = await openTerminal(solution.id, terminal.cols, terminal.rows);
        sessionId.current = opened.id;
        setShell(opened.shell);
      }
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
  }, [solution.id, status, adoptId]);

  // A shell already running for this Solution is picked up without being asked
  // for: it is this panel's own process from before it unmounted, and making
  // somebody press Open to see something that never stopped would be strange.
  useEffect(() => {
    if (adoptId && status === "closed") void start();
  }, [adoptId, status, start]);

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
  const refit = useCallback(() => {
    fit.current?.fit();
    if (sessionId.current && term.current) {
      void resizeTerminal(sessionId.current, term.current.cols, term.current.rows);
    }
  }, []);

  useEffect(() => {
    if (status !== "open") return;
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [status, refit]);

  // Coming back from hidden is the same problem as a window resize: the panel
  // had no size while it was away, so xterm's idea of the width is stale.
  useEffect(() => {
    if (active && status === "open") refit();
  }, [active, status, refit]);

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
  //
  // Unless it was asked to keep it. Debug's shells are meant to outlive the
  // panel — that is the whole point of the registry — and they are findable
  // again through `list_terminals`, so leaving one running is a deliberate
  // handover rather than an orphan. The widget still goes; only the process
  // stays.
  const keepRef = useRef(keepAlive);
  keepRef.current = keepAlive;
  useEffect(() => {
    return () => {
      if (sessionId.current && !keepRef.current) void closeTerminal(sessionId.current);
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
