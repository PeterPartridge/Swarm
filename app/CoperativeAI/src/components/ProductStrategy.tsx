import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createDeliverable,
  deleteDeliverable,
  generateDeliverableWork,
  getStrategy,
  listDeliverables,
  listWorkItems,
  saveStrategy,
  TYPE_LABELS,
  type Deliverable,
  type WorkItem,
} from "../lib/backend";
import ProductAiPolicy from "./ProductAiPolicy";

const STRATEGY_FIELDS: { id: string; label: string }[] = [
  { id: "vision", label: "Vision — where is this Product going?" },
  { id: "goals", label: "Goals — what must it achieve?" },
  { id: "successMetrics", label: "Success metrics — how do we measure it?" },
];

/** The Product Strategy section: structured strategy fields, the Product's
 *  Deliverables, and a view of work items grouped by deliverable. */
export default function ProductStrategy({ productId }: { productId: number }) {
  const [strategy, setStrategy] = useState<Record<string, string>>({});
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [strategyJson, loadedDeliverables, loadedItems] = await Promise.all([
        getStrategy(productId, "product"),
        listDeliverables(productId),
        listWorkItems(productId),
      ]);
      try {
        setStrategy(JSON.parse(strategyJson) as Record<string, string>);
      } catch {
        setStrategy({});
      }
      setDeliverables(loadedDeliverables);
      setItems(loadedItems);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveField(id: string, value: string) {
    const next = { ...strategy, [id]: value };
    setStrategy(next);
    try {
      await saveStrategy(productId, "product", JSON.stringify(next));
      setSavedNote("Strategy saved.");
    } catch (e) {
      setError(String(e));
    }
  }

  async function onAddDeliverable(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createDeliverable({ productId, name, description });
      setName("");
      setDescription("");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function onDeleteDeliverable(id: number) {
    try {
      await deleteDeliverable(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  /** Asks the AI for the work that achieves a deliverable. Gated by the
   *  Product's AI policy — a denial comes back as a plain message. */
  async function onGenerate(d: Deliverable) {
    setGenerating(d.id);
    setError(null);
    setSavedNote(null);
    try {
      const created = await generateDeliverableWork(d.id);
      setSavedNote(
        created.length === 0
          ? `The AI suggested nothing new for ${d.name}.`
          : `Added ${created.length} item${created.length === 1 ? "" : "s"} to ${d.name}.`,
      );
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(null);
    }
  }

  const itemsFor = (deliverableId: number | null) =>
    items.filter((i) => i.deliverableId === deliverableId);

  return (
    <section className="product-strategy" aria-label="Product Strategy">
      <h2>Strategy</h2>
      {error && <p role="alert">{error}</p>}
      {savedNote && <p role="status">{savedNote}</p>}

      <div className="strategy-fields">
        {STRATEGY_FIELDS.map((f) => (
          <label key={f.id}>
            {f.label}
            <textarea
              aria-label={f.label}
              defaultValue={strategy[f.id] ?? ""}
              onBlur={(e) => saveField(f.id, e.target.value)}
            />
          </label>
        ))}
      </div>

      <ProductAiPolicy productId={productId} />

      <div className="deliverables" aria-label="Deliverables">
        <h3>Deliverables</h3>
        <form onSubmit={onAddDeliverable} aria-label="Add deliverable">
          <input
            aria-label="Deliverable name"
            placeholder="Deliverable name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            aria-label="Deliverable description"
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button type="submit">Add deliverable</button>
        </form>

        {deliverables.map((d) => (
          <section key={d.id} className="deliverable-group" aria-label={`Deliverable ${d.name}`}>
            <header>
              <strong>{d.name}</strong>
              {d.description && <span className="deliverable-desc"> — {d.description}</span>}
              <button
                aria-label={`Generate work for ${d.name}`}
                disabled={generating === d.id}
                onClick={() => onGenerate(d)}
              >
                {generating === d.id ? "Generating…" : "Generate work"}
              </button>
              <button
                aria-label={`Delete deliverable ${d.name}`}
                onClick={() => onDeleteDeliverable(d.id)}
              >
                Delete
              </button>
            </header>
            <ul>
              {itemsFor(d.id).map((i) => (
                <li key={i.id}>
                  {TYPE_LABELS[i.itemType] ?? i.itemType}: {i.title}
                </li>
              ))}
              {itemsFor(d.id).length === 0 && <li className="empty">No work items yet.</li>}
            </ul>
          </section>
        ))}

        <section className="deliverable-group" aria-label="No deliverable">
          <header>
            <strong>No deliverable</strong>
          </header>
          <ul>
            {itemsFor(null).map((i) => (
              <li key={i.id}>
                {TYPE_LABELS[i.itemType] ?? i.itemType}: {i.title}
              </li>
            ))}
            {itemsFor(null).length === 0 && <li className="empty">Everything is assigned to a deliverable.</li>}
          </ul>
        </section>
      </div>
    </section>
  );
}
