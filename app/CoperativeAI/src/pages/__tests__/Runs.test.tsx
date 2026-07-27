import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JobsPanel from "../../components/JobsPanel";
import RunsPanel from "../../components/RunsPanel";
import type { AiJob, Run } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listAiJobs: vi.fn(),
    getAiConcurrency: vi.fn(),
    submitForPlanning: vi.fn(),
    listRuns: vi.fn(),
    startRun: vi.fn(),
    discardRunWorktree: vi.fn(),
  };
});

// RunTerminal reaches for xterm and the Tauri event API, neither of which runs
// in jsdom. It is not what these tests are about — the panel's behaviour is —
// so it stands in as a marker.
vi.mock("../../components/RunTerminal", () => ({
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
  ...over,
});

describe("JobsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    });
    render(<RunsPanel productId={1} />);

    await user.click(await screen.findByRole("button", { name: /Start all \(2\)/ }));

    await waitFor(() => expect(mocked.startRun).toHaveBeenCalledTimes(2));
    expect(mocked.startRun).toHaveBeenCalledWith(9, 3);
    expect(mocked.startRun).toHaveBeenCalledWith(10, 3);
  });
});
