import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentWorkspace from "../../components/ai/AgentWorkspace";
import type { AiJob, OpenQuestion, Run, Solution, WorkItem } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listWorkItems: vi.fn(),
    listRuns: vi.fn(),
    listAiJobs: vi.fn(),
    listOpenQuestions: vi.fn(),
    listSolutions: vi.fn(),
    listSprints: vi.fn(),
    listTeamMembers: vi.fn(),
    listWorkItemPlans: vi.fn(),
    listAiFeedback: vi.fn(),
    suggestDevCommand: vi.fn(),
    startRun: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// The editor reaches for the filesystem and a Monaco bundle, neither of which is
// what these tests are about — the rail and which sub-panels appear is.
vi.mock("../../components/code/CodeEditor", () => ({
  default: () => <div>the code editor</div>,
}));
vi.mock("../../components/planning/WorkItemBuildPlan", () => ({
  default: ({ item }: { item: WorkItem }) => <div>build plan for {item.title}</div>,
}));
vi.mock("../../components/code/WorkItemChanges", () => ({
  default: () => <div>the changed files</div>,
}));
vi.mock("../../components/code/RunTerminal", () => ({
  default: ({ title }: { title: string }) => <div>terminal: {title}</div>,
}));

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const solution: Solution = {
  id: 5,
  name: "Shop API",
  productId: 1,
  solutionType: "api",
  answers: "{}",
  origin: "created",
  githubUrl: null,
  githubVisibility: null,
  localPath: "C:/repos/shop-api",
  testCommand: null,
} as Solution;

const item = (over: Partial<WorkItem> = {}): WorkItem =>
  ({
    id: 9,
    productId: 1,
    title: "Add checkout",
    description: "",
    itemType: "story",
    status: "To Do",
    assigneeId: null,
    sprintId: null,
    ...over,
  }) as WorkItem;

const run = (over: Partial<Run> = {}): Run =>
  ({
    id: 3,
    workItemId: 9,
    workItemTitle: "Add checkout",
    solutionId: 5,
    solutionName: "Shop API",
    state: "notStarted",
    branch: "feature/checkout",
    worktreePath: "",
    ...over,
  }) as Run;

const job = (over: Partial<AiJob> = {}): AiJob => ({
  id: 1,
  workItemId: 9,
  workItemTitle: "Add checkout",
  purpose: "changePlan",
  state: "queued",
  message: "",
  submittedAt: 1000,
  startedAt: null,
  finishedAt: null,
  ...over,
});

const question = (over: Partial<OpenQuestion> = {}): OpenQuestion => ({
  id: 1,
  workItemId: 9,
  workItemTitle: "Add checkout",
  kind: "clarification",
  message: "Which payment provider?",
  whatIsNeeded: "Name the provider.",
  ...over,
});

function panel() {
  return <AgentWorkspace productId={1} solutions={[solution]} opened={null} />;
}

