import { useCallback, useEffect, useState } from "react";
import {
  lifecycleGates,
  listLifecycleSteps,
  setLifecycleSteps,
  type LifecycleGate,
  type LifecycleStep,
} from "../../lib/backend";

/** The three handovers, and the checklist each team writes for itself.
 *
 *  **The gates are the framework; the steps are yours.** Product → Develop →
 *  QA is the shape this whole app is built on, so the three are fixed. What a
 *  team does before letting go of an item is not: "spike the API" and "signed
 *  off by legal" are both right answers, and an app that shipped a default list
 *  would be telling people how to work. Every list starts empty and says so.
 *
 *  **Written here, in Rules, with the rest of the standing direction.** They
 *  are the same kind of thing as the Developer Rules — what everybody agrees to
 *  before the work starts — and they are read on every work item afterwards. */
export default function LifecycleSteps({ productId }: { productId: number }) {
  const [gates, setGates] = useState<LifecycleGate[]>([]);
  const [steps, setSteps] = useState<LifecycleStep[]>([]);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedGates, loadedSteps] = await Promise.all([
        lifecycleGates(),
        listLifecycleSteps(productId),
      ]);
      setGates(loadedGates);
      setSteps(loadedSteps);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const inGate = (gate: string) =>
    steps.filter((s) => s.gate === gate).sort((a, b) => a.position - b.position);

  /// The list is sent whole every time — adding, removing and reordering are
  /// all "here is the list now". The backend matches by name, so a step that
  /// survives keeps the ticks already against it.
  async function save(gate: string, names: string[]) {
    try {
      await setLifecycleSteps(productId, gate, names);
      await refresh();
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function add(gate: string) {
    const name = (typed[gate] ?? "").trim();
    if (name === "") return;
    setTyped({ ...typed, [gate]: "" });
    await save(gate, [...inGate(gate).map((s) => s.name), name]);
  }

  return (
    <section className="lifecycle-steps" aria-label="Steps a work item goes through">
      <header>
        <h3>Steps a work item goes through</h3>
        <p className="hint">
          Three handovers, and what has to be true before each one. Product sees
          all of them on an item; Develop and QA see the list they own.
        </p>
      </header>

      {error && <p role="alert">{error}</p>}

      {gates.map((gate) => {
        const mine = inGate(gate.id);
        return (
          <div key={gate.id} className="lifecycle-gate" role="group" aria-label={gate.label}>
            <div className="lifecycle-gate-head">
              <strong>{gate.label}</strong>
              <span className="hint">
                {gate.owner === "product"
                  ? "Product ticks these"
                  : gate.owner === "develop"
                    ? "Develop ticks these"
                    : "QA ticks these"}
              </span>
            </div>

            {mine.length === 0 ? (
              <p className="hint">No steps yet — nothing has to happen before this handover.</p>
            ) : (
              <ol className="lifecycle-list">
                {mine.map((s, i) => (
                  <li key={s.id}>
                    <span>{s.name}</span>
                    <span className="row-actions">
                      {/* Up and down rather than drag: a checklist is read in
                          order, and two buttons work with a keyboard. */}
                      <button
                        aria-label={`Move ${s.name} up`}
                        className="link-button"
                        disabled={i === 0}
                        onClick={() => {
                          const names = mine.map((x) => x.name);
                          [names[i - 1], names[i]] = [names[i], names[i - 1]];
                          void save(gate.id, names);
                        }}
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`Move ${s.name} down`}
                        className="link-button"
                        disabled={i === mine.length - 1}
                        onClick={() => {
                          const names = mine.map((x) => x.name);
                          [names[i], names[i + 1]] = [names[i + 1], names[i]];
                          void save(gate.id, names);
                        }}
                      >
                        ↓
                      </button>
                      <button
                        aria-label={`Remove ${s.name}`}
                        className="link-button"
                        onClick={() =>
                          void save(
                            gate.id,
                            mine.filter((x) => x.id !== s.id).map((x) => x.name),
                          )
                        }
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <div className="lifecycle-add">
              <input
                aria-label={`A step ${gate.label.replace(/^Before /, "before ")}`}
                placeholder="what has to be true"
                value={typed[gate.id] ?? ""}
                onChange={(e) => setTyped({ ...typed, [gate.id]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void add(gate.id);
                }}
              />
              <button onClick={() => void add(gate.id)}>Add</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
