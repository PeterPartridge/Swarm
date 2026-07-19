import { useState } from "react";
import { prepareHandover, type Handover, type WorkItem } from "../lib/backend";

/** Hand a work item to a coding agent.
 *
 *  The app assembles everything it knows about the work into one brief and
 *  writes it into the working copy. It does not run the agent, and it shows no
 *  cost for the run — Claude Code bills against its own subscription, so any
 *  figure here would be one this app cannot see.
 *
 *  What it does own is the assembly, and that is where the tokens are actually
 *  saved: the expensive failure in agent coding is an agent told too little
 *  that builds the wrong thing and has to be paid for twice. */
export default function HandoverPanel({ item }: { item: WorkItem }) {
  const [handover, setHandover] = useState<Handover | null>(null);
  const [showBrief, setShowBrief] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPrepare() {
    setBusy(true);
    try {
      setHandover(await prepareHandover(item.id));
      setError(null);
    } catch (e) {
      setHandover(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!handover) return;
    try {
      await navigator.clipboard.writeText(handover.command);
      setCopied(true);
    } catch {
      // Clipboard permission is not worth an error banner — the command is on
      // screen and can be typed.
      setCopied(false);
    }
  }

  return (
    <section className="handover" aria-label={`Hand over ${item.title}`}>
      {error && <p role="alert">{error}</p>}
      <button
        aria-label={`Prepare ${item.title} for an agent`}
        onClick={onPrepare}
        disabled={busy}
      >
        {busy ? "Assembling…" : "Prepare for an agent"}
      </button>

      {handover && (
        <div className="handover-result">
          <p role="status">
            Brief written to <code>{handover.briefPath}</code> in the working
            copy.
          </p>
          <div className="handover-command">
            <code>{handover.command}</code>
            <button aria-label={`Copy the command for ${item.title}`} onClick={onCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {/* Said plainly rather than left to be assumed: this app is not
              running the agent and cannot see what the run costs. */}
          <p className="hint">
            Run that yourself. This app doesn't start the agent and can't see
            what the run costs — Claude Code bills separately from the AI budget
            here. When it's done, review the changes on the Solution.
          </p>
          <button
            className="diagram-toggle"
            aria-label={`${showBrief ? "Hide" : "Show"} the brief for ${item.title}`}
            onClick={() => setShowBrief((s) => !s)}
          >
            {showBrief ? "Hide the brief" : "Show the brief"}
          </button>
          {showBrief && (
            <pre className="handover-brief" aria-label={`Brief for ${item.title}`}>
              {handover.brief}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
