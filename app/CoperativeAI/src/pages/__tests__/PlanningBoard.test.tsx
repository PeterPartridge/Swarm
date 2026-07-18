import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlanningBoard from "../../components/PlanningBoard";
import type { Sprint, TeamMember, WorkItem } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listWorkItems: vi.fn(),
    createWorkItem: vi.fn(),
    updateWorkItemStatus: vi.fn(),
    updateWorkItem: vi.fn(),
    deleteWorkItem: vi.fn(),
    generateUserStories: vi.fn(),
    getPlanningHierarchy: vi.fn(),
    listTeamMembers: vi.fn(),
    listSprints: vi.fn(),
    getWorkItemPolicy: vi.fn(),
    setWorkItemPolicy: vi.fn(),
    listAiProviders: vi.fn(),
    listDeliverables: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

function item(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: 1,
    title: "Checkout",
    itemType: "feature",
    status: "planned",
    description: null,
    productId: 7,
    parentItemId: null,
    assigneeId: null,
    sprintId: null,
    startDate: null,
    endDate: null,
    deliverableId: null,
    expectedCost: null,
    estimatedProfit: null,
    chargeable: false,
    customerCoverPct: null,
    ...overrides,
  };
}

const member: TeamMember = { id: 5, name: "Ada", roleId: null };
const sprint: Sprint = {
  id: 9,
  productId: 7,
  name: "Sprint 1",
  startDate: null,
  endDate: null,
};

