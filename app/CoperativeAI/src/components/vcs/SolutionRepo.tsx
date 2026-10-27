import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  branchHistory,
  checkoutChanges,
  commitSolution,
  createSolutionRepo,
  githubStatus,
  initSolutionRepo,
  linkSolutionRepo,
  openPullRequest,
  setSolutionPath,
  solutionGitState,
  syncSolution,
  type Commit,
  type FileChange,
  type Solution,
  type SolutionGitState,
} from "../../lib/backend";
import FolderField from "../common/FolderField";
import Group from "../common/Group";

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
  pullRequestUrl,
  onChange,
}: {
  solution: Solution;
  /** The pull request already opened from this run's branch, when there is one.
   *
   *  **Passed in rather than read here.** The run row carries it, and the panel
   *  that knows about the run is the one that has it — a second read for a
   *  string somebody already holds is a round trip for nothing. */
  pullRequestUrl?: string;
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
  /// What is sitting uncommitted — "work to commit", which the panel could not
  /// say. It could name the branch and list what had been committed, and said
  /// nothing about the thing somebody is actually deciding about.
  const [waiting, setWaiting] = useState<FileChange[]>([]);
  const [message, setMessage] = useState("");
  const [pushToo, setPushToo] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [prBase, setPrBase] = useState("main");

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
      // `?? []` for the same reason the state above uses `?? null`: this
      // panel is mounted in five places and one of them handing it nothing
      // must not take the screen down.
      setCommits((await branchHistory(solution.id, 8, runId)) ?? []);
    } catch {
      setCommits([]);
    }
    try {
      setWaiting((await checkoutChanges(solution.id, runId)) ?? []);
    } catch {
      // A folder that is not a repository has no changes to read, which the
      // line above already says in words.
      setWaiting([]);
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

  /// Commits everything in this checkout. The message is optional: `commit_all`
  /// writes the file list when there is none, which is the honest default for
  /// "keep this" and better than a form that refuses until somebody invents a
  /// sentence.
  async function onCommit() {
    await run(async () => {
      const result = await commitSolution(solution.id, message.trim(), pushToo, runId);
      setMessage("");
      setNotice(
        result.committed
          ? `Committed ${result.files.length} file${result.files.length === 1 ? "" : "s"}: ${result.message}`
          : "Nothing to commit — this checkout is clean.",
      );
    });
  }

  async function onSync() {
    await run(async () => setNotice(await syncSolution(solution.id, runId)));
  }

  async function onPullRequest() {
    await run(async () =>
      setNotice(
        await openPullRequest({
          solutionId: solution.id,
          runId,
          title: prTitle.trim() || `${solution.name}: ${state?.branch ?? "this branch"}`,
          body: "",
          base: prBase.trim(),
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

  const waitingSummary =
    waiting.length === 0
      ? "Nothing waiting — this checkout is clean"
      : `${waiting.length} file${waiting.length === 1 ? "" : "s"} to commit`;

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
      {/* **Above the groups, not inside one.** These sat where the GitHub form
          used to be, which became the inside of a collapsed box — so a sync
          started from another group reported into a section nobody could see.
          What an action did belongs where the action's panel is, not where its
          buttons happen to live. */}
      {error && <p role="alert">{error}</p>}
      {notice && <p className="note" role="status">{notice}</p>}

      {/* **Three questions, three groups.** This was one column of sentences,
          fields, buttons and two forms — everything the panel could do, in the
          order it had been written in, with no way to see at a glance which
          parts were about the folder here and which about GitHub. It answers
          three things, so it is in three parts: where the code is, what has
          been done to it, and where it is published.

          The folder comes first: a repository on GitHub is no use to a run that
          cannot make a worktree here. */}
      <Group
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
      </Group>

      {/* **What has been done to it.** The panel could say which repository and
          which branch and nothing about the work on it — "the git section is
          missing commit messages", and it was. */}
      <Group
        title="Work to commit"
        summary={waitingSummary}
        tone={waiting.length > 0 ? "warn" : undefined}
        open={isOpen("waiting")}
        onToggle={() => toggle("waiting")}
      >
        {waiting.length > 0 && (
          <ul className="repo-waiting" aria-label={`Waiting to be committed in ${solution.name}`}>
            {waiting.map((f) => (
              <li key={f.path}>
                <span className={`tree-status ${f.status}`}>
                  {f.status.charAt(0).toUpperCase()}
                </span>
                <span className="card-mono">{f.path}</span>
              </li>
            ))}
          </ul>
        )}

        {/* **Optional on purpose.** `commit_all` writes the file list when there
            is no message, which is the honest default for "keep this" — better
            than a form that refuses until somebody invents a sentence. */}
        <label className="field">
          <span>Commit message</span>
          <input
            aria-label={`Commit message for ${solution.name}`}
            placeholder="what this change does (optional)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <label className="repo-check">
          <input
            type="checkbox"
            checked={pushToo}
            onChange={(e) => setPushToo(e.target.checked)}
          />
          Push it as well
        </label>
        <div className="row-actions">
          <button
            aria-label={`Commit ${solution.name}`}
            disabled={busy}
            onClick={() => void onCommit()}
          >
            {busy ? "Working…" : "Commit"}
          </button>
          {/* Sync rather than pull and push as two presses: what people mean by
              "catch up with everyone else" is both, in that order. */}
          <button
            aria-label={`Sync ${solution.name}`}
            disabled={busy}
            title="Pulls what is on the remote, rebasing, then pushes"
            onClick={() => void onSync()}
          >
            Sync
          </button>
        </div>
      </Group>

      <Group
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
      </Group>

      <Group
        title="On GitHub"
        summary={githubSummary}
        open={isOpen("github")}
        onToggle={() => toggle("github")}
      >
      {linked && pullRequestUrl && (
        <p className="repo-pr-open">
          {/* **The link outlives the notice.** Opening one said its URL once, in
              a message that goes when the panel reloads — and then the only way
              back to a review of your own work was to find it on GitHub. */}
          Pull request open:{" "}
          <a href={pullRequestUrl} target="_blank" rel="noreferrer">
            {pullRequestUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "")}
          </a>
        </p>
      )}

      {linked && (
        <div className="repo-pr">
          {/* **The last step of a run, which used to leave the app.** An agent's
              work ends as a branch; turning it into something a person reviews
              meant going to a browser and finding the button GitHub offers. The
              branch is this checkout's — not a field, because which branch a
              request comes *from* is not a thing to get wrong. */}
          <label className="field">
            <span>Pull request title</span>
            <input
              aria-label={`Pull request title for ${solution.name}`}
              placeholder={`${solution.name}: ${state?.branch ?? "this branch"}`}
              value={prTitle}
              onChange={(e) => setPrTitle(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Merging into</span>
            <input
              aria-label={`Pull request base for ${solution.name}`}
              value={prBase}
              onChange={(e) => setPrBase(e.target.value)}
            />
          </label>
          {/* **The description writes itself when an agent wrote one.** Its
              round record is what a reviewer opens a request to find out — what
              was built, how it was proved, what was left behind. Said here
              because a description that appears from nowhere is a surprise, and
              because anybody who wants their own words should know theirs win. */}
          {runId !== undefined && (
            <p className="hint">
              The description will be the agent's round record, if it wrote one.
              Anything typed above replaces it.
            </p>
          )}
          <button
            aria-label={`Open a pull request for ${solution.name}`}
            disabled={busy}
            onClick={() => void onPullRequest()}
          >
            {busy ? "Working…" : "Open a pull request"}
          </button>
        </div>
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
      </Group>
    </section>
  );
}
