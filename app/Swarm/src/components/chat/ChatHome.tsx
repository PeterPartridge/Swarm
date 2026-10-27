import { useEffect, useRef, useState, type FormEvent } from "react";
import { HIVES } from "@hives/registry";
import { chatTurn, listProducts, type ChatLine, type Product } from "../../lib/backend";
import { interpret, offersFor, type Workstation } from "../../lib/chatActions";

/** Where one action the AI asked for has got to. */
type ActionState = "running" | "waiting" | "done" | "failed" | "refused" | "declined";

type Entry =
  | { kind: "line"; line: ChatLine }
  | { kind: "notice"; text: string }
  | {
      kind: "action";
      id: number;
      describe: string;
      state: ActionState;
      note: string;
      run?: () => Promise<string>;
    };

interface ChatHomeProps {
  /** The shell's controls and the person's grants; the Product is chosen here. */
  workstation: Omit<Workstation, "productId">;
  hidden?: boolean;
}

/** The app's main screen: talk to the AI, and let it set the workstation up.
 *
 *  **The AI proposes; this screen decides.** Every action in a reply is
 *  checked against the list and the person's role (`interpret`). Layout runs
 *  at once, anything that writes the project's data waits for Confirm, and a
 *  refusal is shown with its reason rather than dropped — an action that
 *  silently did nothing would read as one that worked.
 *
 *  **About a Product,** because the Product's AI policy, budget and ledger are
 *  what every AI call in this app is held to. With no Product there is nothing
 *  to hold it to, so the chat says so rather than calling anyway. */
export default function ChatHome({ workstation, hidden }: ChatHomeProps) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [productId, setProductId] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);

  useEffect(() => {
    listProducts()
      .then((found) => {
        setProducts(found);
        setProductId((id) => id ?? found[0]?.id ?? null);
      })
      .catch(() => setProducts([]));
  }, []);

  const ws: Workstation | null = productId === null ? null : { ...workstation, productId };

  function settle(id: number, state: ActionState, note: string) {
    setEntries((all) =>
      all.map((e) => (e.kind === "action" && e.id === id ? { ...e, state, note, run: undefined } : e)),
    );
  }

  async function runAction(id: number, run: () => Promise<string>) {
    settle(id, "running", "");
    try {
      settle(id, "done", await run());
    } catch (e) {
      settle(id, "failed", String(e));
    }
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !ws || busy) return;
    const said: ChatLine = { from: "person", text };
    const history = [...entries.flatMap((en) => (en.kind === "line" ? [en.line] : [])), said];
    setEntries((all) => [...all, { kind: "line", line: said }]);
    setDraft("");
    setBusy(true);
    try {
      const hives = HIVES.filter((h) => ws.canAccessHive(h.id)).map((h) => h.id);
      const turn = await chatTurn(ws.productId, history, offersFor(ws), hives);
      const added: Entry[] = [{ kind: "line", line: { from: "ai", text: turn.reply } }];
      const now: [number, () => Promise<string>][] = [];
      for (const proposed of turn.actions) {
        const id = nextId.current++;
        const step = interpret(proposed, ws);
        if (step.kind === "refused") {
          added.push({ kind: "action", id, describe: proposed.name, state: "refused", note: step.reason });
        } else if (step.kind === "confirm") {
          added.push({ kind: "action", id, describe: step.describe, state: "waiting", note: "", run: step.run });
        } else {
          added.push({ kind: "action", id, describe: step.describe, state: "running", note: "" });
          now.push([id, step.run]);
        }
      }
      setEntries((all) => [...all, ...added]);
      for (const [id, run] of now) await runAction(id, run);
    } catch (err) {
      setEntries((all) => [...all, { kind: "notice", text: String(err) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="chat-home" aria-label="Chat" hidden={hidden}>
      {products !== null && products.length === 0 ? (
        <p className="chat-notice" role="status">
          The chat needs a Product to talk about — its AI policy is what allows the
          AI to answer. Make one in a Hive first.
        </p>
      ) : (
        <label className="chat-product">
          Chat about{" "}
          <select
            value={productId ?? ""}
            onChange={(e) => setProductId(Number(e.target.value))}
          >
            {(products ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="product-chat" role="log" aria-label="Conversation">
        {entries.map((entry, i) =>
          entry.kind === "line" ? (
            <div key={i} className={`chat-turn from-${entry.line.from}`}>
              <span className="chat-who">{entry.line.from === "ai" ? "AI" : "You"}</span>
              <p className={`chat-bubble ${entry.line.from === "ai" ? "chat-answered" : "chat-asked"}`}>
                {entry.line.text}
              </p>
            </div>
          ) : entry.kind === "notice" ? (
            <p key={i} className="chat-notice" role="status">
              {entry.text}
            </p>
          ) : (
            <ActionCard
              key={i}
              entry={entry}
              onConfirm={() => entry.run && runAction(entry.id, entry.run)}
              onCancel={() => settle(entry.id, "declined", "")}
            />
          ),
        )}
        {busy && <p className="chat-notice">Thinking…</p>}
      </div>

      <form className="chat-reply" onSubmit={onSend}>
        <input
          aria-label="Message"
          placeholder="Ask, or say how you want the workstation set up…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!ws}
        />
        <button type="submit" disabled={!ws || busy}>
          Send
        </button>
      </form>
    </section>
  );
}

/** One action the AI asked for, in words: what it is, and where it got to. */
function ActionCard({
  entry,
  onConfirm,
  onCancel,
}: {
  entry: Extract<Entry, { kind: "action" }>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { describe, state, note } = entry;
  return (
    <div className={`chat-action chat-action-${state}`} role="status">
      {state === "waiting" && entry.run ? (
        <>
          <span>{describe}?</span>
          <button aria-label={`Confirm: ${describe}`} onClick={onConfirm}>
            Confirm
          </button>
          <button aria-label={`Cancel: ${describe}`} onClick={onCancel}>
            Cancel
          </button>
        </>
      ) : state === "running" ? (
        <span>{describe}…</span>
      ) : state === "done" ? (
        <span>{note}</span>
      ) : state === "declined" ? (
        <span>Not done: {describe}</span>
      ) : state === "refused" ? (
        <span>
          Refused: {describe} — {note}
        </span>
      ) : (
        <span>
          Failed: {describe} — {note}
        </span>
      )}
    </div>
  );
}
