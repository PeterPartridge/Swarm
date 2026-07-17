import { useState, type FormEvent } from "react";
import {
  createSolutionRepo,
  linkSolutionRepo,
  type Solution,
} from "../lib/backend";

/** Per-Solution GitHub repository controls: show the linked repo, or offer to
 *  link an existing one by URL or create a new one (private/public). Creating a
 *  repo needs a connected GitHub token; linking a URL does not. */
export default function SolutionRepo({
  solution,
  githubConnected,
  onChange,
}: {
  solution: Solution;
  githubConnected: boolean;
  onChange: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"none" | "link" | "create">("none");
  const [url, setUrl] = useState("");
  const [repoName, setRepoName] = useState(solution.name);
  const [priv, setPriv] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode("none");
      await onChange();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onLink(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    await run(() => linkSolutionRepo(solution.id, url.trim()));
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!repoName.trim()) return;
    await run(() =>
      createSolutionRepo({
        solutionId: solution.id,
        repoName: repoName.trim(),
        private: priv,
        description: `Repository for ${solution.name}`,
      }),
    );
  }

  return (
    <div className="solution-repo" aria-label={`Repository for ${solution.name}`}>
      {solution.githubUrl ? (
        <span className="repo-linked">
          Repo:{" "}
          <a href={solution.githubUrl} target="_blank" rel="noreferrer">
            {solution.githubUrl}
          </a>
          {solution.githubVisibility ? ` (${solution.githubVisibility})` : ""} —{" "}
          {solution.origin === "created" ? "created" : "imported"}
        </span>
      ) : (
        <span className="repo-none">No repository linked</span>
      )}

      <span className="repo-actions">
        <button
          aria-label={`Link a repo to ${solution.name}`}
          onClick={() => setMode(mode === "link" ? "none" : "link")}
        >
          Link existing
        </button>{" "}
        <button
          aria-label={`Create a repo for ${solution.name}`}
          disabled={!githubConnected}
          title={githubConnected ? "" : "Connect GitHub above to create repositories"}
          onClick={() => setMode(mode === "create" ? "none" : "create")}
        >
          Create new
        </button>
      </span>

      {error && <p role="alert">{error}</p>}

      {mode === "link" && (
        <form onSubmit={onLink} aria-label={`Link repository for ${solution.name}`}>
          <input
            aria-label="Repository URL"
            placeholder="https://github.com/owner/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            Link
          </button>
        </form>
      )}

      {mode === "create" && (
        <form onSubmit={onCreate} aria-label={`Create repository for ${solution.name}`}>
          <input
            aria-label="New repository name"
            placeholder="repo-name"
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
          />
          <label>
            <input
              type="checkbox"
              checked={priv}
              onChange={(e) => setPriv(e.target.checked)}
            />
            Private
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </form>
      )}
    </div>
  );
}
