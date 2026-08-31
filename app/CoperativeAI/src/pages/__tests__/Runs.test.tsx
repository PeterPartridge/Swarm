import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JobsPanel from "../../components/ai/JobsPanel";
import RunsPanel from "../../components/ai/RunsPanel";
import type { AiJob, Run } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listAiJobs: vi.fn(),
    cancelAiJob: vi.fn(),
    getAiConcurrency: vi.fn(),
    submitForPlanning: vi.fn(),
    listRuns: vi.fn(),
    listTerminals: vi.fn(),
    startRun: vi.fn(),
    discardRunWorktree: vi.fn(),
    listAbandonedWorktrees: vi.fn(),
    removeWorktreeAt: vi.fn(),
    previewRunMerge: vi.fn(),
    mergeRunBranch: vi.fn(),
    abortRunMerge: vi.fn(),
  };
});

// RunTerminal reaches for xterm and the Tauri event API, neither of which runs
// in jsdom. It is not what these tests are about — the panel's behaviour is —
// so it stands in as a marker.
vi.mock("../../components/code/RunTerminal", () => ({
  default: ({ title }: { title: string }) => <div data-testid="run-terminal">{title}</div>,
}));

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const job = (over: Partial<AiJob> = {}): AiJob => ({
  id: 1,
  workItemId: 9,
  workItemTitle: "Add checkout",
  purpose: "changePlan",
  state: "queued",
  message: "",
  submittedAt: 1,
  startedAt: null,
  finishedAt: null,
  ...over,
});

const run = (over: Partial<Run> = {}): Run => ({
  id: 0,
  workItemId: 9,
  workItemTitle: "Add checkout",
  solutionId: 3,
  solutionName: "Shop API",
  state: "notStarted",
  branch: "feature/9-add-checkout",
  worktreePath: "",
  terminalId: "",
  briefPath: "",
  filesChanged: 0,
  // Approved by default so the existing tests stay about starting and merging;
  // the gate has its own tests below.
  planApproved: true,
  ...over,
});

describe("JobsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listTerminals.mockResolvedValue([]);
    mocked.getAiConcurrency.mockResolvedValue({ limit: 1, available: 1 });
  });

  /// The queue is the point: submitting shows a job waiting behind the one
  /// running, so you can carry on and submit another.
  it("shows what is running and what is waiting behind it", async () => {
    mocked.listAiJobs.mockResolvedValue([
      job({ id: 1, state: "running", workItemTitle: "Add checkout" }),
      job({ id: 2, state: "queued", workItemTitle: "Add refunds" }),
    ]);
    render(<JobsPanel productId={1} />);

    expect(await screen.findByText("Add checkout")).toBeInTheDocument();
    expect(screen.getByText("Add refunds")).toBeInTheDocument();
    expect(screen.getByText(/1 running, 1 waiting/)).toBeInTheDocument();
  });

  /// A blocked job asked a question rather than failing, and the queue says so.
  it("distinguishes a blocked job from a failed one", async () => {
    mocked.listAiJobs.mockResolvedValue([
      job({ id: 1, state: "blocked", message: "which payment provider?" }),
    ]);
    render(<JobsPanel productId={1} />);
    expect(await screen.findByText("asked a question")).toBeInTheDocument();
    expect(screen.getByText("which payment provider?")).toBeInTheDocument();
  });

  it("says nothing is submitted when the queue is empty", async () => {
    mocked.listAiJobs.mockResolvedValue([]);
    render(<JobsPanel productId={1} />);
    expect(await screen.findByText(/Nothing submitted yet/)).toBeInTheDocument();
  });
});

