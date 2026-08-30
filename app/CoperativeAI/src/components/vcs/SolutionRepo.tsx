import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createSolutionRepo,
  githubStatus,
  initSolutionRepo,
  linkSolutionRepo,
  setSolutionPath,
  solutionGitState,
  type Solution,
  type SolutionGitState,
} from "../../lib/backend";
import FolderField from "../common/FolderField";

/** One Solution's git situation, and every way out of it.
 *
 *  **Two questions, not one.** Where the code lives on this machine and what is
 *  on GitHub are separate, and this panel used to know only the second — so a
 *  folder that was not a repository read as "No repository linked", and linking
 *  one would not have fixed it. `…\hello-world is not a git repository` was a
 *  dead end inside the app: every route out of it (status, worktree, run)
 *  refused for the same reason and none of them offered `git init`.
 *
 *  So the local folder comes first, because nothing downstream works without
 *  it, and the three states it can be in get three different sentences:
 *  no folder, a folder that is not a repository, and a repository with nothing
 *  committed — which a run still cannot branch from.
 *
 *  **It loads its own state.** That is what lets it be dropped wherever a
 *  Solution is being looked at — the Solutions list, a work item's plan, the
 *  Map's inspector — rather than each screen learning to fetch and thread it. */
export default function SolutionRepo({
  solution,
  githubConnected,
  onChange,
}: {
  solution: Solution;
  /** Passed by screens that already read it; loaded here when they have not. */
  githubConnected?: boolean;
  onChange: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"none" | "link" | "create">("none");
  const [url, setUrl] = useState("");
  const [repoName, setRepoName] = useState(solution.name);
  const [priv, setPriv] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<SolutionGitState | null>(null);
  const [connected, setConnected] = useState(githubConnected ?? false);

  const load = useCallback(async () => {
    try {
      // `?? null` rather than trusting the reply: this panel is mounted in five
      // places, and one of them handing it nothing must leave it saying "still
      // reading" rather than taking the screen down with it.
      setState((await solutionGitState(solution.id)) ?? null);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [solution.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (githubConnected !== undefined) {
      setConnected(githubConnected);
      return;
    }
    void githubStatus()
      .then((s) => setConnected(s.connected))
      .catch(() => setConnected(false));
  }, [githubConnected]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode("none");
      await load();
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
    // Kept and shown: creating now also wires `origin` and pushes, and any of
    // the three can succeed while a later one does not. The sentence says how
    // far it got, which is the difference between "try again" and "it worked".
    await run(async () =>
      setNotice(
        await createSolutionRepo({
          solutionId: solution.id,
          repoName: repoName.trim(),
          private: priv,
          description: `Repository for ${solution.name}`,
        }),
      ),
    );
  }

  async function onInit() {
    // Its own words, kept: "nothing was committed: Author identity unknown" is
    // the one failure people cannot guess their way out of.
    await run(async () => setNotice(await initSolutionRepo(solution.id)));
  }

  const linked = state?.githubUrl ?? solution.githubUrl;
  const visibility = state?.githubVisibility ?? solution.githubVisibility;

  return (
    // <section>, not <div>: an aria-label on a div names nothing a screen
    // reader can find, and this panel is looked up by name in four places.
    <section className="solution-repo" aria-label={`Repository for ${solution.name}`}>
      {/* The folder first: a repository on GitHub is no use to a run that
          cannot make a worktree here. */}
      <span className="repo-local">
        {state === null ? (
          "Reading the folder…"
        ) : state.localPath === null ? (
          <span className="warn">
            No folder on this machine yet, so there is nothing to make a
            checkout from. Point it at one below, or create the project from a
            starter in Develop → Solutions.
          </span>
        ) : state.isRepo && state.hasCommit ? (
          <>
            A git repository, on {state.branch || "an unnamed branch"}.{" "}
            <span className="card-mono">{state.localPath}</span>
          </>
        ) : state.isRepo ? (
          <span className="warn">
            A git repository with nothing committed yet — a run has no commit to
            branch from.
          </span>
        ) : (
          <span className="warn">
            <span className="card-mono">{state.localPath}</span> is not a git
            repository, so no agent can be given a checkout of it.
          </span>
        )}
      </span>

      {/* **The fix beside the sentence that names the problem.** "Execute
          failed: 'Shop API' has no folder on this machine" was true, and said
          in a panel that could do nothing about it — so the next move was to go
          and find the screen that could. This is that screen now. Offered while
          there is a folder too: pointing a Solution somewhere else is how a
          repository moved on disk gets reconnected. */}
      <FolderField
        label={state?.localPath ? "Move it to" : "Folder on this machine"}
        value={state?.localPath ?? ""}
        onChange={(path) => void run(() => setSolutionPath(solution.id, path))}
      />

      {state?.localPath && !(state.isRepo && state.hasCommit) && (
        <button
          aria-label={`Make ${solution.name} a git repository`}
          disabled={busy}
          onClick={() => void onInit()}
        >
          {busy ? "Working…" : state.isRepo ? "Make the first commit" : "Make it a git repository"}
        </button>
      )}

      {linked ? (
        <span className="repo-linked">
          Repo:{" "}
          <a href={linked} target="_blank" rel="noreferrer">
            {linked}
          </a>
          {visibility ? ` (${visibility})` : ""} —{" "}
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
          disabled={!connected}
          title={connected ? "" : "Connect GitHub in Admin to create repositories"}
          onClick={() => setMode(mode === "create" ? "none" : "create")}
        >
          Create new
        </button>
      </span>

      {!connected && (
        <span className="hint">
          Creating a repository needs GitHub connected, in Admin. Linking one by
          URL does not.
        </span>
      )}

      {error && <p role="alert">{error}</p>}
      {notice && <p className="note" role="status">{notice}</p>}

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
          {/* **Two radios, not a "Private" tick.** Publishing is the
              consequential half and a checkbox says it in the negative — you
              read "private" and have to work out that clearing it publishes.
              Private stays the default, because a repository nobody chose to
              publish should not be. */}
          <fieldset className="repo-visibility">
            <legend>Who can see it</legend>
            <label>
              <input
                type="radio"
                name={`visibility-${solution.id}`}
                checked={priv}
                onChange={() => setPriv(true)}
              />
              Private
            </label>
            <label>
              <input
                type="radio"
                name={`visibility-${solution.id}`}
                checked={!priv}
                onChange={() => setPriv(false)}
              />
              Public
            </label>
          </fieldset>
          <button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </form>
      )}
    </section>
  );
}
