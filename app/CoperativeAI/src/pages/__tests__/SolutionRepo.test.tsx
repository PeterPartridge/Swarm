import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SolutionRepo from "../../components/vcs/SolutionRepo";
import type { Solution, SolutionGitState } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    solutionGitState: vi.fn(),
    // The panel reads the last few commits now. A mock with no default falls
    // through to the real invoke.
    branchHistory: vi.fn(),
    commitSolution: vi.fn(),
    checkoutChanges: vi.fn(),
    syncSolution: vi.fn(),
    openPullRequest: vi.fn(),
    setSolutionPath: vi.fn(),
    pickFolder: vi.fn(),
    initSolutionRepo: vi.fn(),
    linkSolutionRepo: vi.fn(),
    createSolutionRepo: vi.fn(),
    githubStatus: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const solution: Solution = {
  id: 3,
  name: "hello-world",
  productId: 7,
  solutionType: "api",
  answers: "{}",
  origin: "created",
  githubUrl: null,
  githubVisibility: null,
  localPath: "C:/Users/me/source/repo/hello/hello-world",
  testCommand: null,
  language: null,
  runCommand: null,
  startFrom: null,
  kindLocations: "{}",
};

const state = (over: Partial<SolutionGitState> = {}): SolutionGitState => ({
  localPath: solution.localPath,
  isRepo: false,
  hasCommit: false,
  branch: "",
  githubUrl: null,
  githubVisibility: null,
  ...over,
});

/** Opens the "On GitHub" line, where linking and creating live.
 *
 *  The panel is three lines now, each opening onto its own half — so reaching
 *  the GitHub half is a click, which is the point of the three lines. */
async function openGitHub(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: /On GitHub/ }));
}