describe("RunsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listTerminals.mockResolvedValue([]);
    mocked.listAbandonedWorktrees.mockResolvedValue([]);
  });

  /// The debt this closes: a run somebody walked away from kept its checkout,
  /// and nothing ever mentioned it again — so the pile was invisible until the
  /// disk filled.
  it("surfaces leftover checkouts and removes one", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([]);
    mocked.listAbandonedWorktrees.mockResolvedValue([
      {
        solutionId: 3,
        solutionName: "Shop API",
        path: "C:/repos/.coperativeai-worktrees/feature-9",
      },
    ]);
    mocked.removeWorktreeAt.mockResolvedValue(undefined);
    render(<RunsPanel productId={1} />);

    const leftovers = await screen.findByRole("region", { name: "Leftover checkouts" });
    expect(leftovers).toHaveTextContent("Shop API");

    await user.click(
      screen.getByLabelText(
        "Remove leftover checkout C:/repos/.coperativeai-worktrees/feature-9",
      ),
    );

    await waitFor(() =>
      expect(mocked.removeWorktreeAt).toHaveBeenCalledWith(
        3,
        "C:/repos/.coperativeai-worktrees/feature-9",
      ),
    );
  });

  /// Refusing to remove one holding uncommitted work is the point of the
  /// refusal, so the reason has to reach the screen.
  it("surfaces a refusal to remove a checkout still holding work", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([]);
    mocked.listAbandonedWorktrees.mockResolvedValue([
      { solutionId: 3, solutionName: "Shop API", path: "C:/wt/feature-9" },
    ]);
    mocked.removeWorktreeAt.mockRejectedValue(
      "that checkout still has uncommitted changes",
    );
    render(<RunsPanel productId={1} />);

    await user.click(
      await screen.findByLabelText("Remove leftover checkout C:/wt/feature-9"),
    );

    expect(await screen.findByText(/uncommitted changes/)).toBeInTheDocument();
  });

  /// A clean branch says how much is coming and offers to merge it.
  it("checks a merge and reports it as clean", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([run({ id: 4, state: "prepared" })]);
    mocked.previewRunMerge.mockResolvedValue({
      clean: true,
      conflicts: [],
      commitsAhead: 3,
    });
    render(<RunsPanel productId={1} />);

    await user.click(
      await screen.findByLabelText("Check merge for Add checkout on Shop API"),
    );

    expect(await screen.findByText(/3 commits to merge, cleanly/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge Add checkout on Shop API" })).toBeInTheDocument();
  });

  /// The case the feature exists for: two agents on one file. The clash is
  /// named before anything is touched.
  it("names the files that will conflict before merging", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([run({ id: 4, state: "prepared" })]);
    mocked.previewRunMerge.mockResolvedValue({
      clean: false,
      conflicts: ["src/checkout.rs"],
      commitsAhead: 2,
    });
    render(<RunsPanel productId={1} />);

    await user.click(
      await screen.findByLabelText("Check merge for Add checkout on Shop API"),
    );

    expect(await screen.findByText(/1 file will conflict/)).toBeInTheDocument();
    expect(screen.getByText("src/checkout.rs")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Merge Add checkout on Shop API" }),
    ).toHaveTextContent("Merge and resolve");
  });

  /// An agent that wrote nothing has nothing to merge, and "merged cleanly"
  /// about zero commits would read as success.
  it("says there is nothing to merge when the branch has no commits", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([run({ id: 4, state: "prepared" })]);
    mocked.previewRunMerge.mockResolvedValue({ clean: true, conflicts: [], commitsAhead: 0 });
    render(<RunsPanel productId={1} />);

    await user.click(
      await screen.findByLabelText("Check merge for Add checkout on Shop API"),
    );

    expect(await screen.findByText(/Nothing to merge/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Merge Add checkout on Shop API" }),
    ).not.toBeInTheDocument();
  });

  /// A conflicted merge is left standing for the three-way editor, and there
  /// has to be a way out of it.
  it("leaves a conflicted merge open and offers to abandon it", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([run({ id: 4, state: "prepared" })]);
    mocked.previewRunMerge.mockResolvedValue({
      clean: false,
      conflicts: ["src/checkout.rs"],
      commitsAhead: 1,
    });
    mocked.mergeRunBranch.mockResolvedValue({
      merged: false,
      conflicts: ["src/checkout.rs"],
      message: "feature/9 conflicts with main.",
    });
    mocked.abortRunMerge.mockResolvedValue(undefined);
    render(<RunsPanel productId={1} />);

    await user.click(
      await screen.findByLabelText("Check merge for Add checkout on Shop API"),
    );
    await user.click(screen.getByRole("button", { name: "Merge Add checkout on Shop API" }));

    const abandon = await screen.findByLabelText(
      "Abandon the merge for Add checkout on Shop API",
    );
    await user.click(abandon);
    await waitFor(() => expect(mocked.abortRunMerge).toHaveBeenCalledWith(4));
  });

  /// Merging over uncommitted work is how work gets lost; the refusal has to
  /// reach the screen.
  it("surfaces a refusal to merge over uncommitted work", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([run({ id: 4, state: "prepared" })]);
    mocked.previewRunMerge.mockResolvedValue({ clean: true, conflicts: [], commitsAhead: 1 });
    mocked.mergeRunBranch.mockRejectedValue(
      "there are 2 uncommitted files here — commit or stash before merging",
    );
    render(<RunsPanel productId={1} />);

    await user.click(
      await screen.findByLabelText("Check merge for Add checkout on Shop API"),
    );
    await user.click(screen.getByRole("button", { name: "Merge Add checkout on Shop API" }));

    expect(await screen.findByText(/uncommitted files/)).toBeInTheDocument();
  });

  /// No leftovers means no section at all — a tidy machine should not carry a
  /// permanent empty warning box.
  it("shows no leftovers section when there are none", async () => {
    mocked.listRuns.mockResolvedValue([]);
    render(<RunsPanel productId={1} />);
    await screen.findByText(/No runs yet/);
    expect(
      screen.queryByRole("region", { name: "Leftover checkouts" }),
    ).not.toBeInTheDocument();
  });

  /// A run per (work item, Solution) with its branch, and Start for the ones
  /// not yet begun.
  it("lists a run per affected Solution with its branch", async () => {
    mocked.listRuns.mockResolvedValue([
      run({ workItemTitle: "Add checkout", solutionName: "Shop API" }),
      run({ workItemTitle: "Add checkout", solutionName: "Shop Web", solutionId: 5 }),
    ]);
    render(<RunsPanel productId={1} />);

    expect(await screen.findByText("→ Shop API")).toBeInTheDocument();
    expect(screen.getByText("→ Shop Web")).toBeInTheDocument();
    expect(screen.getAllByText("feature/9-add-checkout")).toHaveLength(2);
  });

  /// Starting a run prepares its worktree and opens a terminal for it — and
  /// two started runs means two terminals, which is the "simultaneously".
  it("starts a run and opens its own terminal", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([run()]);
    mocked.startRun.mockResolvedValue({
      runId: 1,
      worktreePath: "C:/repos/.coperativeai-worktrees/feature-9",
      branch: "feature/9-add-checkout",
      briefPath: "brief.md",
      command: "claude 'read brief.md'",
      runStart: "",
    });
    render(<RunsPanel productId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Start Add checkout on Shop API" }),
    );

    await waitFor(() => expect(mocked.startRun).toHaveBeenCalledWith(9, 3));
    // its terminal appears
    expect(await screen.findByTestId("run-terminal")).toHaveTextContent(
      "Add checkout → Shop API",
    );
  });

  /// The "boots the app without a click": a Solution with something to run gets
  /// a second terminal beside the agent's, running the app in the same worktree.
  it("boots the app in its own terminal when the Solution has a run command", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([run()]);
    mocked.startRun.mockResolvedValue({
      runId: 1,
      worktreePath: "C:/repos/.coperativeai-worktrees/feature-9",
      branch: "feature/9-add-checkout",
      briefPath: "brief.md",
      command: "claude 'read brief.md'",
      runStart: "npm run dev",
    });
    render(<RunsPanel productId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Start Add checkout on Shop API" }),
    );

    // two terminals: the agent's, and the app's
    await waitFor(() => expect(screen.getAllByTestId("run-terminal")).toHaveLength(2));
    expect(screen.getByText("Add checkout → Shop API — app")).toBeInTheDocument();
  });

  /// Start is refused when the run has no branch — a run needs its own branch,
  /// because that is what keeps it apart from the others.
  it("will not start a run with no branch set", async () => {
    mocked.listRuns.mockResolvedValue([run({ branch: "" })]);
    render(<RunsPanel productId={1} />);
    expect(
      await screen.findByRole("button", { name: "Start Add checkout on Shop API" }),
    ).toBeDisabled();
  });

  /// Start-all starts every not-yet-started run, which is how several agents
  /// are launched at once.
  it("starts every ready run at once", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([
      run({ workItemId: 9, solutionId: 3 }),
      run({ workItemId: 10, solutionId: 3, workItemTitle: "Add refunds" }),
    ]);
    mocked.startRun.mockResolvedValue({
      runId: 1,
      worktreePath: "C:/wt",
      branch: "b",
      briefPath: "brief.md",
      command: "claude",
      runStart: "",
    });
    render(<RunsPanel productId={1} />);

    await user.click(await screen.findByRole("button", { name: /Start all \(2\)/ }));

    await waitFor(() => expect(mocked.startRun).toHaveBeenCalledTimes(2));
    expect(mocked.startRun).toHaveBeenCalledWith(9, 3);
    expect(mocked.startRun).toHaveBeenCalledWith(10, 3);
  });

  /// **Several agents at once, wherever each was started.** A run launched by
  /// Execute on a work item keeps going when that panel closes — the shell is
  /// the backend’s — so this panel picks it up rather than offering Start for
  /// something already running.
  it("picks up an agent started somewhere else", async () => {
    mocked.listRuns.mockResolvedValue([
      run({ id: 3, state: "prepared", worktreePath: "C:/wt/checkout" }),
    ]);
    mocked.listTerminals.mockResolvedValue([
      {
        id: "t1",
        solutionId: 3,
        shell: "pwsh",
        // The same folder as the run's, spelled the way Windows hands it back —
        // which is the whole reason the comparison is not `===`.
        cwd: "C:\\wt\\checkout",
        startedAt: 1,
      },
    ]);
    render(<RunsPanel productId={7} />);

    // Its terminal is on screen without anybody pressing Start here.
    expect(await screen.findByTestId("run-terminal")).toBeInTheDocument();
    expect(mocked.startRun).not.toHaveBeenCalled();
  });

});

