import { useCallback, useEffect, useState } from "react";
import {
  listWorkItems,
  prepareHandover,
  type Handover,
  type Solution,
  type WorkItem,
} from "../lib/backend";

export type AiChoice = "ollama" | "claudeCode";

/** Which agent is doing the work, beside the code.
 *
 *  The two are genuinely different shapes of thing, and the panel says so
 *  rather than presenting them as interchangeable engines:
 *
 *  **Ollama** answers inside the editor — explain, refactor, document, draft
 *  tests — through the Product's policy, the budget router and the ledger, and
 *  it never touches disk. It is metered because the app makes the call.
 *
 *  **Claude Code** is an agent that runs in the terminal and writes files
 *  itself. The app's job there is the brief: everything it knows about the work
 *  item, assembled and written into the working copy, so the agent starts
 *  informed. **No cost is shown for it, deliberately** — Claude Code bills
 *  against its own subscription, and any figure here would be one this app
 *  cannot see. */
export default function AiPanel({
  solution,
  productId,
  choice,
  onChoice,
  onRunInTerminal,
  terminalReady,
}: {
  solution: Solution;
  productId: number;
  choice: AiChoice;
  onChoice: (next: AiChoice) => void;
  /** Hands a command line to the terminal panel below. */
  onRunInTerminal: (command: string) => void;
  /** False when no shell is open yet, so the button can say why. */
  terminalReady: boolean;
}) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [itemId, setItemId] = useState<number | "">("");
  const [handover, setHandover] = useState<Handover | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    try {
      const all = await listWorkItems(productId);
      setItems(all);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    if (choice === "claudeCode") void loadItems();
  }, [choice, loadItems]);

  async function prepare() {
    if (itemId === "") return;
    setBusy(true);
    setNotice(null);
    try {
      setHandover(await prepareHandover(Number(itemId)));
      setError(null);
    } catch (e) {
      setHandover(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Sends the command to the shell. A deliberate press, never automatic:
   *  this starts an agent that writes files. */
  function run() {
    if (!handover) return;
    onRunInTerminal(handover.command);
    setNotice("Sent to the terminal below.");
  }

  return (
    <section className="ai-panel" aria-label="AI">
      <h3>AI</h3>

      <div className="ai-choice" role="radiogroup" aria-label="Which AI does the work">
        <label>
          <input
            type="radio"
            name="ai-choice"
            checked={choice === "ollama"}
            onChange={() => onChoice("ollama")}
          />{" "}
          Ollama
        </label>
        <label>
          <input
            type="radio"
            name="ai-choice"
            checked={choice === "claudeCode"}
            onChange={() => onChoice("claudeCode")}
          />{" "}
          Claude Code
        </label>
      </div>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {choice === "ollama" && (
        <p className="hint">
          Answers in the editor — explain, refactor, document, draft tests — on
          the open file, through this Product's AI policy and budget. It puts a
          revision in the buffer and never writes to disk; your save is the gate.
        </p>
      )}

      {choice === "claudeCode" && (
        <>
          <p className="hint">
            Runs in the terminal below and writes files itself. This app prepares
            the brief — everything it knows about the work item, written into{" "}
            {solution.name} — so the agent starts informed.
          </p>

          <label>
            Work item
            <select
              aria-label="Work item to hand over"
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value === "" ? "" : Number(e.target.value));
                setHandover(null);
              }}
            >
              <option value="">Choose a work item…</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>

          <button onClick={prepare} disabled={busy || itemId === ""}>
            {busy ? "Preparing…" : "Prepare brief"}
          </button>

          {handover && (
            <div className="ai-handover">
              <p className="hint">Brief written to {handover.briefPath}</p>
              <code>{handover.command}</code>
              <button onClick={run} disabled={!terminalReady}>
                Run in terminal
              </button>
              {!terminalReady && (
                <p className="hint">Open the terminal below first.</p>
              )}
              {/* The standing rule, stated where the decision is made. */}
              <p className="hint">
                No cost is shown for this run. Claude Code bills against its own
                subscription, so any figure here would be one this app cannot see.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
