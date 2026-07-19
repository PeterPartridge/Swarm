import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SolutionBox from "../../components/SolutionBox";
import type { ChangeReview, FileTree, Solution } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    readSolutionTree: vi.fn(),
    readSolutionFile: vi.fn(),
    reviewSolutionChanges: vi.fn(),
    setSolutionPath: vi.fn(),
    settleChangeRun: vi.fn(),
    pickFolder: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

function solution(overrides: Partial<Solution> = {}): Solution {
  return {
    id: 3,
    name: "Shop API",
    productId: 7,
    solutionType: "api",
    answers: "{}",
    origin: "created",
    githubUrl: null,
    githubVisibility: null,
    localPath: "C:/repos/shop-api",
    ...overrides,
  };
}

const tree: FileTree = {
  entries: [
    { path: "src", name: "src", isDir: true, depth: 0 },
    { path: "src/main.rs", name: "main.rs", isDir: false, depth: 1 },
    { path: "README.md", name: "README.md", isDir: false, depth: 0 },
  ],
  truncated: false,
};

function review(overrides: Partial<ChangeReview> = {}): ChangeReview {
  return {
    changes: [],
    report: {
      violations: [],
      notices: [],
      filesChanged: 0,
      addedLines: 0,
      removedLines: 0,
    },
    noRules: false,
    runId: null,
    runState: null,
    ...overrides,
  };
}

