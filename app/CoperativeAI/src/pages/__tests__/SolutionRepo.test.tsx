import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SolutionRepo from "../../components/vcs/SolutionRepo";
import type { Solution, SolutionGitState } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    solutionGitState: vi.fn(),
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

describe("the git panel on a Solution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.solutionGitState.mockResolvedValue(state());
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

    expect(await screen.findByText(/not a git repository/i)).toBeInTheDocument();
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

    expect(await screen.findByText(/nothing committed/i)).toBeInTheDocument();
  });

  it("says nothing is wrong when the folder is a working repository", async () => {
    mocked.solutionGitState.mockResolvedValue(
      state({ isRepo: true, hasCommit: true, branch: "main" }),
    );
    render(<SolutionRepo solution={solution} onChange={vi.fn()} />);

    expect(await screen.findByText(/on main/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Make hello-world a git repository" }),
    ).not.toBeInTheDocument();
  });

  it("links an existing repository by URL", async () => {
    const onChange = vi.fn();
    render(<SolutionRepo solution={solution} onChange={onChange} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Link a repo to hello-world" }),
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

    await userEvent.click(
      await screen.findByRole("button", { name: "Create a repo for hello-world" }),
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

    const create = await screen.findByRole("button", {
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

    expect(await screen.findByText(/no folder on this machine/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Make hello-world a git repository" }),
    ).not.toBeInTheDocument();
  });
});
