import { useCallback, useEffect, useState } from "react";
import {
  lifecycleGates,
  listLifecycleSteps,
  setLifecycleSteps,
  type LifecycleGate,
  type LifecycleStep,
} from "../../lib/backend";

/** The checklist a team writes for its own handover.
 *
 *  **The gates are the framework; the steps are yours.** Product → Develop →
 *  QA is the shape this whole app is built on, so the three are fixed. What a
 *  team does before letting go of an item is not: "spike the API" and "signed
 *  off by legal" are both right answers, and an app that shipped a default list
 *  would be telling people how to work. Every list starts empty and says so.
 *
 *  **Each list is written in the area that owns it**, beside that team's own
 *  strategy: Product writes what it does before handing over, Develop writes
 *  what it does before QA, QA writes what it does before release. One screen
 *  holding all three made two of them somebody else's business — the same
 *  reason the panel on a work item shows a team only its own gate. Given no
 *  `owner`, every gate shows. */
export default function LifecycleSteps({
  productId,
  owner,
}: {
  productId: number;
  /** Show only the gate this area owns: "product", "develop" or "test". */
  owner?: string;
}) {
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
          {owner === undefined
            ? "Three handovers, and what has to be true before each one."
            : "What has to be true before this handover."}{" "}
          Product sees every gate on an item; Develop and QA see the one they
          own.
        </p>
      </header>

      {error && <p role="alert">{error}</p>}

      {gates
        .filter((gate) => owner === undefined || gate.owner === owner)
        .map((gate) => {
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