describe("PlanningBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listWorkItems.mockResolvedValue([item({})]);
    mocked.getPlanningHierarchy.mockResolvedValue([
      "epic",
      "feature",
      "userStory",
      "task",
    ]);
    mocked.listTeamMembers.mockResolvedValue([member]);
    mocked.listSprints.mockResolvedValue([sprint]);
    mocked.listDeliverables.mockResolvedValue([]);
    mocked.getWorkItemPolicy.mockResolvedValue(null);
    mocked.listAiProviders.mockResolvedValue([
      {
        id: 3,
        name: "Claude",
        apiBaseUrl: "https://api.anthropic.com",
        models: ["claude-opus-4-8"],
        keyStored: true,
        kind: "anthropic",
        metered: true,
      },
    ]);
  });

  it("restricts sub-item types to levels deeper than the parent (plus bug/test)", async () => {
    const user = userEvent.setup();
    render(<PlanningBoard productId={7} />);

    await user.click(
      await screen.findByRole("button", { name: "Add sub-item to Checkout" }),
    );
    const typeSelect = screen.getByLabelText("Sub-item type");
    const options = within(typeSelect)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["userStory", "task", "bug", "test"]);
  });

  it("creates a sub-item under its parent", async () => {
    const user = userEvent.setup();
    mocked.createWorkItem.mockResolvedValue(2);
    render(<PlanningBoard productId={7} />);

    await user.click(
      await screen.findByRole("button", { name: "Add sub-item to Checkout" }),
    );
    await user.type(screen.getByLabelText("Sub-item title"), "As a shopper...");
    await user.selectOptions(screen.getByLabelText("Sub-item type"), "userStory");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(mocked.createWorkItem).toHaveBeenCalledWith({
        title: "As a shopper...",
        itemType: "userStory",
        productId: 7,
        parentItemId: 1,
      }),
    );
  });

  it("assigns a team member and schedules into a sprint", async () => {
    const user = userEvent.setup();
    mocked.updateWorkItem.mockResolvedValue();
    render(<PlanningBoard productId={7} />);

    await user.selectOptions(
      await screen.findByLabelText("Assignee of Checkout"),
      "5",
    );
    await waitFor(() =>
      expect(mocked.updateWorkItem).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, assigneeId: 5, sprintId: null }),
      ),
    );

    await user.selectOptions(screen.getByLabelText("Sprint of Checkout"), "9");
    await waitFor(() =>
      expect(mocked.updateWorkItem).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1, sprintId: 9 }),
      ),
    );
  });

  it("shows cost/profit/chargeable fields and saves an edit (full-access default)", async () => {
    const user = userEvent.setup();
    mocked.updateWorkItem.mockResolvedValue();
    render(<PlanningBoard productId={7} />);

    // No permission provider in this test → full access → fields visible.
    const cost = await screen.findByLabelText("Expected cost of Checkout");
    await user.type(cost, "1200");
    await user.tab(); // commit on blur
    await waitFor(() =>
      expect(mocked.updateWorkItem).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1, expectedCost: 1200 }),
      ),
    );

    await user.click(screen.getByLabelText("Chargeable: Checkout"));
    await waitFor(() =>
      expect(mocked.updateWorkItem).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1, chargeable: true }),
      ),
    );
  });

  it("assigning a work item to a deliverable saves it", async () => {
    const user = userEvent.setup();
    mocked.updateWorkItem.mockResolvedValue();
    mocked.listDeliverables.mockResolvedValue([
      { id: 4, productId: 7, name: "MVP", description: "" },
    ]);
    render(<PlanningBoard productId={7} />);

    await user.selectOptions(
      await screen.findByLabelText("Deliverable of Checkout"),
      "4",
    );
    await waitFor(() =>
      expect(mocked.updateWorkItem).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1, deliverableId: 4 }),
      ),
    );
  });

  it("shows the AI story button on features when the hierarchy includes user stories", async () => {
    render(<PlanningBoard productId={7} />);
    expect(
      await screen.findByRole("button", {
        name: "AI: create user stories for Checkout",
      }),
    ).toBeInTheDocument();
  });

  it("hides the AI story button when the planning method has no user stories", async () => {
    mocked.getPlanningHierarchy.mockResolvedValue(["feature", "task"]);
    render(<PlanningBoard productId={7} />);
    await screen.findByRole("article", { name: "Checkout" });
    expect(
      screen.queryByRole("button", { name: /AI: create user stories/ }),
    ).not.toBeInTheDocument();
  });

  it("surfaces the policy-gate message from the AI story hook", async () => {
    const user = userEvent.setup();
    mocked.generateUserStories.mockRejectedValue(
      "'Checkout' has no AI policy, so AI can't touch it (deny-by-default).",
    );
    render(<PlanningBoard productId={7} />);

    await user.click(
      await screen.findByRole("button", {
        name: "AI: create user stories for Checkout",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("deny-by-default");
  });

  it("reports how many stories the AI created and refreshes the board", async () => {
    const user = userEvent.setup();
    mocked.generateUserStories.mockResolvedValue({
      created: [
        "As a shopper, I want one-step pay",
        "As a shopper, I want saved cards",
      ],
      provider: "Claude",
      model: "claude-haiku-4-5",
      reason: "within budget (10% used)",
    });
    render(<PlanningBoard productId={7} />);

    await user.click(
      await screen.findByRole("button", {
        name: "AI: create user stories for Checkout",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      'AI created 2 user stories under "Checkout"',
    );
    expect(mocked.listWorkItems.mock.calls.length).toBeGreaterThan(1);
  });

  it("opens the AI policy editor and saves changes (deny-by-default start)", async () => {
    const user = userEvent.setup();
    mocked.setWorkItemPolicy.mockResolvedValue();
    render(<PlanningBoard productId={7} />);

    await user.click(
      await screen.findByRole("button", { name: "AI policy for Checkout" }),
    );
    const readToggle = await screen.findByLabelText("AI may read this item");
    expect(readToggle).not.toBeChecked(); // deny-by-default

    await user.click(readToggle);
    await waitFor(() =>
      expect(mocked.setWorkItemPolicy).toHaveBeenCalledWith({
        workItemId: 1,
        allowRead: true,
        allowEdit: false,
        allowGenerateTests: false,
        providerId: null,
        effortTier: "low",
      }),
    );

    await user.selectOptions(screen.getByLabelText("Provider for Checkout"), "3");
    await waitFor(() =>
      expect(mocked.setWorkItemPolicy).toHaveBeenLastCalledWith(
        expect.objectContaining({ providerId: 3 }),
      ),
    );
  });
});
