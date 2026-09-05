import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  branchHistory,
  createSolutionRepo,
  githubStatus,
  initSolutionRepo,
  linkSolutionRepo,
  setSolutionPath,
  solutionGitState,
  type Commit,
  type Solution,
  type SolutionGitState,
} from "../../lib/backend";
import FolderField from "../common/FolderField";

/** One of the three questions this panel answers: a line, and what is under it.
 *
 *  **Three lines, not three stacked blocks.** Everything the panel can do was
 *  visible at once — a folder field, an init button, a commit list, two forms —
 *  which is a lot of screen for something usually glanced at. Each question is
 *  a line carrying its own answer, and opens when it is the one being asked.
 *
 *  The summary is on the line itself, so the ordinary reason for looking — what
 *  branch am I on, has anything been committed, is this on GitHub — is answered
 *  without opening anything. */
function RepoGroup({
  title,
  summary,
  tone,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  /** "warn" when the summary is a problem, so the line reads as one. */
  tone?: "warn";
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="repo-group">
      <button
        type="button"
        className="repo-group-line"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="repo-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="palette-label">{title}</span>
        <span className={tone === "warn" ? "repo-summary warn" : "repo-summary"}>
          {summary}
        </span>
      </button>
      {open && <div className="repo-group-body">{children}</div>}
    </div>
  );
}

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
  runId,
  onChange,
}: {
  solution: Solution;
  /** The run being looked at, when one is. **Its branch and its commits are in
   *  its own checkout** — reading the Solution's folder said "on main, nothing
   *  changed" while an agent's work sat finished next door. */
  runId?: number;
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
  /// The last few commits, which this panel never showed. "The git section is
  /// missing commit messages" — it was: it could say which repository and which
  /// branch, and nothing about what had been done on it.
  const [commits, setCommits] = useState<Commit[]>([]);
  const [connected, setConnected] = useState(githubConnected ?? false);

  const load = useCallback(async () => {
    try {
      // `?? null` rather than trusting the reply: this panel is mounted in five
      // places, and one of them handing it nothing must leave it saying "still
      // reading" rather than taking the screen down with it.
      setState((await solutionGitState(solution.id, runId)) ?? null);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
    // Separately and never fatally: a repository with no commits yet is the
    // ordinary state of a folder somebody has just pointed at, and it must not
    // take the panel down with it.
    try {
      setCommits(await branchHistory(solution.id, 8, runId));
    } catch {
      setCommits([]);
    }
  }, [solution.id, runId]);

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

  /// What is wrong with the checkout, if anything. Drives both the summary on
  /// the line and whether it opens itself: a folder that is not a repository is
  /// the one state where the fix should be in front of somebody rather than
  /// behind a click.
  const trouble =
    state === null
      ? null
      : state.localPath === null
        ? "No folder on this machine yet"
        : !state.isRepo
          ? "Not a git repository"
          : !state.hasCommit
            ? "Nothing committed yet"
            : null;

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  // Opened for a problem, closed otherwise — unless somebody has said
  // otherwise, which their own click does.
  const isOpen = (id: string, fallback = false) => open[id] ?? fallback;

  const checkoutSummary =
    state === null
      ? "Reading…"
      : trouble !== null
        ? trouble
        : `on ${state.branch || "an unnamed branch"} · ${state.localPath}`;

  const commitSummary =
    commits.length === 0
      ? "No commits yet"
      : `${commits.length} shown · ${commits[0].subject}`;

  const githubSummary = linked
    ? `${linked.replace(/^https?:\/\/(www\.)?/, "")}${visibility ? ` (${visibility})` : ""}`
    : "Not linked";

  return (
    // <section>, not <div>: an aria-label on a div names nothing a screen
    // reader can find, and this panel is looked up by name in four places.
    <section className="solution-repo" aria-label={`Repository for ${solution.name}`}>
      {/* **Three questions, three groups.** This was one column of sentences,
          fields, buttons and two forms — everything the panel could do, in the
          order it had been written in, with no way to see at a glance which
          parts were about the folder here and which about GitHub. It answers
          three things, so it is in three parts: where the code is, what has
          been done to it, and where it is published.

          The folder comes first: a repository on GitHub is no use to a run that
          cannot make a worktree here. */}
      <RepoGroup
        title={runId === undefined ? "Where the code is" : "This agent's checkout"}
        summary={checkoutSummary}
        tone={trouble === null ? undefined : "warn"}
        // A problem opens itself: the fix belongs in front of somebody, not
        // behind a click. Everything else is a line until it is asked for.
        open={isOpen("checkout", trouble !== null)}
        onToggle={() => toggle("checkout")}
      >
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
      {/* Not offered for a run: a worktree's folder is made by the run and
          moving it would be pointing the Solution at an agent's checkout. */}
      {runId === undefined && (
        <FolderField
          label={state?.localPath ? "Move it to" : "Folder on this machine"}
          value={state?.localPath ?? ""}
          onChange={(path) => void run(() => setSolutionPath(solution.id, path))}
        />
      )}

      {state?.localPath && !(state.isRepo && state.hasCommit) && (
        <button
          aria-label={`Make ${solution.name} a git repository`}
          disabled={busy}
          onClick={() => void onInit()}
        >
          {busy ? "Working…" : state.isRepo ? "Make the first commit" : "Make it a git repository"}
        </button>
      )}
      </RepoGroup>

      {/* **What has been done to it.** The panel could say which repository and
          which branch and nothing about the work on it — "the git section is
          missing commit messages", and it was. */}
      <RepoGroup
        title="Recent commits"
        summary={commitSummary}
        open={isOpen("commits")}
        onToggle={() => toggle("commits")}
      >
        {commits.length === 0 ? (
          <p className="hint">
            {state?.isRepo === false
              ? "Nothing to show until this folder is a repository."
              : "No commits yet on this branch."}
          </p>
        ) : (
          <ul className="repo-commits" aria-label={`Recent commits in ${solution.name}`}>
            {commits.map((c) => (
              <li key={c.id}>
                <span className="commit-subject">{c.subject}</span>
                <span className="commit-meta">
                  <span className="card-mono">{c.shortId}</span>
                  {" · "}
                  {c.author}
                  {" · "}
                  {new Date(c.when * 1000).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </RepoGroup>

      <RepoGroup
        title="On GitHub"
        summary={githubSummary}
        open={isOpen("github")}
        onToggle={() => toggle("github")}
      >
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
      </RepoGroup>
    </section>
  );
}