describe("RunsPanel and the approval gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listTerminals.mockResolvedValue([]);
    mocked.listAbandonedWorktrees.mockResolvedValue([]);
  });

  /// "Start all (3)" that starts nothing is worse than an accurate smaller
  /// number: it names work it cannot do and then reports one error for however
  /// many it skipped.
  it("counts only the runs Start all would actually start", async () => {
    mocked.listRuns.mockResolvedValue([
      run({ workItemId: 9, planApproved: true }),
      run({ workItemId: 10, workItemTitle: "Add refunds", planApproved: false }),
      run({ workItemId: 11, workItemTitle: "Add invoices", planApproved: false }),
    ]);
    render(<RunsPanel productId={1} />);

    expect(await screen.findByRole("button", { name: "Start all (1)" })).toBeEnabled();
    // And the two that cannot start say why, once, with the fix.
    expect(
      screen.getByText(/2 more runs are ready but their plans have not been approved/),
    ).toBeInTheDocument();
  });

  /// Per row, the button says what is missing instead of looking available and
  /// then failing on the press.
  it("names what an unapproved run is waiting for", async () => {
    mocked.listRuns.mockResolvedValue([run({ planApproved: false })]);
    render(<RunsPanel productId={1} />);

    const start = await screen.findByLabelText("Start Add checkout on Shop API");
    expect(start).toBeDisabled();
    expect(start).toHaveTextContent("Needs an approved plan");
    expect(mocked.startRun).not.toHaveBeenCalled();
  });
});

