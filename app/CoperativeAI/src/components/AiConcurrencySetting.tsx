import { useEffect, useState } from "react";
import { getAiConcurrency, setAiConcurrency } from "../lib/backend";

/** How many AI calls may run at once.
 *
 *  In Admin, beside the budget, because it is the same kind of decision — about
 *  spend and load, not about any one Product. One at a time is the default: the
 *  safe answer, and the one that keeps a local model from thrashing.
 *
 *  The consequence of raising it is written under the control, not left to be
 *  discovered: with N in flight, a call can pass the budget gate on a spend
 *  figure the others are about to add to, so the limit is the amount the budget
 *  can be overshot by. */
export default function AiConcurrencySetting() {
  const [limit, setLimit] = useState(1);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getAiConcurrency()
      .then((c) => setLimit(c.limit))
      .catch((e) => setError(String(e)));
  }, []);

  async function save(value: number) {
    try {
      await setAiConcurrency(value);
      setLimit(value);
      setSaved(true);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section className="admin-card" aria-label="AI concurrency">
      <h2>How many AI calls at once</h2>
      {error && <p role="alert">{error}</p>}
      <label>
        Run up to
        <input
          type="number"
          min={1}
          max={8}
          aria-label="AI calls at once"
          value={limit}
          onChange={(e) => void save(Number(e.target.value))}
        />
        at a time
      </label>
      <p className="hint">
        {limit === 1
          ? "One at a time — planning several work items queues them, and the budget check is exact."
          : `Up to ${limit} plan or design calls run together. A budget can then be overshot by at most ${
              limit - 1
            } call${limit - 1 === 1 ? "" : "s"}, because that many can pass the check before any of them is billed.`}
      </p>
      <p className="hint">
        Takes effect next launch — changing the limit under running work is a way
        to exceed the number you just set.
      </p>
      {saved && <p role="status">Saved.</p>}
    </section>
  );
}
