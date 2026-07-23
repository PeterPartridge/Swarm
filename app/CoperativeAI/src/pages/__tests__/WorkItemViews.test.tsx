import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkItemViews from "../../components/WorkItemViews";
import type { Sprint, TeamMember, WorkItem } from "../../lib/backend";

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
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

function item(o: Partial<WorkItem>): WorkItem {
  return {
    id: 1, title: "Checkout", itemType: "feature", status: "planned", description: null,
    productId: 7, parentItemId: null, assigneeId: null, sprintId: null, startDate: null,
    endDate: null, deliverableId: null, expectedCost: null, estimatedProfit: null,
    chargeable: false, customerCoverPct: null, risk: "", solutionId: null, developmentDetails: "", ...o,
  };
}

const ada: TeamMember = { id: 5, name: "Ada", roleId: null };
const bob: TeamMember = { id: 6, name: "Bob", roleId: null };
const sprint: Sprint = { id: 9, productId: 7, name: "Sprint 1", startDate: null, endDate: null };

describe("WorkItemViews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listSprints.mockResolvedValue([sprint]);
    mocked.listSolutions.mockResolvedValue([]);
    mocked.listTeamMembers.mockResolvedValue([ada, bob]);
    mocked.getSolutionStrategy.mockResolvedValue(null);
    mocked.listWorkItems.mockResolvedValue([
      item({ id: 1, title: "Checkout", status: "planned", assigneeId: 5, sprintId: 9 }),
      item({ id: 2, title: "Search", status: "building", assigneeId: 6, sprintId: null }),
    ]);
  });

  it("defaults to Board view with status columns", async () => {
    render(<WorkItemViews productId={7} />);
    const board = await screen.findByRole("region", { name: "Board view" });
    expect(within(board).getByRole("region", { name: "planned" })).toHaveTextContent("Checkout");
    expect(within(board).getByRole("region", { name: "building" })).toHaveTextContent("Search");
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
