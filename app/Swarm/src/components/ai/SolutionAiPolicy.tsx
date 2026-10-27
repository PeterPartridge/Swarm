import { useCallback, useEffect, useState } from "react";
import {
  clearSolutionPolicy,
  getSolutionPolicy,
  setSolutionPolicy,
  type Solution,
  type SolutionPolicy,
} from "../../lib/backend";

/** One Solution's override of its Product's AI policy.
 *
 *  **Absent is "follows the Product", not "denied".** Most Products want one
 *  answer for all their repositories; a row exists here because somebody
 *  decided this one is different — usually more restrictive, which is why the
 *  override is total rather than per-flag. Reading two rows to work out what is
 *  permitted would be worse than reading one.
 *
 *  Permission moved up from the work item on 2026-08-21: it was granted per
 *  item, so a new item was denied until somebody permitted it individually and
 *  permission had to be granted again forever. */
export default function SolutionAiPolicy({ solution }: { solution: Solution }) {
  const [policy, setPolicy] = useState<SolutionPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPolicy(await getSolutionPolicy(solution.id));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [solution.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(changes: Partial<SolutionPolicy>) {
    const next: SolutionPolicy = {
      solutionId: solution.id,
      allowRead: false,
      allowEdit: false,
      allowGenerateTests: false,
      providerId: null,
      effortTier: "low",
      ...policy,
      ...changes,
    };
    setPolicy(next);
    try {
      await setSolutionPolicy(next);
      setError(null);
    } catch (e) {
      setError(String(e));
      await refresh();
    }
  }

  async function onFollowProduct() {
    try {
      await clearSolutionPolicy(solution.id);
      setPolicy(null);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="solution-policy" aria-label={`AI policy for ${solution.name}`}>
      {error && <p role="alert">{error}</p>}

      {policy === null ? (
        <p className="hint">
          Follows this Product's policy.{" "}
          <button
            aria-label={`Override the policy for ${solution.name}`}
            onClick={() => void save({})}
          >
            Override for this Solution
          </button>
        </p>
      ) : (
        <>
          {/* Said plainly: an override replaces the Product's answer rather
              than adding to it, so somebody reading one row knows the whole
              answer for this repository. */}
          <p className="hint">
            Overriding — this replaces the Product's policy for{" "}
            <strong>{solution.name}</strong> entirely.
          </p>
          <label className="switch">
            <input
              type="checkbox"
              aria-label={`Allow AI to read ${solution.name}`}
              checked={policy.allowRead}
              onChange={(e) => void save({ allowRead: e.target.checked })}
            />
            Allow reading
          </label>
          <label className="switch">
            <input
              type="checkbox"
              aria-label={`Allow AI to change ${solution.name}`}
              checked={policy.allowEdit}
              onChange={(e) => void save({ allowEdit: e.target.checked })}
            />
            Allow changing code, plans and schemas
          </label>
          <label className="switch">
            <input
              type="checkbox"
              aria-label={`Allow AI to write tests for ${solution.name}`}
              checked={policy.allowGenerateTests}
              onChange={(e) => void save({ allowGenerateTests: e.target.checked })}
            />
            Allow writing tests
          </label>
          <button
            aria-label={`Follow the Product policy for ${solution.name}`}
            onClick={() => void onFollowProduct()}
          >
            Follow the Product instead
          </button>
        </>
      )}
    </div>
  );
}
