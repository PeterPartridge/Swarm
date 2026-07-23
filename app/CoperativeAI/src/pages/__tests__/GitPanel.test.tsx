import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BranchHistory, { assignLanes } from "../../components/BranchHistory";
import GitPanel from "../../components/GitPanel";
import type { Commit, Solution } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    productChangedFiles: vi.fn(),
    getCommitPolicy: vi.fn(),
    setCommitPolicy: vi.fn(),
    commitSolution: vi.fn(),
    pushSolution: vi.fn(),
    branchHistory: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const solution: Solution = {
  id: 3,
  name: "Shop API",
  productId: 1,
  solutionType: "api",
  answers: "{}",
  origin: "created",
  githubUrl: null,
  githubVisibility: null,
  localPath: "C:/repos/shop-api",
  testCommand: null,
  language: null,
};

const commit = (over: Partial<Commit> = {}): Commit => ({
  id: "aaa1",
  shortId: "aaa1",
  parents: ["bbb2"],
  refs: [],
  subject: "A change",
  author: "Ada",
  when: 1_700_000_000,
  ...over,
});

describe("assignLanes", () => {
  /// A merge is two lines becoming one, and that is the whole reason to draw
  /// the history rather than list it.
  it("gives a merge's second parent a lane of its own", () => {
    const placed = assignLanes([
      commit({ id: "m", parents: ["a", "b"] }),
      commit({ id: "a", parents: ["root"] }),
      commit({ id: "b", parents: ["root"] }),
      commit({ id: "root", parents: [] }),
    ]);

    const laneOf = (id: string) => placed.find((p) => p.commit.id === id)!.lane;
    expect(laneOf("m")).toBe(0);
    expect(laneOf("a")).toBe(0);
    expect(laneOf("b")).not.toBe(laneOf("a"));
  });

  /// A straight line of commits must stay in one lane, or every history looks
  /// like a braid.
  it("keeps an unbranched history in a single lane", () => {
    const placed = assignLanes([
      commit({ id: "c", parents: ["b"] }),
      commit({ id: "b", parents: ["a"] }),
      commit({ id: "a", parents: [] }),
    ]);
    expect(placed.every((p) => p.lane === 0)).toBe(true);
  });

  it("copes with an empty history", () => {
    expect(assignLanes([])).toEqual([]);
  });
});

describe("BranchHistory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows commits, their branches and which are merges", async () => {
    mocked.branchHistory.mockResolvedValue([
      commit({ id: "m", parents: ["a", "b"], refs: ["main"], subject: "Merge checkout" }),
      commit({ id: "a", parents: [], subject: "Add the basket" }),
    ]);
    render(<BranchHistory solutionId={3} solutionName="Shop API" />);

    expect(await screen.findByText("Merge checkout")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("merge")).toBeInTheDocument();
  });
});

describe("GitPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.productChangedFiles.mockResolvedValue([
      {
        solutionId: 3,
        name: "Shop API",
        changes: [
          {
            path: "src/basket.rs",
            status: "modified",
            addedLines: 12,
            removedLines: 3,
            diff: "",
          },
        ],
        unavailable: null,
      },
    ]);
    mocked.getCommitPolicy.mockResolvedValue({
      mode: "off",
      push: false,
      intervalMinutes: 5,
    });
  });

  it("commits what changed with the message that was typed", async () => {
    const user = userEvent.setup();
    mocked.commitSolution.mockResolvedValue({
      committed: true,
      message: "Fix the basket",
      files: ["src/basket.rs"],
      pushed: null,
    });
    render(<GitPanel solution={solution} />);

    await user.type(await screen.findByLabelText("Commit message"), "Fix the basket");
    await user.click(screen.getByRole("button", { name: "Commit" }));

    await waitFor(() =>
      expect(mocked.commitSolution).toHaveBeenCalledWith(3, "Fix the basket", false),
    );
    expect(await screen.findByText(/Committed 1 file/)).toBeInTheDocument();
  });

  /// Committing and pushing are separate choices on the button as well as in
  /// the settings.
  it("pushes only when asked to", async () => {
    const user = userEvent.setup();
    mocked.commitSolution.mockResolvedValue({
      committed: true,
      message: "x",
      files: ["src/basket.rs"],
      pushed: { Ok: null },
    });
    render(<GitPanel solution={solution} />);

    await user.click(await screen.findByLabelText("Push after committing"));
    await user.click(screen.getByRole("button", { name: "Commit and push" }));

    await waitFor(() =>
      expect(mocked.commitSolution).toHaveBeenCalledWith(3, "", true),
    );
    expect(await screen.findByText(/and pushed/)).toBeInTheDocument();
  });

  /// A commit that landed with a push that did not is a real state. Saying
  /// only "committed" would leave someone believing it was sent.
  it("says so when the commit landed but the push did not", async () => {
    const user = userEvent.setup();
    mocked.commitSolution.mockResolvedValue({
      committed: true,
      message: "x",
      files: ["src/basket.rs"],
      pushed: { Err: "no upstream configured" },
    });
    render(<GitPanel solution={solution} />);

    await user.click(await screen.findByLabelText("Push after committing"));
    await user.click(screen.getByRole("button", { name: "Commit and push" }));

    expect(
      await screen.findByText(/committed, but the push failed: no upstream/),
    ).toBeInTheDocument();
  });

  /// The setting the user asked to be a choice rather than an assumption.
  it("offers commit-locally and commit-and-push as separate answers", async () => {
    const user = userEvent.setup();
    mocked.setCommitPolicy.mockResolvedValue(undefined);
    render(<GitPanel solution={solution} />);

    await user.click(await screen.findByRole("button", { name: "Auto-commit" }));
    await user.selectOptions(await screen.findByLabelText("Automatic commit"), "onSave");
    await waitFor(() =>
      expect(mocked.setCommitPolicy).toHaveBeenCalledWith(3, "onSave", false, 5),
    );
    // committing locally is the default, and the consequence is spelled out
    expect(screen.getByText(/stay on this machine until you push/)).toBeInTheDocument();

    await user.click(screen.getByLabelText("Push automatic commits"));
    await waitFor(() =>
      expect(mocked.setCommitPolicy).toHaveBeenCalledWith(3, "onSave", true, 5),
    );
    expect(
      await screen.findByText(/branch other people pull/),
    ).toBeInTheDocument();
  });

  /// Nothing to commit is the ordinary case, not a failure.
  it("says there is nothing to commit rather than reporting an error", async () => {
    mocked.productChangedFiles.mockResolvedValue([
      { solutionId: 3, name: "Shop API", changes: [], unavailable: null },
    ]);
    render(<GitPanel solution={solution} />);
    expect(await screen.findByText(/Nothing changed in Shop API/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