describe("JobsPanel cancelling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listTerminals.mockResolvedValue([]);
    mocked.getAiConcurrency.mockResolvedValue({ limit: 1, available: 0 });
  });

  /// A 15-minute agent turn with no way out was the debt this closes.
  it("stops a running job and passes on what that achieved", async () => {
    const user = userEvent.setup();
    mocked.listAiJobs.mockResolvedValue([job({ id: 7, state: "running" })]);
    mocked.cancelAiJob.mockResolvedValue(
      "Stopped waiting for it. If it had already reached a paid provider that call may still be charged — and because no reply came back, it will not appear in the ledger.",
    );
    render(<JobsPanel productId={1} />);

    await user.click(await screen.findByLabelText("Stop Add checkout"));

    await waitFor(() => expect(mocked.cancelAiJob).toHaveBeenCalledWith(7));
    // The warning is the backend's, shown verbatim: only it knows whether the
    // call had already left, and that is the whole difference.
    expect(await screen.findByRole("status")).toHaveTextContent(
      /may still be charged.*will not appear in the ledger/,
    );
  });

  /// Stopping something that never reached a provider costs nothing, and saying
  /// so is as important as the warning — otherwise every cancel reads alarming.
  it("says a queued job cost nothing to stop", async () => {
    const user = userEvent.setup();
    mocked.listAiJobs.mockResolvedValue([job({ id: 8, state: "queued" })]);
    mocked.cancelAiJob.mockResolvedValue(
      "Stopped before it reached a provider, so nothing was spent.",
    );
    render(<JobsPanel productId={1} />);

    await user.click(await screen.findByLabelText("Stop Add checkout"));
    expect(await screen.findByRole("status")).toHaveTextContent(/nothing was spent/);
  });

  /// A finished job has nothing to stop, and a button that only explains itself
  /// is worse than no button.
  it("offers no way to stop a job that has already finished", async () => {
    mocked.listAiJobs.mockResolvedValue([
      job({ id: 9, state: "done", message: "wrote two plans" }),
    ]);
    render(<JobsPanel productId={1} />);

    expect(await screen.findByText("done")).toBeInTheDocument();
    expect(screen.queryByLabelText("Stop Add checkout")).not.toBeInTheDocument();
  });

  /// Stopped is not failed. Filing a choice as a fault sends people looking for
  /// a bug that is not there.
  it("shows a stopped job as stopped, not failed", async () => {
    mocked.listAiJobs.mockResolvedValue([job({ id: 10, state: "cancelled" })]);
    render(<JobsPanel productId={1} />);

    expect(await screen.findByText("stopped")).toBeInTheDocument();
    expect(screen.queryByText("failed")).not.toBeInTheDocument();
  });
});