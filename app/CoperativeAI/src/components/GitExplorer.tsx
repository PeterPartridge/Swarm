import { useCallback, useEffect, useState } from "react";
import { productGitOverview, type SolutionRepo } from "../lib/backend";
import MergeConflictView from "./MergeConflictView";

/** Every Solution's repository at once: branch, drift from its upstream, what
 *  has changed, and anything git could not merge.
 *
 *  A Solution with no folder, or a folder that is not a repository, reports why
 *  on its own row and the rest still work — a cross-Solution view that blanks
 *  when one entry is unlinked is useless in exactly the situation it is for. */
export default function GitExplorer({ productId }: { productId: number }) {
  const [repos, setRepos] = useState<SolutionRepo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ solutionId: number; path: string } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      setRepos(await productGitOverview(productId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totalConflicts = repos.reduce(
    (n, r) => n + (r.status?.files.filter((f) => f.conflicted).length ?? 0),
    0,
  );

  return (
    <section className="develop-card" aria-label="Git">
      <h2>Git</h2>
      <p className="hint">
        Where every Solution stands: its branch, how far it has drifted, and what
        is uncommitted.
      </p>

      <div className="git-actions">
        <button onClick={refresh}>Refresh</button>
        {totalConflicts > 0 && (
          <span className="git-conflict-count">
            {totalConflicts} file{totalConflicts === 1 ? "" : "s"} need resolving
          </span>
        )}
      </div>

      {error && <p role="alert">{error}</p>}
      {repos.length === 0 && !error && <p>No Solutions in this Product yet.</p>}

      <ul className="git-repos">
        {repos.map((repo) => (
          <li key={repo.solutionId} className="git-repo">
            <div className="git-repo-head">
              <strong>{repo.name}</strong>
              {repo.status && (
                <>
                  <span className="git-branch">{repo.status.branch}</span>
                  {repo.status.upstream ? (
                    <span className="git-drift">
                      {repo.status.ahead > 0 && `↑${repo.status.ahead}`}
                      {repo.status.behind > 0 && ` ↓${repo.status.behind}`}
                      {repo.status.ahead === 0 && repo.status.behind === 0 && "in step"}
                    </span>
                  ) : (
                    <span className="git-drift hint">no upstream</span>
                  )}
                  {repo.status.merging && (
                    <span className="git-merging">merge in progress</span>
                  )}
                </>
              )}
            </div>

            {repo.unavailable && <p className="hint">{repo.unavailable}</p>}

            {repo.status && repo.status.files.length === 0 && (
              <p className="hint">Nothing uncommitted.</p>
            )}

            {repo.status && repo.status.files.length > 0 && (
              <ul className="git-files">
                {repo.status.files.map((file) => (
                  <li
                    key={file.path}
                    className={file.conflicted ? "git-file conflicted" : "git-file"}
                  >
                    <span className={`git-status ${file.status}`}>{file.status}</span>
                    <span className="git-path">{file.path}</span>
                    {file.staged && <span className="git-staged">staged</span>}
                    {file.conflicted && (
                      <button
                        aria-label={`Resolve ${file.path} in ${repo.name}`}
                        onClick={() =>
                          setConflict({ solutionId: repo.solutionId, path: file.path })
                        }
                      >
                        Resolve
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {conflict && (
        <MergeConflictView
          solutionId={conflict.solutionId}
          path={conflict.path}
          onClose={() => {
            setConflict(null);
            void refresh();
          }}
        />
      )}
    </section>
  );
}
