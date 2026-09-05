import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkItemViews from "../../components/planning/WorkItemViews";
import { readinessOf } from "../../components/planning/WorkReadiness";
import type { Run, Sprint, TeamMember, WorkItem } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listWorkItems: vi.fn(),
    listSprints: vi.fn(),
    listSolutions: vi.fn(),
    listTeamMembers: vi.fn(),
    getSolutionStrategy: vi.fn(),
    generateSolutionStrategy: vi.fn(),
    chooseArchitectureOption: vi.fn(),
    recommendForWorkItem: vi.fn(),
    // WorkItemViews now embeds the queue and the runs panels. Left unmocked,
    // these fall through to the real invoke and each renders an error alert —
    // which is how a second `role="alert"` sneaks into an unrelated assertion.
    listAiJobs: vi.fn(),
    getAiConcurrency: vi.fn(),
    listRuns: vi.fn(),
    // Opening a work item mounts the build plan, which loads these. Left
    // unmocked they fall through to the real invoke and the editor renders its
    // error state instead of the fields.
    // The lifecycle panel hangs off every work item now. Unmocked these fall
    // through to the real invoke and each renders its own error alert.
    lifecycleGates: vi.fn(),
    listLifecycleSteps: vi.fn(),
    listWorkItemSteps: vi.fn(),
    setWorkItemStep: vi.fn(),
    listWorkItemPlans: vi.fn(),
    listAiFeedback: vi.fn(),
    // The Solution git panel sits in every change block now. Unmocked it falls
    // through to the real invoke and adds a second role="alert" to the page.
    solutionGitState: vi.fn(),
    githubStatus: vi.fn(),
    listWorkItemChanges: vi.fn(),
    // Ready is the default view now, and it reads these three. Left unmocked
    // they fall through to the real invoke and the view renders its error state
    // while every assertion below still passes.
    listOpenQuestions: vi.fn(),
    getWorkItemPolicy: vi.fn(),
    listAiProviders: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

function item(o: Partial<WorkItem>): WorkItem {
  return {
    id: 1, title: "Checkout", itemType: "feature", status: "planned", description: null,
    productId: 7, parentItemId: null, assigneeId: null, sprintId: null, startDate: null,
    endDate: null, deliverableId: null, expectedCost: null, estimatedProfit: null,
    chargeable: false, customerCoverPct: null, risk: "", solutionId: null, ...o,
  };
}

const ada: TeamMember = { id: 5, name: "Ada", roleId: null };
const bob: TeamMember = { id: 6, name: "Bob", roleId: null };
const sprint: Sprint = { id: 9, productId: 7, name: "Sprint 1", startDate: null, endDate: null };

const run = (over: Partial<Run> = {}): Run =>
  ({
    id: 3, workItemId: 1, workItemTitle: "Checkout", solutionId: 5,
    solutionName: "Shop API", state: "notStarted", branch: "b", worktreePath: "",
    terminalId: "", briefPath: "", filesChanged: 0, planApproved: true,
    ...over,
  }) as Run;

/// The scoring rule on its own, away from the rendering. Every check is a fact
/// about a row, so each one is worth pinning independently — through the UI it
/// is only ever visible as a total.
describe("readinessOf", () => {
  const bare = item({ id: 1 });

  it("counts an item with nothing filled in as one of four", () => {
    const checks = readinessOf(bare, [], 0);
    expect(checks).toHaveLength(4);
    // Only "nothing blocking" passes: an item nobody has asked a question about
    // is not blocked, which is true and slightly counter-intuitive.
    expect(checks.filter((c) => c.ok).map((c) => c.label)).toEqual(["nothing blocking"]);
  });

  it("needs a description, a Solution and an approved plan", () => {
    const full = item({
      id: 1,
      description: "Take a card payment.",
    });
    expect(readinessOf(full, [run()], 0).every((c) => c.ok)).toBe(true);
  });

  /// Approval is per (work item, Solution): one unapproved plan means the item
  /// cannot be handed over, whatever the others say.
  it("fails approval when any one of an item's runs is unapproved", () => {
    const full = item({ id: 1, description: "x" });
    const checks = readinessOf(full, [run(), run({ id: 4, solutionId: 6, planApproved: false })], 0);
    expect(checks.find((c) => c.id === "approved")?.ok).toBe(false);
  });

  /// Runs belonging to other work items must not lend this one a Solution.
  it("ignores runs that belong to another work item", () => {
    const checks = readinessOf(bare, [run({ workItemId: 99 })], 0);
    expect(checks.find((c) => c.id === "solution")?.ok).toBe(false);
  });

  it("counts an unanswered question as blocking, and says how many", () => {
    const checks = readinessOf(bare, [], 2);
    const blocking = checks.find((c) => c.id === "blocking");
    expect(blocking?.ok).toBe(false);
    expect(blocking?.detail).toContain("2 questions");
  });
});