describe("AgentWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listWorkItems.mockResolvedValue([item()]);
    mocked.listRuns.mockResolvedValue([]);
    mocked.listAiJobs.mockResolvedValue([]);
    mocked.listOpenQuestions.mockResolvedValue([]);
    mocked.listAiFeedback.mockResolvedValue([]);
    // Approved by default so the Start tests are about starting; the gate has
    // its own test below.
    mocked.listWorkItemPlans.mockResolvedValue([
      { solutionId: 5, workItemId: 9, approvedAt: 1_700_000_000_000 },
    ] as never);
    mocked.suggestDevCommand.mockResolvedValue({
      kind: "npm",
      start: "npm run dev",
      watch: "",
      watchNeeds: "",
      watchReady: false,
      watchBin: "",
      foundBy: "package.json",
      custom: false,
      unavailable: "",
    } as never);
  });

  /// Editing by hand did not go away when the tabs merged. It is the first rail
  /// entry and the default, so the tab is never empty and a repository can still
  /// be opened with no agent involved.
  it("shows the plain editor first, with no agent selected", async () => {
    render(panel());
    expect(await screen.findByText("the code editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Code/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  /// The rail is the "manage multiple AIs at once" half: every agent in the
  /// Product, named by work item and Solution, in one list.
  it("lists an agent per run, named by work item and Solution", async () => {
    mocked.listRuns.mockResolvedValue([
      run(),
      run({ id: 4, workItemId: 10, workItemTitle: "Add refunds", solutionId: 5 }),
    ]);
    mocked.listWorkItems.mockResolvedValue([
      item(),
      item({ id: 10, title: "Add refunds" }),
    ]);
    render(panel());

    expect(
      await screen.findByLabelText("Agent for Add checkout on Shop API"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Agent for Add refunds on Shop API"),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agents (2)" })).toBeInTheDocument();
  });

  /// A queued job has no run yet, and that is exactly the moment there is most
  /// to watch — leaving it out would empty the rail just after submitting.
  it("lists an agent that is still planning, before any run exists", async () => {
    mocked.listAiJobs.mockResolvedValue([job()]);
    render(panel());

    const entry = await screen.findByLabelText("Agent for Add checkout");
    expect(entry).toHaveTextContent("queued");
  });

  /// A question blocks that agent until answered, so it outranks whatever the
  /// run state happens to be — the badge says the thing that needs a person.
  it("says a question is waiting rather than the run state", async () => {
    mocked.listRuns.mockResolvedValue([run({ state: "prepared", worktreePath: "C:/wt/a" })]);
    mocked.listOpenQuestions.mockResolvedValue([question(), question({ id: 2 })]);
    render(panel());

    expect(
      await screen.findByLabelText("Agent for Add checkout on Shop API"),
    ).toHaveTextContent("2 questions");
  });

  /// The sub-panels are the other half of the request: one agent's plan, its
  /// code changes, its questions, a preview and its terminal, without leaving.
  it("opens plan, changes, questions, preview and terminal for a started run", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([
      run({ state: "prepared", worktreePath: "C:/wt/checkout" }),
    ]);
    render(panel());

    await user.click(await screen.findByLabelText("Agent for Add checkout on Shop API"));
    const tabs = await screen.findByRole("tablist", { name: "Agent sub-panels" });
    for (const name of ["Plan", "Changes", "Questions", "Preview", "Terminal"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
    expect(tabs).toBeInTheDocument();

    expect(await screen.findByText("build plan for Add checkout")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Changes" }));
    expect(await screen.findByText("the changed files")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    expect(
      await screen.findByRole("region", { name: /Preview of Add checkout/ }),
    ).toBeInTheDocument();
  });

  /// Changes, preview and a terminal all need a checkout. Offering four tabs
  /// where three cannot work yet would be a worse answer than saying what is
  /// missing and how to get it.
  it("offers only plan and questions until a run has a checkout, and says why", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([run()]); // notStarted, no worktree
    render(panel());

    await user.click(await screen.findByLabelText("Agent for Add checkout on Shop API"));
    expect(await screen.findByRole("tab", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Questions" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Preview" })).not.toBeInTheDocument();

    expect(
      screen.getByText(/Changes, preview and a terminal appear once/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Start Add checkout on Shop API"),
    ).toBeInTheDocument();
  });

  /// Starting is a press, not something the app does on your behalf: it makes a
  /// checkout and launches something that writes files.
  it("starts a run on request and opens its terminal", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([run()]);
    mocked.startRun.mockResolvedValue({
      runId: 3,
      worktreePath: "C:/wt/checkout",
      command: "claude 'read the brief'",
      runStart: "npm run dev",
      branch: "feature/checkout",
    } as never);
    render(panel());

    await user.click(await screen.findByLabelText("Agent for Add checkout on Shop API"));
    await user.click(screen.getByLabelText("Start Add checkout on Shop API"));

    expect(mocked.startRun).toHaveBeenCalledWith(9, 5);
    // Both terminals: the agent's, and the app beside it in the same checkout.
    expect(
      await screen.findByText("terminal: Add checkout → Shop API"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("terminal: Add checkout → Shop API — app"),
    ).toBeInTheDocument();
  });

  /// Starting makes a checkout and hands an agent a brief, so it waits on
  /// somebody having read the plan. The button says so before the press rather
  /// than after — the backend refuses either way, but a control that looks
  /// available and then errors teaches nothing.
  it("will not start a run whose plan is unapproved, and says where to approve", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([run()]);
    mocked.listWorkItemPlans.mockResolvedValue([
      { solutionId: 5, workItemId: 9, approvedAt: 0 },
    ] as never);
    render(panel());

    await user.click(await screen.findByLabelText("Agent for Add checkout on Shop API"));
    expect(
      await screen.findByText(/plan needs approving first/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Start Add checkout on Shop API")).toBeDisabled();
    expect(mocked.startRun).not.toHaveBeenCalled();
  });

  /// A per-agent view cannot answer "what is everything doing?" — the queue as a
  /// whole, every open question, and the runs with their merges still can.
  it("keeps the across-the-Product lists reachable", async () => {
    const user = userEvent.setup();
    render(panel());

    await user.click(await screen.findByRole("button", { name: /Queue, questions and runs/ }));
    expect(await screen.findByRole("region", { name: "Runs" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Questions" })).toBeInTheDocument();
  });
});
