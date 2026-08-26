import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import TerminalPanel from "./TerminalPanel";
import type { Solution } from "../../lib/backend";

/** One line the debugger printed, and where it came from.
 *
 *  A log point's output carries a source and a line — that is how DAP marks
 *  output produced at a known place — and the adapter's own chatter carries
 *  neither. Running the two together made a message printed by a breakpoint
 *  indistinguishable from the debugger clearing its throat. */
interface Line {
  at: number;
  text: string;
  from?: string;
}

interface DebugEvent {
  session: string;
  event: string;
  body: Record<string, unknown> | null;
}

/** The console: the Solution's shell, and what the debugger printed.
 *
 *  **The same component docked and detached.** It is rendered under the editor
 *  in the main window and again inside the pulled-out window, because two
 *  copies of "what the console is" would drift and the drifting one would be
 *  the one on the other monitor that nobody is looking at while they work.
 *
 *  The debugger's output is picked up from the app-wide `debug-event` stream
 *  rather than passed in, which is what lets it work in a window that has no
 *  debug session of its own. */
export default function ConsolePanes({
  solution,
  adoptId,
  active = true,
  pendingCommand,
  onCommandSent,
  onOpenChange,
  /** Said in the detached window: the stream has no replay, so a window opened
   *  now starts from the next line rather than showing what was already
   *  printed. Claiming otherwise would be worse than saying it. */
  fromNow = false,
}: {
  solution: Solution;
  adoptId?: string | null;
  active?: boolean;
  pendingCommand?: string | null;
  onCommandSent?: () => void;
  onOpenChange?: (open: boolean, terminalId: string | null) => void;
  fromNow?: boolean;
}) {
  const [output, setOutput] = useState<Line[]>([]);

  useEffect(() => {
    const unlisten = listen<DebugEvent>("debug-event", (message) => {
      const { event, body } = message.payload;
      if (event !== "output") return;
      const text = String(body?.output ?? "");
      if (text.trim() === "") return;
      const where = body?.source as { path?: string } | undefined;
      const line = body?.line as number | undefined;
      const from =
        where?.path && line ? `${where.path.split(/[/\\]/).pop()}:${line}` : undefined;
      // Capped, because a chatty program will print for as long as it runs and
      // an unbounded list is a memory leak with a scrollbar.
      setOutput((prev) => [...prev.slice(-200), { at: Date.now(), text, from }]);
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  return (
    <div className="console-panes">
      <TerminalPanel
        solution={solution}
        active={active}
        // The shell outlives this panel: it is the Solution's process, not this
        // component's, and closing a console must not kill a dev server.
        keepAlive
        adoptId={adoptId ?? null}
        pendingCommand={pendingCommand ?? null}
        onCommandSent={onCommandSent}
        onOpenChange={(open) => onOpenChange?.(open, null)}
      />

      <div className="console-debug" aria-label="Debugger output">
        <span className="palette-label">Debugger output</span>
        {output.length === 0 ? (
          <p className="hint">
            {fromNow
              ? "Nothing yet. This window shows what is printed from now on — what came before it opened is in the main window."
              : "Nothing printed yet. Log points and the program's own output appear here."}
          </p>
        ) : (
          output.map((l, i) => (
            <div className="output-line" key={`${l.at}-${i}`}>
              {/* Which line printed it, where the adapter said — otherwise a
                  log point's message and the debugger's own chatter look
                  exactly alike. */}
              {l.from && <span className="output-from card-mono">{l.from}</span>}
              <span className="output-text">{l.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