describe("WorkItemViews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.lifecycleGates.mockResolvedValue([]);
    mocked.listLifecycleSteps.mockResolvedValue([]);
    mocked.listWorkItemSteps.mockResolvedValue([]);
    mocked.setWorkItemStep.mockResolvedValue(undefined);
    mocked.listSprints.mockResolvedValue([sprint]);
    mocked.listSolutions.mockResolvedValue([]);
    mocked.listTeamMembers.mockResolvedValue([ada, bob]);
    mocked.getSolutionStrategy.mockResolvedValue(null);
    mocked.listAiJobs.mockResolvedValue([]);
    mocked.getAiConcurrency.mockResolvedValue({ limit: 1, available: 1 });
    mocked.listRuns.mockResolvedValue([]);
    mocked.listWorkItemPlans.mockResolvedValue([]);
    mocked.listAiFeedback.mockResolvedValue([]);
    mocked.listWorkItemChanges.mockResolvedValue([]);
    mocked.listOpenQuestions.mockResolvedValue([]);
    mocked.getWorkItemPolicy.mockResolvedValue(null);
    mocked.listAiProviders.mockResolvedValue([]);
    mocked.listWorkItems.mockResolvedValue([
      item({ id: 1, title: "Checkout", status: "planned", assigneeId: 5, sprintId: 9 }),
      item({ id: 2, title: "Search", status: "building", assigneeId: 6, sprintId: null }),
    ]);
  });

  /// Ready leads because it is the only view that answers the question somebody
  /// standing in Work is asking: is this scoped well enough to hand over?
  it("opens on Ready, scoring each item out of four", async () => {
    render(<WorkItemViews productId={7} />);
    const ready = await screen.findByRole("region", { name: "Ready to hand over" });
    expect(
      within(ready).getByLabelText("Checkout — 1 of 4 ready"),
    ).toBeInTheDocument();
    expect(within(ready).getByLabelText("Search — 1 of 4 ready")).toBeInTheDocument();
  });

  /// **The honesty rule, in Work.** Every dot is a fact read back from the item;
  /// the score is a count of four of them. The design this came from showed a
  /// "ready %" beside "the agent lands it first try", which would be a claim
  /// about the future that nothing here can support.
  it("scores only facts it read, and shows no percentage", async () => {
    mocked.listWorkItems.mockResolvedValue([
      item({
        id: 1,
        title: "Checkout",
        description: "Take a card payment.",
      }),
    ]);
    mocked.listRuns.mockResolvedValue([
      {
        id: 3, workItemId: 1, workItemTitle: "Checkout", solutionId: 5,
        solutionName: "Shop API", state: "notStarted", branch: "b", worktreePath: "",
        terminalId: "", briefPath: "", filesChanged: 0, planApproved: true,
      },
    ]);
    render(<WorkItemViews productId={7} />);

    const row = await screen.findByLabelText("Checkout — 4 of 4 ready");
    expect(row).toHaveTextContent("Ready to hand over");
    expect(row.textContent).not.toMatch(/\d+%/);
  });

  /// An unanswered question is blocking, so it costs the item a check — the
  /// same fact the Build view's lane badge reports, read from the same place.
  it("counts an open question against readiness", async () => {
    mocked.listWorkItems.mockResolvedValue([
      item({ id: 1, title: "Checkout", description: "x" }),
    ]);
    mocked.listOpenQuestions.mockResolvedValue([
      { id: 1, workItemId: 1, workItemTitle: "Checkout", kind: "clarification", message: "?", whatIsNeeded: "!" },
    ]);
    render(<WorkItemViews productId={7} />);

    const row = await screen.findByLabelText("Checkout — 1 of 4 ready");
    expect(row).toHaveTextContent("3 to fix");
  });

  /// The briefing is what the agent would be handed, and it names what is still
  /// missing rather than only scoring it.
  it("names what is still missing in the briefing", async () => {
    const user = userEvent.setup();
    render(<WorkItemViews productId={7} />);

    // The row is a list item holding two controls now, so the briefing opener
    // is its own button rather than the whole row.
    await screen.findByLabelText("Checkout — 1 of 4 ready");
    await user.click(screen.getByLabelText("Show the briefing for Checkout"));
    const briefing = await screen.findByRole("complementary", { name: "Agent briefing" });
    expect(briefing).toHaveTextContent(/The description is empty/);
    expect(briefing).toHaveTextContent(/No Solution is attached/);
    expect(
      within(briefing).getByRole("button", { name: "Open the build plan" }),
    ).toBeInTheDocument();
  });

  /// **The briefing is what the agent is handed, and the plan is most of it.**
  /// It listed the branch and the tests and said nothing about the files the
  /// AI worked out — so the one screen that claims to show what an agent would
  /// receive was the one place the plan could not be read.
  it("shows the AI's plan in the briefing", async () => {
    const user = userEvent.setup();
    mocked.listWorkItems.mockResolvedValue([item({ id: 1, title: "Checkout" })]);
    mocked.listWorkItemPlans.mockResolvedValue([
      {
        id: 4,
        workItemId: 1,
        solutionId: 5,
        solutionName: "Shop API",
        changesRequired: "Add POST /checkout",
        unitTests: "",
        branchName: "feature/checkout",
        cloneFrom: "main",
        mockups: "[]",
        apiSchema: "POST /checkout -> 201",
        pageSchema: "",
        filesToChange: "src/api/checkout.rs (the endpoint); src/db/order.rs (the row)",
        approvedAt: 0,
      },
    ]);
    render(<WorkItemViews productId={7} />);

    await user.click(await screen.findByLabelText("Show the briefing for Checkout"));
    const briefing = await screen.findByRole("complementary", { name: "Agent briefing" });

    expect(within(briefing).getByText("src/api/checkout.rs")).toBeInTheDocument();
    expect(within(briefing).getByText("src/db/order.rs")).toBeInTheDocument();
    // The reason is the model's own words, so it travels with the path.
    expect(briefing).toHaveTextContent(/the endpoint/);
  });

  it("says the AI has not planned it yet rather than showing an empty block", async () => {
    const user = userEvent.setup();
    mocked.listWorkItems.mockResolvedValue([item({ id: 1, title: "Checkout" })]);
    render(<WorkItemViews productId={7} />);

    await user.click(await screen.findByLabelText("Show the briefing for Checkout"));
    const briefing = await screen.findByRole("complementary", { name: "Agent briefing" });
    expect(briefing).toHaveTextContent(/has not planned this yet/i);
  });

  /// An item that already has an agent is not a scoping question any more, so
  /// its row points at the work rather than naming a state and going nowhere.
  it("links a row with an agent on it through to Build", async () => {
    const user = userEvent.setup();
    const opened: number[] = [];
    mocked.listWorkItems.mockResolvedValue([item({ id: 1, title: "Checkout" })]);
    mocked.listRuns.mockResolvedValue([run({ state: "prepared", worktreePath: "C:/wt" })]);
    render(<WorkItemViews productId={7} onOpenAgent={(id) => opened.push(id)} />);

    await user.click(await screen.findByLabelText("Open Checkout in Build"));
    expect(opened).toEqual([1]);
  });

  it("switches to Board view with status columns", async () => {
    const user = userEvent.setup();
    render(<WorkItemViews productId={7} />);
    await user.click(await screen.findByRole("tab", { name: "Board" }));
    const board = await screen.findByRole("region", { name: "Board view" });
    expect(within(board).getByRole("region", { name: "planned" })).toHaveTextContent("Checkout");
    expect(within(board).getByRole("region", { name: "building" })).toHaveTextContent("Search");
  });

  /// The bug: the Board view had no way to open a work item, so a developer
  /// could not outline the changes or affected Solutions from where they land.
  /// A card opens its build plan now.
  it("opens a work item's build plan from a board card", async () => {
    const user = userEvent.setup();
    render(<WorkItemViews productId={7} />);

    await user.click(await screen.findByRole("tab", { name: "Board" }));
    await user.click(await screen.findByRole("button", { name: "Open Checkout" }));

    // the developer's editor, with its technical fields
    expect(
      await screen.findByRole("region", { name: "Build plan for Checkout" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Plan Checkout"),
    ).toBeInTheDocument();
  });

  it("switches to List view and shows a row per item", async () => {
    const user = userEvent.setup();
    render(<WorkItemViews productId={7} />);
    await user.click(await screen.findByRole("tab", { name: "List" }));
    const table = screen.getByRole("table", { name: "List view" });
    expect(within(table).getByRole("row", { name: "Checkout" })).toHaveTextContent("Ada");
    expect(within(table).getByRole("row", { name: "Search" })).toHaveTextContent("Bob");
  });

  it("switches to Sprint view grouping by sprint plus Unscheduled", async () => {
    const user = userEvent.setup();
    render(<WorkItemViews productId={7} />);
    await user.click(await screen.findByRole("tab", { name: "Sprint" }));
    expect(screen.getByRole("region", { name: "Sprint 1" })).toHaveTextContent("Checkout");
    expect(screen.getByRole("region", { name: "Unscheduled" })).toHaveTextContent("Search");
  });

  it("filters by assigned user across the current view", async () => {
    const user = userEvent.setup();
    render(<WorkItemViews productId={7} />);
    await user.click(await screen.findByRole("tab", { name: "List" }));
    await user.selectOptions(screen.getByLabelText("Filter by user"), "5");

    const table = screen.getByRole("table", { name: "List view" });
    expect(within(table).queryByRole("row", { name: "Checkout" })).toBeInTheDocument();
    expect(within(table).queryByRole("row", { name: "Search" })).not.toBeInTheDocument();
  });

  /// A rule the AI broke must be visible on the strategy it broke it in.
  /// Stating a constraint in the prompt is not the same as it being obeyed,
  /// which is why the answer is checked and the result surfaced here.
  it("shows when a generated strategy breaks the developer rules", async () => {
    const user = userEvent.setup();
    mocked.getSolutionStrategy.mockResolvedValue({
      workItemId: 1,
      strategy: "Build the service in Java with Spring Boot.",
      architectureOptions: "[]",
      chosenOptionIndex: null,
      techStack: "Java, Spring",
      ruleViolations: ["java"],
      unlistedTech: [],
    });
    render(<WorkItemViews productId={7} />);

    await user.click(await screen.findByRole("tab", { name: "List" }));
    await user.click(screen.getByRole("button", { name: "Solution strategy for Checkout" }));

    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent(/technology your rules forbid/);
    expect(warning).toHaveTextContent("java");
  });

  /// Every figure must say where it came from. A price-table guess shown with
  /// the same confidence as a measured median would be dishonest.
  it("shows both cost options and labels the estimate's source", async () => {
    const user = userEvent.setup();
    mocked.recommendForWorkItem.mockResolvedValue({
      options: [
        {
          kind: "fastest",
          provider: "Claude",
          model: "claude-opus-4-8",
          estTokens: 18_000,
          estCostMicropence: 94_000_000,
          estMinutes: 2,
          source: "priceTable",
          affordable: true,
        },
        {
          kind: "costEfficient",
          provider: "Ollama (local)",
          model: "ornith:9b",
          estTokens: 22_000,
          estCostMicropence: 0,
          estMinutes: 6,
          source: "history",
          affordable: true,
        },
      ],
      note: null,
    });
    render(<WorkItemViews productId={7} />);

    await user.click(await screen.findByRole("tab", { name: "List" }));
    await user.click(screen.getByRole("button", { name: "Solution strategy for Checkout" }));
    await user.click(await screen.findByRole("button", { name: "Estimate AI cost for Checkout" }));

    expect(await screen.findByText(/£0\.94/)).toBeInTheDocument();
    expect(screen.getByText(/£0\.00/)).toBeInTheDocument();
    expect(screen.getByText(/price table, no history yet/)).toBeInTheDocument();
    expect(screen.getByText(/median of your recorded calls/)).toBeInTheDocument();
  });

  it("marks an option that would exceed the remaining budget", async () => {
    const user = userEvent.setup();
    mocked.recommendForWorkItem.mockResolvedValue({
      options: [
        {
          kind: "fastest",
          provider: "Claude",
          model: "claude-opus-4-8",
          estTokens: 18_000,
          estCostMicropence: 94_000_000,
          estMinutes: 2,
          source: "priceTable",
          affordable: false,
        },
      ],
      note: null,
    });
    render(<WorkItemViews productId={7} />);

    await user.click(await screen.findByRole("tab", { name: "List" }));
    await user.click(screen.getByRole("button", { name: "Solution strategy for Checkout" }));
    await user.click(await screen.findByRole("button", { name: "Estimate AI cost for Checkout" }));

    expect(
      await screen.findByText(/exceed what is left of the AI budget/),
    ).toBeInTheDocument();
  });

  /// The distinction the live run forced: a technology that is merely unlisted
  /// is a question, not a breach. Showing it as an error would train people to
  /// ignore the errors that matter.
  it("reports unlisted technology as a notice, not a violation", async () => {
    const user = userEvent.setup();
    mocked.getSolutionStrategy.mockResolvedValue({
      workItemId: 1,
      strategy: "Run it on Azure Functions.",
      architectureOptions: "[]",
      chosenOptionIndex: null,
      techStack: "Rust, Azure Functions",
      ruleViolations: [],
      unlistedTech: [".NET 8", "Azure Functions"],
    });
    render(<WorkItemViews productId={7} />);

    await user.click(await screen.findByRole("tab", { name: "List" }));
    await user.click(screen.getByRole("button", { name: "Solution strategy for Checkout" }));

    const notice = await screen.findByText(/Not on your allowed list/);
    expect(notice).toHaveTextContent("Azure Functions");
    // a notice, never an alert — that separation is the whole point
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers architecture options to choose between", async () => {
    const user = userEvent.setup();
    mocked.getSolutionStrategy.mockResolvedValue({
      workItemId: 1,
      strategy: "Run it as a queue consumer.",
      architectureOptions: JSON.stringify([
        { name: "Azure Function", kind: "azureFunction", rationale: "cheap", tradeoffs: "cold starts" },
      ]),
      chosenOptionIndex: null,
      techStack: "Rust",
      ruleViolations: [],
      unlistedTech: [],
    });
    mocked.chooseArchitectureOption.mockResolvedValue(undefined);
    render(<WorkItemViews productId={7} />);

    await user.click(await screen.findByRole("tab", { name: "List" }));
    await user.click(screen.getByRole("button", { name: "Solution strategy for Checkout" }));
    await user.click(await screen.findByRole("button", { name: "Choose Azure Function" }));

    expect(mocked.chooseArchitectureOption).toHaveBeenCalledWith(1, 0);
  });
});
