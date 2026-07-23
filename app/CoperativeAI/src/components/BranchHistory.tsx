import { useCallback, useEffect, useState } from "react";
import { branchHistory, type Commit } from "../lib/backend";

/** A commit with the lane it was drawn in. */
interface Placed {
  commit: Commit;
  lane: number;
}

/** Assigns each commit a lane, so branches read as parallel lines.
 *
 *  The rule is the one every git viewer uses: a commit takes the lane its first
 *  waiting child left for it, and anything with no lane waiting starts a new
 *  one. Because `--date-order` hands them to us newest-first, walking in that
 *  order means a commit's children are always seen before it — which is what
 *  makes a single pass enough.
 *
 *  A merge's *second* parent is what opens a new lane, and that is the whole
 *  point of the picture: it is the moment a branch left, drawn as the moment it
 *  came back.
 */
export function assignLanes(commits: Commit[]): Placed[] {
  // lane index → the commit id that lane is currently waiting for
  const lanes: (string | null)[] = [];
  const placed: Placed[] = [];

  for (const commit of commits) {
    let lane = lanes.findIndex((waiting) => waiting === commit.id);
    if (lane === -1) {
      lane = lanes.findIndex((waiting) => waiting === null);
      if (lane === -1) {
        lanes.push(null);
        lane = lanes.length - 1;
      }
    }
    placed.push({ commit, lane });

    // This lane now continues to the first parent; the others get lanes of
    // their own, which is what draws a merge as two lines becoming one.
    lanes[lane] = commit.parents[0] ?? null;
    for (const parent of commit.parents.slice(1)) {
      if (lanes.includes(parent)) continue;
      const free = lanes.findIndex((waiting) => waiting === null);
      if (free === -1) {
        lanes.push(parent);
      } else {
        lanes[free] = parent;
      }
    }
  }
  return placed;
}

const LANE_COLOURS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
];

function when(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
}

/** The branches, as a picture.
 *
 *  Drawn from `git log --all --date-order` rather than reimplementing history:
 *  git already knows the shape, and a second opinion here could only ever
 *  disagree with the Git tab beside it. */
export default function BranchHistory({
  solutionId,
  solutionName,
}: {
  solutionId: number;
  solutionName: string;
}) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setCommits(await branchHistory(solutionId, 120));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [solutionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const placed = assignLanes(commits);
  const laneCount = placed.reduce((n, p) => Math.max(n, p.lane + 1), 1);

  return (
    <section className="branch-history" aria-label={`Branch history for ${solutionName}`}>
      <div className="branch-head">
        <h3>Branches</h3>
        <button onClick={refresh} disabled={loading}>
          {loading ? "Reading…" : "Refresh"}
        </button>
      </div>

      {error && <p role="alert">{error}</p>}
      {!error && commits.length === 0 && !loading && (
        <p className="hint">No commits yet.</p>
      )}

      <ul className="commit-rows">
        {placed.map(({ commit, lane }) => (
          <li key={commit.id} className="commit-row">
            {/* One cell per lane, so a commit sits under its own line. */}
            <span
              className="commit-lanes"
              style={{ width: `${laneCount * 14}px` }}
              aria-hidden="true"
            >
              {Array.from({ length: laneCount }, (_, i) => (
                <span
                  key={i}
                  className={i === lane ? "lane-dot" : "lane-line"}
                  style={{
                    left: `${i * 14}px`,
                    background: LANE_COLOURS[i % LANE_COLOURS.length],
                  }}
                />
              ))}
            </span>

            <code className="commit-id">{commit.shortId}</code>
            {commit.refs.map((ref) => (
              <span key={ref} className="commit-ref">
                {ref}
              </span>
            ))}
            {commit.parents.length > 1 && <span className="commit-merge">merge</span>}
            <span className="commit-subject">{commit.subject}</span>
            <span className="commit-meta">
              {commit.author} · {when(commit.when)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
