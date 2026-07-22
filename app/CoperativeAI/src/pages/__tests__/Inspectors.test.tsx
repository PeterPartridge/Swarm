import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GitExplorer from "../../components/GitExplorer";
import TestExplorer from "../../components/TestExplorer";
import type { RepoStatus, SuiteRun, TestSuite } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    productGitOverview: vi.fn(),
    readConflictSides: vi.fn(),
    markConflictResolved: vi.fn(),
    writeSolutionFile: vi.fn(),
    listTestSuites: vi.fn(),
    runSolutionTests: vi.fn(),
    setSolutionTestCommand: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const suite = (over: Partial<TestSuite> = {}): TestSuite => ({
  kind: "cargo",
  directory: "src-tauri",
  commandLine: "cargo test",
  foundBy: "Cargo.toml",
  ...over,
});

const run = (over: Partial<SuiteRun> = {}): SuiteRun => ({
  suite: suite(),
  passed: 12,
  failed: 0,
  skipped: 1,
  counted: true,
  exitOk: true,
  tests: [],
  output: "test result: ok. 12 passed",
  durationMs: 4200,
  ...over,
});

const repoStatus = (over: Partial<RepoStatus> = {}): RepoStatus => ({
  branch: "feature/checkout",
  upstream: "origin/feature/checkout",
  ahead: 2,
  behind: 0,
  files: [],
  merging: false,
  ...over,
});

describe("TestExplorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listTestSuites.mockResolvedValue([
      {
        solutionId: 3,
        name: "Shop API",
        suites: [suite(), suite({ kind: "vitest", directory: ".", commandLine: "npx vitest run" })],
        customCommand: null,
        unavailable: null,
      },
    ]);
  });

  /// A Solution with a web front end and a Rust core has two suites, and
  /// running only the first would report half a Solution as green.
  it("shows every suite a Solution has, not just the first", async () => {
    render(<TestExplorer productId={1} />);
    expect(await screen.findByText("Rust (cargo)")).toBeInTheDocument();
    expect(screen.getByText("TypeScript (vitest)")).toBeInTheDocument();
  });

  it("runs one Solution's tests and shows the counts", async () => {
    const user = userEvent.setup();
    mocked.runSolutionTests.mockResolvedValue([run()]);
    render(<TestExplorer productId={1} />);

    await user.click(await screen.findByLabelText("Run tests for Shop API"));

    await waitFor(() => expect(mocked.runSolutionTests).toHaveBeenCalledWith(3));
    expect(await screen.findByText(/12 passed, 0 failed/)).toBeInTheDocument();
  });

  /// The honesty rule, visible. When no parser recognised the output the run is
  /// known only by its exit code, and inventing a count would be worse than
  /// showing none — the same rule that keeps unknown AI spend off the screen.
  it("shows no numbers when the output could not be counted", async () => {
    const user = userEvent.setup();
    mocked.runSolutionTests.mockResolvedValue([
      run({ counted: false, passed: 0, failed: 0, exitOk: true }),
    ]);
    render(<TestExplorer productId={1} />);

    await user.click(await screen.findByLabelText("Run tests for Shop API"));

    expect(await screen.findByText(/no test count could be read/)).toBeInTheDocument();
    expect(screen.queryByText(/0 passed, 0 failed/)).not.toBeInTheDocument();
    // and the summary must not quietly total it as a clean zero either
    expect(screen.queryByText(/0 passing and 0 failing/)).not.toBeInTheDocument();
    expect(screen.getByText(/known only by exit code/)).toBeInTheDocument();
  });

  it("names the tests that failed", async () => {
    const user = userEvent.setup();
    mocked.runSolutionTests.mockResolvedValue([
      run({
        passed: 1,
        failed: 1,
        exitOk: false,
        tests: [
          { name: "charges once", state: "passed" },
          { name: "refunds in full", state: "failed" },
        ],
      }),
    ]);
    render(<TestExplorer productId={1} />);

    await user.click(await screen.findByLabelText("Run tests for Shop API"));

    expect(await screen.findByText("refunds in full")).toBeInTheDocument();
    expect(screen.queryByText("charges once")).not.toBeInTheDocument();
  });

  /// The escape hatch that makes "regardless of language" true rather than a
  /// claim about the five runners that happen to be recognised.
  it("lets a Solution carry its own command for a language nothing recognises", async () => {
    const user = userEvent.setup();
    mocked.setSolutionTestCommand.mockResolvedValue(undefined);
    render(<TestExplorer productId={1} />);

    await user.click(await screen.findByLabelText("Set test command for Shop API"));
    await user.type(await screen.findByLabelText("Test command for Shop API"), "mix test");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocked.setSolutionTestCommand).toHaveBeenCalledWith(3, "mix test"),
    );
  });

  it("says why a Solution cannot be run rather than showing it as passing", async () => {
    mocked.listTestSuites.mockResolvedValue([
      {
        solutionId: 5,
        name: "Shop Web",
        suites: [],
        customCommand: null,
        unavailable: "no folder on this machine yet",
      },
    ]);
    render(<TestExplorer productId={1} />);
    expect(await screen.findByText(/no folder on this machine yet/)).toBeInTheDocument();
    expect(screen.getByLabelText("Run tests for Shop Web")).toBeDisabled();
  });
});

