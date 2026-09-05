import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentWorkspace from "../../components/ai/AgentWorkspace";
import type {
  AiJob,
  ChangeReview,
  OpenQuestion,
  Run,
  Solution,
  WorkItem,
} from "../../lib/backend";

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
    // The lifecycle panel hangs off every work item now. Unmocked these fall
    // through to the real invoke and each renders its own error alert.
    lifecycleGates: vi.fn(),
    listLifecycleSteps: vi.fn(),
    listWorkItemSteps: vi.fn(),
    setWorkItemStep: vi.fn(),
    listWorkItemPlans: vi.fn(),
    listAiFeedback: vi.fn(),
    suggestDevCommand: vi.fn(),
    startRun: vi.fn(),
    listMySpaces: vi.fn(),
    openWorkItemWindow: vi.fn(),
    openFileWindow: vi.fn(),
    openMySpace: vi.fn(),
    closeMySpace: vi.fn(),
    // The Build view reads the tree, the changed files and the review itself.
    // Leaving any of them to fall through to the real `invoke` would render an
    // error state and still pass, which is the trap this file has hit before.
    readSolutionTree: vi.fn(),
    productChangedFiles: vi.fn(),
    reviewSolutionChanges: vi.fn(),
    settleChangeRun: vi.fn(),
    listTestSuites: vi.fn(),
    runSolutionTests: vi.fn(),
    productGitOverview: vi.fn(),
    listAiCalls: vi.fn(),
    readSolutionFile: vi.fn(),
    writeSolutionFile: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// The editor reaches for the filesystem and a Monaco bundle, neither of which is