describe("SolutionBox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.readSolutionTree.mockResolvedValue(tree);
  });

  /// A linked GitHub repository is not a checkout — the distinction has caught
  /// people out, so the panel says it rather than showing an empty tree.
  it("asks for a working copy when there is none, and says why", async () => {
    render(<SolutionBox solution={solution({ localPath: null })} onPathChanged={vi.fn()} />);

    expect(
      await screen.findByText(/linked GitHub repository is not a checkout/),
    ).toBeInTheDocument();
    expect(mocked.readSolutionTree).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/^Review changes/)).not.toBeInTheDocument();
  });

  it("lists the files and opens one", async () => {
    const user = userEvent.setup();
    mocked.readSolutionFile.mockResolvedValue("fn main() {}");
    render(<SolutionBox solution={solution()} onPathChanged={vi.fn()} />);

    const files = await screen.findByRole("list", { name: "Files in Shop API" });
    expect(within(files).getByText("src/")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Open src/main.rs"));

    await waitFor(() => expect(mocked.readSolutionFile).toHaveBeenCalledWith(3, "src/main.rs"));
    expect(await screen.findByLabelText("Contents of src/main.rs")).toHaveTextContent(
      "fn main() {}",
    );
  });

  /// A partial tree that does not say so reads as a complete one.
  it("says when the tree was cut short", async () => {
    mocked.readSolutionTree.mockResolvedValue({ ...tree, truncated: true });
    render(<SolutionBox solution={solution()} onPathChanged={vi.fn()} />);

    expect(await screen.findByText(/more files not shown/)).toBeInTheDocument();
  });

  it("reports a broken rule against the file that broke it", async () => {
    const user = userEvent.setup();
    mocked.reviewSolutionChanges.mockResolvedValue(
      review({
        changes: [
          {
            path: "src/main.js",
            status: "modified",
            addedLines: 3,
            removedLines: 1,
            diff: "+import jquery from 'jquery';",
          },
        ],
        report: {
          violations: [
            {
              kind: "disallowedTech",
              path: "src/main.js",
              detail: "this change introduces jQuery, which the developer rules forbid",
            },
          ],
          notices: [],
          filesChanged: 1,
          addedLines: 3,
          removedLines: 1,
        },
      }),
    );
    render(<SolutionBox solution={solution()} onPathChanged={vi.fn()} />);

    await user.click(await screen.findByLabelText("Review changes in Shop API"));

    const broken = await screen.findByRole("list", { name: "Rules broken" });
    expect(within(broken).getByText(/introduces jQuery/)).toBeInTheDocument();
    expect(screen.getByText(/1 file changed · \+3 −1/)).toBeInTheDocument();
  });

  /// Missing tests are a notice, not a breach — plenty of legitimate changes
  /// have none, and blocking those teaches people to ignore the report.
  it("keeps notices separate from broken rules", async () => {
    const user = userEvent.setup();
    mocked.reviewSolutionChanges.mockResolvedValue(
      review({
        report: {
          violations: [],
          notices: [
            { kind: "noTests", path: "", detail: "source changed but no test file was touched" },
          ],
          filesChanged: 2,
          addedLines: 10,
          removedLines: 0,
        },
      }),
    );
    render(<SolutionBox solution={solution()} onPathChanged={vi.fn()} />);

    await user.click(await screen.findByLabelText("Review changes in Shop API"));

    expect(await screen.findByRole("list", { name: "Worth a look" })).toHaveTextContent(
      "no test file was touched",
    );
    expect(screen.queryByRole("list", { name: "Rules broken" })).not.toBeInTheDocument();
  });

  /// Silence because there are no rules reads exactly like silence because
  /// everything passed. The difference has to be said out loud.
  it("says when nothing was checked because there are no rules", async () => {
    const user = userEvent.setup();
    mocked.reviewSolutionChanges.mockResolvedValue(
      review({
        noRules: true,
        report: {
          violations: [],
          notices: [],
          filesChanged: 4,
          addedLines: 20,
          removedLines: 2,
        },
      }),
    );
    render(<SolutionBox solution={solution()} onPathChanged={vi.fn()} />);

    await user.click(await screen.findByLabelText("Review changes in Shop API"));

    expect(
      await screen.findByText(/no Developer Rules, so nothing was checked/),
    ).toBeInTheDocument();
  });

  it("says plainly when nothing has changed", async () => {
    const user = userEvent.setup();
    mocked.reviewSolutionChanges.mockResolvedValue(review());
    render(<SolutionBox solution={solution()} onPathChanged={vi.fn()} />);

    await user.click(await screen.findByLabelText("Review changes in Shop API"));

    expect(await screen.findByText(/Nothing has changed in this working copy/)).toBeInTheDocument();
    // and with no changes there is nothing to say about missing rules
    expect(screen.queryByText(/nothing was checked/)).not.toBeInTheDocument();
  });

  /// The user chose an accept that is never gated: Keep is offered even when
  /// rules are broken. The counterweight is the record — findings were stored
  /// on the run before the button was pressed, and the confirmation says the
  /// decision was made over them rather than laundering it into a clean pass.
  it("offers Keep even over a broken rule, and records that it was over one", async () => {
    const user = userEvent.setup();
    mocked.settleChangeRun.mockResolvedValue();
    mocked.reviewSolutionChanges.mockResolvedValue(
      review({
        runId: 9,
        runState: "reviewed",
        changes: [
          { path: "src/a.js", status: "modified", addedLines: 1, removedLines: 0, diff: "+x" },
        ],
        report: {
          violations: [
            { kind: "disallowedTech", path: "src/a.js", detail: "introduces jQuery" },
          ],
          notices: [],
          filesChanged: 1,
          addedLines: 1,
          removedLines: 0,
        },
      }),
    );
    render(<SolutionBox solution={solution()} onPathChanged={vi.fn()} />);

    await user.click(await screen.findByLabelText("Review changes in Shop API"));
    const keep = await screen.findByLabelText("Keep the changes in Shop API");
    expect(keep).toBeEnabled();

    await user.click(keep);

    await waitFor(() => expect(mocked.settleChangeRun).toHaveBeenCalledWith(9, "kept"));
    expect(await screen.findByText(/with the broken rules above on the record/)).toBeInTheDocument();
  });

  it("records a discard, and says files are untouched", async () => {
    const user = userEvent.setup();
    mocked.settleChangeRun.mockResolvedValue();
    mocked.reviewSolutionChanges.mockResolvedValue(
      review({
        runId: 9,
        runState: "reviewed",
        changes: [
          { path: "src/a.rs", status: "modified", addedLines: 1, removedLines: 0, diff: "+x" },
        ],
        report: {
          violations: [],
          notices: [],
          filesChanged: 1,
          addedLines: 1,
          removedLines: 0,
        },
      }),
    );
    render(<SolutionBox solution={solution()} onPathChanged={vi.fn()} />);

    await user.click(await screen.findByLabelText("Review changes in Shop API"));
    expect(await screen.findByText(/use git to actually revert/)).toBeInTheDocument();

    await user.click(screen.getByLabelText("Discard the changes in Shop API"));

    await waitFor(() => expect(mocked.settleChangeRun).toHaveBeenCalledWith(9, "discarded"));
    expect(await screen.findByText(/Recorded as discarded/)).toBeInTheDocument();
  });

  /// No handover, nothing to settle — the buttons would record onto nothing.
  it("offers no decision when there is no open handover", async () => {
    const user = userEvent.setup();
    mocked.reviewSolutionChanges.mockResolvedValue(
      review({
        changes: [
          { path: "src/a.rs", status: "modified", addedLines: 1, removedLines: 0, diff: "+x" },
        ],
        report: {
          violations: [],
          notices: [],
          filesChanged: 1,
          addedLines: 1,
          removedLines: 0,
        },
      }),
    );
    render(<SolutionBox solution={solution()} onPathChanged={vi.fn()} />);

    await user.click(await screen.findByLabelText("Review changes in Shop API"));

    await screen.findByText(/1 file changed/);
    expect(screen.queryByLabelText(/^Keep the changes/)).not.toBeInTheDocument();
  });

  /// A folder that is not a repository has nothing to compare against, and the
  /// reason must reach the user rather than the button doing nothing.
  it("surfaces a folder that is not a git repository", async () => {
    const user = userEvent.setup();
    mocked.reviewSolutionChanges.mockRejectedValue(
      "this Solution's folder is not a git repository, so there is nothing to compare against",
    );
    render(<SolutionBox solution={solution()} onPathChanged={vi.fn()} />);

    await user.click(await screen.findByLabelText("Review changes in Shop API"));

    expect(await screen.findByRole("alert")).toHaveTextContent("not a git repository");
  });
});
