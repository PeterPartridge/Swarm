import { useCallback, useEffect, useState } from "react";
import {
  lifecycleGates,
  listLifecycleSteps,
  listWorkItemSteps,
  setWorkItemStep,
  type LifecycleGate,
  type LifecycleStep,
} from "../../lib/backend";

/** Where one work item has got to, shown to whoever is looking at it.
 *
 *  **Product sees the whole life; Develop and QA see their bit.** Not as a
 *  permission — this app has no security, and its roles have never pretended to
 *  be any — but because a checklist you cannot act on is noise on the screen of
 *  somebody trying to work. Product owns the journey end to end and is the one
 *  place it reads as a journey; the other two get the handover they are
 *  responsible for.
 *
 *  **A gate is clear when every step in it is ticked**, and that is a count of
 *  rows rather than a state anybody sets. There is no "mark as ready" button on
 *  purpose: a status somebody can set independently of the checklist is a
 *  second answer to the same question, and the two would disagree by Friday. */
export default function WorkItemLifecycle({
  workItemId,
  productId,
  area,
  onChanged,
}: {
  workItemId: number;
  productId: number;
  /** "product" sees every gate; "develop" and "test" see the one they own. */
  area: "product" | "develop" | "test";
  onChanged?: () => void;
}) {
  const [gates, setGates] = useState<LifecycleGate[]>([]);
  const [steps, setSteps] = useState<LifecycleStep[]>([]);
  const [done, setDone] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedGates, loadedSteps, loadedDone] = await Promise.all([
        lifecycleGates(),
        listLifecycleSteps(productId),
        listWorkItemSteps(workItemId),
      ]);
      setGates(loadedGates);
      setSteps(loadedSteps);
      setDone(loadedDone);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId, workItemId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function tick(step: LifecycleStep, next: boolean) {
    // Moved before the write so the box responds to the press rather than to
    // the round trip; a failed write puts it back by re-reading.
    setDone(next ? [...done, step.id] : done.filter((id) => id !== step.id));
    try {
      await setWorkItemStep(workItemId, step.id, next);
      await refresh();
      onChanged?.();
    } catch (e) {
      setError(String(e));
      await refresh();
    }
  }

  const mine = gates.filter((g) => area === "product" || g.owner === area);
  const nothingDefined =
    mine.every((g) => steps.filter((s) => s.gate === g.id).length === 0);

  return (
    <section className="work-lifecycle" aria-label="Where this has got to">
      {error && <p role="alert">{error}</p>}

      {nothingDefined ? (
        <p className="hint">
          {/* Each area writes its own list, so each is sent to its own screen:
              one that said "Develop → Rules" to everybody would be sending two
              teams to a screen that no longer holds their checklist. */}
          No steps are defined for this yet. Write them under "Steps a work item
          goes through", in{" "}
          {area === "product"
            ? "Product → Strategy"
            : area === "develop"
              ? "Develop → Rules"
              : "the Testing Strategy"}
          .
        </p>
      ) : (
        mine.map((gate) => {
          const inGate = steps
            .filter((s) => s.gate === gate.id)
            .sort((a, b) => a.position - b.position);
          if (inGate.length === 0) return null;
          const ticked = inGate.filter((s) => done.includes(s.id)).length;
          const clear = ticked === inGate.length;
          return (
            <div key={gate.id} className="lifecycle-progress">
              <div className="lifecycle-progress-head">
                <strong>{gate.label}</strong>
                <span className={clear ? "chip ok-chip" : "chip warn-chip"}>
                  {/* The count first, because it is the fact. The word after it
                      is what the count means once it is complete. */}
                  {ticked} of {inGate.length}
                  {clear &&
                    (gate.id === "toDevelop"
                      ? " · Ready for Develop"
                      : gate.id === "toTest"
                        ? " · Ready for QA"
                        : " · Ready to release")}
                </span>
              </div>
              <ul className="lifecycle-ticks">
                {inGate.map((s) => (
                  <li key={s.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={done.includes(s.id)}
                        onChange={(e) => void tick(s, e.target.checked)}
                      />
                      {s.name}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