describe("GitExplorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows each Solution's branch and how far it has drifted", async () => {
    mocked.productGitOverview.mockResolvedValue([
      { solutionId: 3, name: "Shop API", status: repoStatus(), unavailable: null },
    ]);
    render(<GitExplorer productId={1} />);

    expect(await screen.findByText("feature/checkout")).toBeInTheDocument();
    expect(screen.getByText(/↑2/)).toBeInTheDocument();
  });

  /// One unlinked Solution must not blank the hub — that is the situation a
  /// cross-Solution view exists for.
  it("reports an unavailable Solution beside the ones that work", async () => {
    mocked.productGitOverview.mockResolvedValue([
      { solutionId: 3, name: "Shop API", status: repoStatus(), unavailable: null },
      {
        solutionId: 5,
        name: "Shop Web",
        status: null,
        unavailable: "no folder on this machine yet",
      },
    ]);
    render(<GitExplorer productId={1} />);

    expect(await screen.findByText("feature/checkout")).toBeInTheDocument();
    expect(screen.getByText(/no folder on this machine yet/)).toBeInTheDocument();
  });

  it("offers to resolve a conflicted file and opens the three panes", async () => {
    const user = userEvent.setup();
    mocked.productGitOverview.mockResolvedValue([
      {
        solutionId: 3,
        name: "Shop API",
        status: repoStatus({
          merging: true,
          files: [
            { path: "src/basket.rs", status: "modified", conflicted: true, staged: false },
            { path: "src/fine.rs", status: "modified", conflicted: false, staged: false },
          ],
        }),
        unavailable: null,
      },
    ]);
    mocked.readConflictSides.mockResolvedValue({
      path: "src/basket.rs",
      base: "was",
      mine: "my version",
      theirs: "their version",
      merged: "<<<<<<< HEAD\nmy version\n=======\ntheir version\n>>>>>>> other\n",
      unresolved: true,
    });
    render(<GitExplorer productId={1} />);

    expect(await screen.findByText(/1 file need/)).toBeInTheDocument();
    // an ordinary edit during a merge gets no Resolve button
    expect(screen.queryByLabelText("Resolve src/fine.rs in Shop API")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Resolve src/basket.rs in Shop API"));

    expect(
      await screen.findByRole("region", { name: "Merge conflict in src/basket.rs" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("My changes")).toHaveValue("my version");
    expect(screen.getByLabelText("Their changes")).toHaveValue("their version");
    expect(screen.getByLabelText("After the merge")).toHaveValue(
      "<<<<<<< HEAD\nmy version\n=======\ntheir version\n>>>>>>> other\n",
    );
  });

  /// Staging a file with `<<<<<<< HEAD` still in it is the classic way to
  /// commit a conflict, so the button stays shut until the markers are gone.
  it("refuses to mark resolved while conflict markers remain", async () => {
    const user = userEvent.setup();
    mocked.productGitOverview.mockResolvedValue([
      {
        solutionId: 3,
        name: "Shop API",
        status: repoStatus({
          merging: true,
          files: [
            { path: "src/basket.rs", status: "modified", conflicted: true, staged: false },
          ],
        }),
        unavailable: null,
      },
    ]);
    mocked.readConflictSides.mockResolvedValue({
      path: "src/basket.rs",
      base: "",
      mine: "mine",
      theirs: "theirs",
      merged: "<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> other\n",
      unresolved: true,
    });
    mocked.writeSolutionFile.mockResolvedValue(undefined);
    mocked.markConflictResolved.mockResolvedValue(undefined);
    render(<GitExplorer productId={1} />);

    await user.click(await screen.findByLabelText("Resolve src/basket.rs in Shop API"));
    const resolve = await screen.findByRole("button", { name: "Mark resolved" });
    expect(resolve).toBeDisabled();
    expect(screen.getByText(/conflict markers still present/)).toBeInTheDocument();

    // resolving the text by hand opens the gate
    await user.clear(screen.getByLabelText("After the merge"));
    await user.type(screen.getByLabelText("After the merge"), "the agreed version");

    expect(await screen.findByText(/no markers left/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));

    // saved before staged: staging reads from disk, so an unsaved buffer would
    // stage a version nobody chose
    await waitFor(() =>
      expect(mocked.writeSolutionFile).toHaveBeenCalledWith(
        3,
        "src/basket.rs",
        "the agreed version",
      ),
    );
    expect(mocked.markConflictResolved).toHaveBeenCalledWith(3, "src/basket.rs");
  });
});