// what these tests are about — the lane, the tree and which panes appear is.
vi.mock("../../components/code/CodeEditor", () => ({
  default: () => <div>the code editor</div>,
}));
vi.mock("../../components/planning/WorkItemBuildPlan", () => ({
  default: ({ item }: { item: WorkItem }) => <div>build plan for {item.title}</div>,
}));
vi.mock("../../components/code/WorkItemChanges", () => ({
  default: () => <div>the recorded scope</div>,
}));
vi.mock("../../components/code/RunTerminal", () => ({
  default: ({ title }: { title: string }) => <div>terminal: {title}</div>,
}));
// Monaco will not load in jsdom, and these tests are about which file the pane
// opens rather than about the text surface itself.
vi.mock("../../components/code/CodeWindow", () => ({
  default: ({ path }: { path: string }) => <div>editing {path}</div>,
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
    filesChanged: 0,
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

const review = (over: Partial<ChangeReview> = {}): ChangeReview => ({
  changes: [
    {
      path: "src/checkout.ts",
      status: "modified",
      addedLines: 12,
      removedLines: 3,
      diff: "@@ -1 +1 @@\n-old line\n+new line",
    },
  ],
  report: {
    violations: [],
    notices: [],
    filesChanged: 1,
    addedLines: 12,
    removedLines: 3,
  },
  noRules: false,
  runId: 3,
  runState: "prepared",
  ...over,
});

function panel(onOpenWork?: (id: number) => void) {
  return (
    <AgentWorkspace
      productId={1}
      solutions={[solution]}
      opened={null}
      onOpenWork={onOpenWork}
    />
  );
}

describe("AgentWorkspace (the Build view)", () => {
  beforeEach(() => {
    // No spaces unless a test says otherwise — the ordinary state, and the one
    // where the lane looks as it always did.
    mocked.listMySpaces.mockResolvedValue([]);
    mocked.openMySpace.mockResolvedValue({
      branch: "myspace/desk",
      name: "desk",
      path: "C:/repos/.coperativeai-worktrees/myspace-desk",
    });
    mocked.closeMySpace.mockResolvedValue(undefined);
    vi.clearAllMocks();
    mocked.lifecycleGates.mockResolvedValue([]);
    mocked.listLifecycleSteps.mockResolvedValue([]);
    mocked.listWorkItemSteps.mockResolvedValue([]);
    mocked.setWorkItemStep.mockResolvedValue(undefined);
    mocked.listWorkItems.mockResolvedValue([item()]);
    mocked.listRuns.mockResolvedValue([]);
    mocked.listAiJobs.mockResolvedValue([]);
    mocked.listOpenQuestions.mockResolvedValue([]);
    mocked.listAiFeedback.mockResolvedValue([]);
    mocked.readSolutionTree.mockResolvedValue({ entries: [], truncated: false });
    mocked.productChangedFiles.mockResolvedValue([]);
    mocked.listTestSuites.mockResolvedValue([]);
    mocked.productGitOverview.mockResolvedValue([]);
    mocked.listAiCalls.mockResolvedValue({ totals: null, calls: [] } as never);
    mocked.readSolutionFile.mockResolvedValue("");
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

  /// Editing by hand did not go away when the tabs merged. Your own workspace is
  /// the first lane card and the default, so the view is never empty and a
  /// repository can still be opened with no agent involved.
  it("shows your own workspace first, with no agent selected", async () => {
    render(panel());
    expect(await screen.findByText("the code editor")).toBeInTheDocument();
    expect(screen.getByLabelText("Your workspace")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  /// The lane is the "manage multiple AIs at once" half: every agent in the
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
  });

  /// A queued job has no run yet, and that is exactly the moment there is most
  /// to watch — leaving it out would empty the lane just after submitting.
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

  /// **The honesty rule, in the lane.** The app cannot see how far through its
  /// work an agent is, so the card shows the stage the database actually holds
  /// and never a percentage — a bar at 68% would be invented.
  it("shows the stage an agent has reached and no progress figure", async () => {
    mocked.listRuns.mockResolvedValue([
      run({ state: "prepared", worktreePath: "C:/wt/a" }),
    ]);
    render(panel());

    const card = await screen.findByLabelText("Agent for Add checkout on Shop API");
    expect(card).toHaveTextContent("Plan");
    expect(card).toHaveTextContent("Code");
    expect(card).toHaveTextContent("Review");
    expect(within(card).getByLabelText("Stage: Code")).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/\d+%/);
  });

  /// The panes are the other half of the request: one agent's plan, its diffs,
  /// its tests, a preview and its terminal, without leaving.
  it("opens plan, changes, tests, preview and a terminal for a started run", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([
      run({ state: "prepared", worktreePath: "C:/wt/checkout" }),
    ]);
    mocked.reviewSolutionChanges.mockResolvedValue(review());
    render(panel());

    await user.click(await screen.findByLabelText("Agent for Add checkout on Shop API"));
    const tabs = await screen.findByRole("tablist", { name: "Agent sub-panels" });
    // "AI feedback", not "Questions": the panel shows what failed and what the
    // AI could not do as well as what it asked.
    for (const name of ["Plan", "Changes", "Tests", "Preview", "Run", "Scope", "AI feedback"]) {
      expect(within(tabs).getByRole("tab", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }

    expect(await screen.findByText("build plan for Add checkout")).toBeInTheDocument();
    await user.click(within(tabs).getByRole("tab", { name: /^Scope/ }));
    expect(await screen.findByText("the recorded scope")).toBeInTheDocument();
    await user.click(within(tabs).getByRole("tab", { name: /^Preview/ }));
    expect(
      await screen.findByRole("region", { name: /Preview of Add checkout/ }),
    ).toBeInTheDocument();
  });

  /// Changes, tests, preview and a terminal all need a checkout. Offering panes
  /// that cannot work yet would be a worse answer than saying what is missing
  /// and how to get it.
  it("offers only plan and questions until a run has a checkout, and says why", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([run()]); // notStarted, no worktree
    render(panel());

    await user.click(await screen.findByLabelText("Agent for Add checkout on Shop API"));
    const tabs = await screen.findByRole("tablist", { name: "Agent sub-panels" });
    expect(within(tabs).getByRole("tab", { name: /^Plan/ })).toBeInTheDocument();
    expect(within(tabs).getByRole("tab", { name: /^AI feedback/ })).toBeInTheDocument();
    expect(within(tabs).queryByRole("tab", { name: /^Changes/ })).not.toBeInTheDocument();
    expect(within(tabs).queryByRole("tab", { name: /^Preview/ })).not.toBeInTheDocument();

    expect(
      screen.getByText(/Changes, tests, preview and a terminal appear once/),
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

  /// **The honesty rule, in the ship rail.** Every check is read back from the
  /// run rather than ticked by hand, so an unmet check means work outstanding
  /// and not merely an unticked box.
  it("derives the ship checks from the review rather than offering tickboxes", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([
      run({ state: "prepared", worktreePath: "C:/wt/checkout" }),
    ]);
    mocked.reviewSolutionChanges.mockResolvedValue(review());
    render(panel());

    // Reviewing is per working copy, and the Files pane opens on the whole
    // Product — so picking the agent is what says which one.
    await user.click(await screen.findByLabelText("Agent for Add checkout on Shop API"));
    const rail = await screen.findByRole("complementary", { name: /Review and ship/ });
    // Nothing has been read, so nothing claims to have passed — and there is no
    // checkbox anywhere to claim it with.
    expect(within(rail).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(rail).toHaveTextContent("Nothing read yet");

    await user.click(within(rail).getByRole("button", { name: "Review what changed" }));
    expect(await within(rail).findByText("+12 added")).toBeInTheDocument();
    expect(within(rail).getByText("−3 removed")).toBeInTheDocument();
    // Tests were never run here, so that line stays unknown rather than green.
    expect(rail).toHaveTextContent("not run");
  });

  /// **The agent's own checkout, not the Solution's folder.** An agent works in
  /// a worktree of its own; reviewing the Solution folder instead read the
  /// clean main checkout and reported "nothing has changed" while the finished
  /// work sat in a folder next door — the branch and the changes were both
  /// there, and the app was looking in the wrong place.
  it("reviews the selected agent's worktree rather than the Solution folder", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([
      run({ id: 42, state: "prepared", worktreePath: "C:/wt/checkout" }),
    ]);
    mocked.reviewSolutionChanges.mockResolvedValue(review({ runId: 42 }));
    render(panel());

    await user.click(await screen.findByLabelText("Agent for Add checkout on Shop API"));
    const rail = await screen.findByRole("complementary", { name: /Review and ship/ });
    await user.click(within(rail).getByRole("button", { name: "Review what changed" }));

    await waitFor(() =>
      expect(mocked.reviewSolutionChanges).toHaveBeenCalledWith(5, 42),
    );
  });

  /// With no agent picked there is no worktree to read, and the workspace on
  /// disk is a real thing to review — so it stays reviewable, as it always was.
  it("reviews the workspace itself when no agent is selected", async () => {
    const user = userEvent.setup();
    mocked.reviewSolutionChanges.mockResolvedValue(review({ runId: null }));
    render(panel());

    // Picking the Solution rather than an agent: that is the "what have I
    // changed myself" case, and it still reads the folder on disk.
    await user.click(await screen.findByRole("tab", { name: /Shop API/ }));
    const rail = await screen.findByRole("complementary", { name: /Review and ship/ });
    await user.click(within(rail).getByRole("button", { name: "Review what changed" }));

    await waitFor(() =>
      expect(mocked.reviewSolutionChanges).toHaveBeenCalledWith(5, undefined),
    );
  });

  /// A broken rule is reported, and keeping the change anyway is still allowed —
  /// it is recorded as exactly that rather than laundered into a clean pass.
  it("names a broken rule and still allows the change to be kept", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([
      run({ state: "prepared", worktreePath: "C:/wt/checkout" }),
    ]);
    mocked.reviewSolutionChanges.mockResolvedValue(
      review({
        report: {
          violations: [
            { kind: "disallowedTech", path: "src/checkout.ts", detail: "uses moment" },
          ],
          notices: [],
          filesChanged: 1,
          addedLines: 12,
          removedLines: 3,
        },
      }),
    );
    mocked.settleChangeRun.mockResolvedValue();
    render(panel());

    await user.click(await screen.findByLabelText("Agent for Add checkout on Shop API"));
    const rail = await screen.findByRole("complementary", { name: /Review and ship/ });
    await user.click(within(rail).getByRole("button", { name: "Review what changed" }));

    expect(await within(rail).findByText(/uses moment/)).toBeInTheDocument();
    await user.click(
      within(rail).getByLabelText("Keep the changes in Shop API"),
    );
    expect(mocked.settleChangeRun).toHaveBeenCalledWith(3, "kept");
    expect(
      await within(rail).findByText(/with the broken rules above on the record/),
    ).toBeInTheDocument();
  });

  /// **The merge.** Picking a Solution to open and then browsing its files were
  /// two steps for one intention. With none picked the Files pane shows every
  /// Solution in the Product as a foldable root; the Solution bar scopes it.
  it("shows every Solution's files when none is picked, and scopes when one is", async () => {
    const user = userEvent.setup();
    const other = { ...solution, id: 6, name: "Shop Web", localPath: "C:/repos/web" };
    mocked.readSolutionTree.mockResolvedValue({
      entries: [{ path: "src/main.ts", name: "main.ts", isDir: false, depth: 0 }],
      truncated: false,
    });
    render(
      <AgentWorkspace productId={1} solutions={[solution, other]} opened={null} />,
    );

    // Opens on the whole Product, with a root per Solution.
    const files = await screen.findByRole("region", { name: "Files" });
    expect(await within(files).findByLabelText("Solution Shop API")).toBeInTheDocument();
    expect(within(files).getByLabelText("Solution Shop Web")).toBeInTheDocument();

    // Picking one on the Solution bar scopes the pane to it — and with a single
    // root there is no heading, because an unfoldable root is just an indent.
    await user.click(screen.getByRole("tab", { name: /Shop Web/ }));
    await waitFor(() =>
      expect(within(files).queryByLabelText("Solution Shop API")).not.toBeInTheDocument(),
    );
    expect(within(files).queryByLabelText("Solution Shop Web")).not.toBeInTheDocument();
  });

  /// Any click on a file opens it, whatever else the middle pane was showing.
  it("opens the file that was clicked in the editor", async () => {
    const user = userEvent.setup();
    mocked.readSolutionTree.mockResolvedValue({
      entries: [{ path: "src/main.ts", name: "main.ts", isDir: false, depth: 0 }],
      truncated: false,
    });
    mocked.readSolutionFile.mockResolvedValue("export const answer = 42;");
    render(panel());

    await user.click(await screen.findByLabelText("src/main.ts"));

    expect(
      await screen.findByRole("region", { name: "src/main.ts in Shop API" }),
    ).toBeInTheDocument();
    expect(mocked.readSolutionFile).toHaveBeenCalledWith(5, "src/main.ts");
    // Closing puts back whatever was showing before.
    await user.click(screen.getByLabelText("Close src/main.ts"));
    expect(await screen.findByText("the code editor")).toBeInTheDocument();
  });

  /// The tree and the workbench sit side by side for one reason: picking a file
  /// is a request to see what changed in it.
  it("opens a file's diff when it is picked in the tree", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([
      run({ state: "prepared", worktreePath: "C:/wt/checkout" }),
    ]);
    mocked.readSolutionTree.mockResolvedValue({
      entries: [
        { path: "src", name: "src", isDir: true, depth: 0 },
        { path: "src/checkout.ts", name: "checkout.ts", isDir: false, depth: 1 },
      ],
      truncated: false,
    });
    mocked.reviewSolutionChanges.mockResolvedValue(review());
    render(panel());

    await user.click(await screen.findByLabelText("Agent for Add checkout on Shop API"));
    const rail = screen.getByRole("complementary", { name: /Review and ship/ });
    await user.click(within(rail).getByRole("button", { name: "Review what changed" }));

    await user.click(await screen.findByLabelText("src/checkout.ts"));
    expect(await screen.findByText(/\+new line/)).toBeInTheDocument();
  });

  /// **The lane links, it does not launch.** Handing work to an agent means
  /// approving a plan and pressing Start, both of which are deliberate presses
  /// on the item's build plan — so this card opens the item in Work rather than
  /// growing a second way to begin a run.
  it("links an item with no agent through to Work, and starts nothing", async () => {
    const user = userEvent.setup();
    const opened: number[] = [];
    mocked.listWorkItems.mockResolvedValue([item(), item({ id: 12, title: "Add refunds" })]);
    mocked.listRuns.mockResolvedValue([run({ state: "prepared", worktreePath: "C:/wt/a" })]);
    render(panel((id) => opened.push(id)));

    // Item 9 has the agent; 12 has none, so that is the one offered.
    const link = await screen.findByLabelText("Open Add refunds in Work");
    expect(link).toHaveTextContent("1 item with no agent");
    await user.click(link);

    expect(opened).toEqual([12]);
    expect(mocked.startRun).not.toHaveBeenCalled();
  });

  /// With every item already handed over there is nothing to link to, so the
  /// card is absent rather than present and inert.
  it("hides the hand-over card when every item has an agent", async () => {
    // The only work item is the one run() belongs to, so nothing is unassigned.
    mocked.listWorkItems.mockResolvedValue([item()]);
    mocked.listRuns.mockResolvedValue([run({ state: "prepared", worktreePath: "C:/wt/a" })]);
    render(panel(() => {}));

    await screen.findByLabelText("Agent for Add checkout on Shop API");
    expect(screen.queryByText(/with no agent/)).not.toBeInTheDocument();
  });

  /// Debug runs the real Solutions in their real working copies, so it belongs
  /// with the Solutions in the top bar rather than inside one agent's workbench.
  it("opens Debug from the Solution bar, across every Solution", async () => {
    const user = userEvent.setup();
    render(panel());
    await screen.findByText("the code editor");

    await user.click(screen.getByLabelText("Open the Debug board"));
    const board = await screen.findByRole("region", { name: "Debug" });
    expect(within(board).getByRole("region", { name: "Process for Shop API" })).toBeInTheDocument();
    // Debug takes the width: the tree and the ship rail belong to one agent.
    expect(screen.queryByRole("region", { name: "Files" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: /Review and ship/ })).not.toBeInTheDocument();

    // Pressing it again comes back rather than stranding you in Debug.
    await user.click(screen.getByLabelText("Open the Debug board"));
    expect(await screen.findByText("the code editor")).toBeInTheDocument();
  });

  /// A per-agent view cannot answer "what is everything doing?" — the queue as a
  /// whole, every open question, the runs, the tests and the repositories still
  /// can, and all five moved here when Tests and Git stopped being tabs.
  it("keeps the across-the-Product lists reachable", async () => {
    const user = userEvent.setup();
    render(panel());

    await user.click(await screen.findByRole("button", { name: /Queue, questions and runs/ }));
    expect(await screen.findByRole("region", { name: "Runs" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Questions" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Unit tests" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Git" })).toBeInTheDocument();
  });

  /// **The lane claimed this before it had it.** The divider said "agent
  /// worktrees" while the one card above it pointed at the main working copy,
  /// so the one place a person and an agent do the same work was the one place
  /// only the agent had somewhere to do it.
  it("lists your own worktrees beside the agents'", async () => {
    mocked.listMySpaces.mockResolvedValue([
      { branch: "myspace/desk", name: "desk", path: "C:/w/myspace-desk" },
      { branch: "myspace/bench", name: "bench", path: "C:/w/myspace-bench" },
    ]);
    const user = userEvent.setup();
    render(<AgentWorkspace productId={1} solutions={[solution]} opened={null} />);
    const tabs = await screen.findByRole("tablist", { name: "Solutions" });
    await user.click(within(tabs).getByRole("tab", { name: /^Shop API/ }));

    const lane = await screen.findByRole("navigation", { name: "Agents" });
    expect(await within(lane).findByLabelText("Your space desk")).toBeInTheDocument();
    expect(within(lane).getByLabelText("Your space bench")).toBeInTheDocument();
    // The branch is shown rather than the path: it is what git knows it by and
    // what somebody would type to find it again.
    expect(within(lane).getByText("myspace/desk")).toBeInTheDocument();
  });

  /// A name is asked for rather than generated: "space 2" and "space 3" are no
  /// easier to tell apart than two called nothing, and it becomes a branch.
  it("opens another space and selects it", async () => {
    const user = userEvent.setup();
    const ask = vi.spyOn(window, "prompt").mockReturnValue("desk");
    render(<AgentWorkspace productId={1} solutions={[solution]} opened={null} />);

    const tabs = await screen.findByRole("tablist", { name: "Solutions" });
    await user.click(within(tabs).getByRole("tab", { name: /^Shop API/ }));

    const lane = await screen.findByRole("navigation", { name: "Agents" });
    await user.click(await within(lane).findByRole("button", { name: /Another space of mine/ }));

    await waitFor(() => expect(mocked.openMySpace).toHaveBeenCalledWith(5, "desk"));
    // Re-read from git rather than assumed: a worktree removed by hand is gone.
    await waitFor(() => expect(mocked.listMySpaces).toHaveBeenCalledTimes(2));
    ask.mockRestore();
  });

  /// Cancelling the prompt must leave the repository alone.
  it("makes nothing when the name is cancelled", async () => {
    const user = userEvent.setup();
    const ask = vi.spyOn(window, "prompt").mockReturnValue(null);
    render(<AgentWorkspace productId={1} solutions={[solution]} opened={null} />);

    const tabs = await screen.findByRole("tablist", { name: "Solutions" });
    await user.click(within(tabs).getByRole("tab", { name: /^Shop API/ }));

    const lane = await screen.findByRole("navigation", { name: "Agents" });
    await user.click(await within(lane).findByRole("button", { name: /Another space of mine/ }));

    expect(mocked.openMySpace).not.toHaveBeenCalled();
    ask.mockRestore();
  });

  /// **"Close" is the word people fear on something holding work**, so the
  /// control says what it does not do: the checkout goes, the branch stays.
  it("closes a space, and says the branch survives", async () => {
    const user = userEvent.setup();
    mocked.listMySpaces.mockResolvedValue([
      { branch: "myspace/desk", name: "desk", path: "C:/w/myspace-desk" },
    ]);
    render(<AgentWorkspace productId={1} solutions={[solution]} opened={null} />);

    const tabs = await screen.findByRole("tablist", { name: "Solutions" });
    await user.click(within(tabs).getByRole("tab", { name: /^Shop API/ }));

    const lane = await screen.findByRole("navigation", { name: "Agents" });
    const close = await within(lane).findByLabelText("Close the space desk");
    expect(close).toHaveAttribute(
      "title",
      "Removes the checkout. The branch and its commits stay.",
    );

    await user.click(close);
    await waitFor(() =>
      expect(mocked.closeMySpace).toHaveBeenCalledWith(5, "C:/w/myspace-desk"),
    );
  });

  /// **Two things, two tabs.** Picking an agent used to stack its workbench and
  /// the code pane in one column: the diff of a file and the file itself, one
  /// under the other, with the console below both. They are separate questions —
  /// "what is this agent doing?" and "what does this file say?" — so they get
  /// separate tabs, and neither is unmounted by switching, because a dev server
  /// and a half-typed edit both live in the code half.
  it("opens the work item when an agent is picked, and the code beside it", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([
      run({ state: "prepared", worktreePath: "C:/wt/checkout" }),
    ]);
    render(panel());

    await user.click(await screen.findByLabelText("Agent for Add checkout on Shop API"));

    // The workbench is what picking an agent asked for.
    expect(
      await screen.findByRole("region", { name: "Agent for Add checkout" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Code" }));
    expect(
      screen.queryByRole("region", { name: "Agent for Add checkout" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Work item" }));
    expect(
      screen.getByRole("region", { name: "Agent for Add checkout" }),
    ).toBeInTheDocument();
  });

  /// With no agent there is only one thing in the column, and a tab strip
  /// offering to switch between one thing and nothing is noise.
  it("offers no tabs in your own workspace", async () => {
    render(panel());
    expect(await screen.findByText("the code editor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Work item" })).not.toBeInTheDocument();
  });

  /// **The console is a debugging tool.** It sat under the code permanently,
  /// saying "nothing printed yet" to people who were reading code — so it is a
  /// tab of its own now, and there is no tab until somebody presses Debug.
  it("keeps the console out of the way until Debug is pressed", async () => {
    const user = userEvent.setup();
    render(panel());

    // Scoped to the Solution, which is where a console has a folder to run in.
    const bar = await screen.findByRole("tablist", { name: "Solutions" });
    await user.click(within(bar).getByRole("tab", { name: /^Shop API/ }));

    await screen.findByText("the code editor");
    expect(
      screen.queryByLabelText("Console for Shop API"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Debug output" }),
    ).not.toBeInTheDocument();

    // Pressing Debug opens the board; pressing it again comes back to the code
    // with the debug output now reachable as its own tab.
    await user.click(screen.getByLabelText("Open the Debug board"));
    await user.click(screen.getByLabelText("Open the Debug board"));

    await user.click(await screen.findByRole("button", { name: "Debug output" }));
    expect(
      await screen.findByLabelText("Console for Shop API"),
    ).toBeInTheDocument();

    // And it goes away with the last session rather than staying for the rest
    // of the visit — which is the whole complaint about the old dock.
    await user.click(screen.getByLabelText("Open the Debug board"));
    await user.click(await screen.findByLabelText("Detach Shop API"));
    await user.click(screen.getByLabelText("Open the Debug board"));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Debug output" }),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByText("the code editor")).toBeInTheDocument();
  });

  /// **Every section pulls out.** The console could already be dragged onto the
  /// other monitor and the other two could not, so comparing a plan against the
  /// code it produced meant switching tabs to see what was asked for. The
  /// button opens whichever pane is being read.
  it("pulls the pane being read into its own window", async () => {
    const user = userEvent.setup();
    mocked.openWorkItemWindow.mockResolvedValue(undefined);
    mocked.openFileWindow.mockResolvedValue(undefined);
    mocked.listRuns.mockResolvedValue([
      run({ state: "prepared", worktreePath: "C:/wt/checkout" }),
    ]);
    mocked.readSolutionTree.mockResolvedValue({
      entries: [{ path: "src/main.ts", name: "main.ts", isDir: false, depth: 0 }],
      truncated: false,
    });
    render(panel());

    await user.click(await screen.findByLabelText("Agent for Add checkout on Shop API"));
    await user.click(
      await screen.findByLabelText("Open Add checkout in its own window"),
    );
    await waitFor(() =>
      expect(mocked.openWorkItemWindow).toHaveBeenCalledWith(9, "Add checkout"),
    );

    // Clicking a file shows the code, and the button follows the pane.
    await user.click(await screen.findByLabelText("src/main.ts"));
    await user.click(
      await screen.findByLabelText("Open src/main.ts in its own window"),
    );
    await waitFor(() =>
      expect(mocked.openFileWindow).toHaveBeenCalledWith(5, "src/main.ts"),
    );
  });

  /// **"Execute failed but no error is appearing."** It was appearing — inside
  /// the build plan, four components deep, at the top of a section long enough
  /// to have scrolled away. The rail is the one part of this screen that is
  /// always in view, so a failed press says so there too.
  it("says on the rail when a press deep inside the workbench fails", async () => {
    const user = userEvent.setup();
    mocked.listRuns.mockResolvedValue([
      run({ state: "prepared", worktreePath: "C:/wt/checkout" }),
    ]);
    mocked.reviewSolutionChanges.mockRejectedValue(
      "'Shop API' is not a git repository",
    );
    render(panel());

    await user.click(await screen.findByLabelText("Agent for Add checkout on Shop API"));
    const rail = screen.getByRole("complementary", { name: /Review and ship/ });
    await user.click(within(rail).getByRole("button", { name: "Review what changed" }));

    const box = await within(rail).findByRole("alert");
    expect(box).toHaveTextContent("Review what changed failed");
    expect(box).toHaveTextContent(/not a git repository/);

    await user.click(within(rail).getByRole("button", { name: "Dismiss this failure" }));
    expect(within(rail).queryByRole("alert")).not.toBeInTheDocument();
  });

});