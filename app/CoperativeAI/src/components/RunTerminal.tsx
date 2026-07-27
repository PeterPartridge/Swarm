import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  closeTerminal,
  writeTerminal,
  type OpenedTerminal,
} from "../lib/backend";
import { invoke } from "@tauri-apps/api/core";

/** One agent's terminal, open in its own worktree.
 *
 *  A leaner sibling of `TerminalPanel`: it opens straight into a run's
 *  worktree (not the main checkout) and types the run's command in, because a
 *  run is prepared precisely so an agent can be started in it. Several of these
 *  are rendered at once by the runs panel — that is the "simultaneously".
 *
 *  Opening the shell in the worktree, not the Solution's main folder, is the
 *  isolation the whole feature rests on. It goes through `open_terminal_at`,
 *  which refuses any path that is not one of the Solution's own worktrees. */
export default function RunTerminal({
  solutionId,
  worktreePath,
  command,
  title,
  onClose,
}: {
  solutionId: number;
  worktreePath: string;
  command: string;
  title: string;
  onClose: () => void;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const term = useRef<{ write: (d: string) => void; dispose: () => void } | null>(null);
  const sessionId = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
        ]);
        await import("@xterm/xterm/css/xterm.css");
        if (disposed || !holder.current) return;

        const terminal = new Terminal({
          fontSize: 12,
          fontFamily: "ui-monospace, Consolas, monospace",
          theme: { background: "#141416", foreground: "#d4d4d4" },
          cursorBlink: true,
        });
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(holder.current);
        fitAddon.fit();
        term.current = terminal as unknown as typeof term.current;

        const opened: OpenedTerminal = await invoke("open_terminal_at", {
          solutionId,
          path: worktreePath,
          cols: terminal.cols,
          rows: terminal.rows,
        });
        sessionId.current = opened.id;
        setReady(true);

        terminal.onData((data: string) => {
          if (sessionId.current) void writeTerminal(sessionId.current, data);
        });
        terminal.focus();
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    })();
    return () => {
      disposed = true;
    };
  }, [solutionId, worktreePath]);

  // Output arrives as events, keyed by the session id.
  useEffect(() => {
    const unlisten = listen<{ id: string; data: string }>("terminal-output", (event) => {
      if (event.payload.id === sessionId.current) term.current?.write(event.payload.data);
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  // The command is typed in once the shell is open — a deliberate visible line
  // in the scrollback, not something run behind the panel.
  useEffect(() => {
    if (ready && sessionId.current) {
      void writeTerminal(sessionId.current, `${command}\r`);
    }
  }, [ready, command]);

  // Closing ends the shell: one orphan per run is a leak after an afternoon.
  useEffect(() => {
    return () => {
      if (sessionId.current) void closeTerminal(sessionId.current);
      term.current?.dispose();
    };
  }, []);

  return (
    <section className="run-terminal" aria-label={`Terminal for ${title}`}>
      <div className="run-terminal-head">
        <strong>{title}</strong>
        <button
          onClick={() => {
            if (sessionId.current) void closeTerminal(sessionId.current);
            onClose();
          }}
        >
          Close
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="terminal-surface" ref={holder} />
    </section>
  );
}