describe("the git panel on a Solution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.solutionGitState.mockResolvedValue(state());
    mocked.branchHistory.mockResolvedValue([]);
    mocked.checkoutChanges.mockResolvedValue([]);
    mocked.syncSolution.mockResolvedValue("AskForName is level with origin.");
    mocked.openPullRequest.mockResolvedValue("https://github.com/me/hello-world/pull/1");
    mocked.commitSolution.mockResolvedValue({
      committed: true,
      message: "Add the greeter",
      files: ["Greeting.cs"],
      pushed: null,
    });
    mocked.githubStatus.mockResolvedValue({ connected: true });
    mocked.initSolutionRepo.mockResolvedValue("it is a git repository now");
    mocked.linkSolutionRepo.mockResolvedValue(undefined);
    mocked.createSolutionRepo.mockResolvedValue("https://github.com/me/hello-world");
  });

  /** The error the user actually hit, answered where they hit it. Before this
   *  the panel talked only about GitHub, so a folder that was not a repository
   *  read as "no repository linked" — and linking one would not have helped. */
  it("says the folder is not a git repository, and offers to make it one", async () => {
    render(<SolutionRepo solution={solution} onChange={vi.fn()} />);

    // The line says the state; the sentence under it says what that means.
    expect(
      await screen.findByRole("button", { name: /Not a git repository/i }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Make hello-world a git repository" }),
    );

    await waitFor(() => expect(mocked.initSolutionRepo).toHaveBeenCalledWith(3));
  });

  /** A repository with no commit is its own state: `git init` alone leaves one,
   *  and a run still cannot branch from it. */
  it("says when a repository has nothing committed yet", async () => {
    mocked.solutionGitState.mockResolvedValue(state({ isRepo: true }));
    render(<SolutionRepo solution={solution} onChange={vi.fn()} />);

    expect(
      await screen.findByRole("button", { name: /Nothing committed yet/i }),
    ).toBeInTheDocument();
  });

  it("says nothing is wrong when the folder is a working repository", async () => {
    mocked.solutionGitState.mockResolvedValue(
      state({ isRepo: true, hasCommit: true, branch: "main" }),
    );
    render(<SolutionRepo solution={solution} onChange={vi.fn()} />);

    // A working repository is one line: the branch and where it is.
    expect(await screen.findByRole("button", { name: /on main/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Make hello-world a git repository" }),
    ).not.toBeInTheDocument();
  });

/// **The panel that shows an agent's commits could not make one.** Committing
  /// wrote to the Solution's folder, so keeping an agent's work from here would
  /// have committed the default branch — whatever was uncommitted on it, which
  /// is usually nothing — and left the agent's work exactly where it was.
  it("commits the agent's checkout, from the panel showing it", async () => {
    const user = userEvent.setup();
    mocked.solutionGitState.mockResolvedValue(
      state({ isRepo: true, hasCommit: true, branch: "AskForName" }),
    );
    render(<SolutionRepo solution={solution} runId={42} onChange={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Work to commit/ }));
    await userEvent.type(
      screen.getByLabelText("Commit message for hello-world"),
      "Add the greeter",
    );
    await user.click(screen.getByRole("button", { name: "Commit hello-world" }));

    await waitFor(() =>
      expect(mocked.commitSolution).toHaveBeenCalledWith(3, "Add the greeter", false, 42),
    );
  });

  /// Without a run there is no agent's work to keep, and the editor's own git
  /// panel is where committing your own workspace lives. Two commit boxes for
  /// one folder would be two answers to one question.
  it("offers no commit box when no run is being looked at", async () => {
    const user = userEvent.setup();
    mocked.solutionGitState.mockResolvedValue(
      state({ isRepo: true, hasCommit: true, branch: "main" }),
    );
    render(<SolutionRepo solution={solution} onChange={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Work to commit/ }));
    await userEvent.type(
      screen.getByLabelText("Commit message for hello-world"),
      "Tidy up",
    );
    await user.click(screen.getByRole("button", { name: "Commit hello-world" }));

    // No run: this is your own workspace, and the run argument is absent rather
    // than guessed at.
    await waitFor(() =>
      expect(mocked.commitSolution).toHaveBeenCalledWith(3, "Tidy up", false, undefined),
    );
  });

  /// **"Work to commit" is the question the panel could not answer.** It could
  /// name the branch and list what had been committed, and said nothing about
  /// what was sitting there waiting — which is the thing somebody opening it is
  /// deciding about.
  it("lists what is waiting to be committed, and says so on the line", async () => {
    const user = userEvent.setup();
    mocked.checkoutChanges.mockResolvedValue([
      { path: "Greeting.cs", status: "added", addedLines: 20, removedLines: 0, diff: "" },
      { path: "Program.cs", status: "modified", addedLines: 2, removedLines: 1, diff: "" },
    ]);
    render(<SolutionRepo solution={solution} runId={42} onChange={vi.fn()} />);

    const line = await screen.findByRole("button", { name: /2 files to commit/ });
    await user.click(line);
    const list = screen.getByRole("list", {
      name: "Waiting to be committed in hello-world",
    });
    expect(within(list).getByText("Greeting.cs")).toBeInTheDocument();
    expect(within(list).getByText("Program.cs")).toBeInTheDocument();
  });

  /// Sync is one press because "catch up with everyone else" is a pull and a
  /// push in that order, and nobody means only half of it.
  it("syncs the checkout being looked at", async () => {
    const user = userEvent.setup();
    render(<SolutionRepo solution={solution} runId={42} onChange={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Work to commit/ }));
    await user.click(screen.getByRole("button", { name: "Sync hello-world" }));

    await waitFor(() => expect(mocked.syncSolution).toHaveBeenCalledWith(3, 42));
    expect(await screen.findByText(/level with origin/)).toBeInTheDocument();
  });

  /// **The last step of a run, which used to leave the app.** Opening one is
  /// offered only where there is a repository to open it on.
  it("opens a pull request from this checkout's branch", async () => {
    const user = userEvent.setup();
    mocked.solutionGitState.mockResolvedValue(
      state({
        isRepo: true,
        hasCommit: true,
        branch: "AskForName",
        githubUrl: "https://github.com/me/hello-world",
      }),
    );
    render(<SolutionRepo solution={solution} runId={42} onChange={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /On GitHub/ }));
    await userEvent.type(
      screen.getByLabelText("Pull request title for hello-world"),
      "Ask for a name",
    );
    await user.click(
      screen.getByRole("button", { name: "Open a pull request for hello-world" }),
    );

    await waitFor(() =>
      expect(mocked.openPullRequest).toHaveBeenCalledWith({
        solutionId: 3,
        runId: 42,
        title: "Ask for a name",
        body: "",
        base: "main",
      }),
    );
  });

  it("offers no pull request where there is no repository to open one on", async () => {
    const user = userEvent.setup();
    render(<SolutionRepo solution={solution} runId={42} onChange={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: /On GitHub/ }));
    expect(
      screen.queryByRole("button", { name: "Open a pull request for hello-world" }),
    ).not.toBeInTheDocument();
  });

  it("links an existing repository by URL", async () => {
    const onChange = vi.fn();
    render(<SolutionRepo solution={solution} onChange={onChange} />);

    await openGitHub();
    await userEvent.click(
      screen.getByRole("button", { name: "Link a repo to hello-world" }),
    );
    await userEvent.type(
      screen.getByLabelText("Repository URL"),
      "https://github.com/me/hello-world",
    );
    await userEvent.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() =>
      expect(mocked.linkSolutionRepo).toHaveBeenCalledWith(
        3,
        "https://github.com/me/hello-world",
      ),
    );
    expect(onChange).toHaveBeenCalled();
  });

  it("creates one, public or private", async () => {
    render(<SolutionRepo solution={solution} onChange={vi.fn()} />);

    await openGitHub();
    await userEvent.click(
      screen.getByRole("button", { name: "Create a repo for hello-world" }),
    );
    // Private by default — a repository nobody chose to publish should not be
    // published. The choice is offered as both options, not as a checkbox
    // somebody has to reason about backwards.
    await userEvent.click(screen.getByRole("radio", { name: "Public" }));
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(mocked.createSolutionRepo).toHaveBeenCalledWith({
        solutionId: 3,
        repoName: "hello-world",
        private: false,
        description: "Repository for hello-world",
      }),
    );
  });

  /** Creating needs a token; linking a URL does not. Saying which is why the
   *  button is off beats a button that simply does nothing. */
  it("cannot create without GitHub connected, and says why", async () => {
    mocked.githubStatus.mockResolvedValue({ connected: false });
    render(<SolutionRepo solution={solution} onChange={vi.fn()} />);

    await openGitHub();
    const create = screen.getByRole("button", {
      name: "Create a repo for hello-world",
    });
    expect(create).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Link a repo to hello-world" }),
    ).toBeEnabled();
  });

  it("says there is no folder yet rather than offering to init nothing", async () => {
    mocked.solutionGitState.mockResolvedValue(state({ localPath: null }));
    render(
      <SolutionRepo solution={{ ...solution, localPath: null }} onChange={vi.fn()} />,
    );

    // Said on the line and again in the sentence under it, which opens
    // itself for a problem — so both are on screen.
    expect(
      await screen.findByRole("button", { name: /No folder on this machine yet/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Make hello-world a git repository" }),
    ).not.toBeInTheDocument();
  });

  /** **The whole point of saying it here.** "Execute failed: 'Shop API' has no
   *  folder on this machine" is a true sentence in a panel that could not do
   *  anything about it — so the next move was to go and find the screen that
   *  could. The chooser is the fix, beside the sentence that names the
   *  problem. */
  it("points the Solution at a folder from here", async () => {
    mocked.solutionGitState.mockResolvedValue(state({ localPath: null }));
    mocked.pickFolder.mockResolvedValue("C:/repos/hello-world");
    mocked.setSolutionPath.mockResolvedValue(undefined);
    const onChange = vi.fn();
    render(
      <SolutionRepo solution={{ ...solution, localPath: null }} onChange={onChange} />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /Choose folder/ }),
    );

    await waitFor(() =>
      expect(mocked.setSolutionPath).toHaveBeenCalledWith(3, "C:/repos/hello-world"),
    );
    expect(onChange).toHaveBeenCalled();
  });
});
