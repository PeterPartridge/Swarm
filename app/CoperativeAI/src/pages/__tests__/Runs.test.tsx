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
    getAiConcurrency: vi.fn(),
    submitForPlanning: vi.fn(),
    listRuns: vi.fn(),
    startRun: vi.fn(),
    discardRunWorktree: vi.fn(),
    listAbandonedWorktrees: vi.fn(),
    removeWorktreeAt: vi.fn(),
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
});
