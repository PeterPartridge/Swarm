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
    ...overrides,
  };
}

const member: TeamMember = { id: 5, name: "Ada", role: "Developer" };
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
      expect(mocked.updateWorkItem).toHaveBeenCalledWith({
        id: 1,
        assigneeId: 5,
        sprintId: null,
        startDate: null,
        endDate: null,
      }),
    );

    await user.selectOptions(screen.getByLabelText("Sprint of Checkout"), "9");
    await waitFor(() =>
      expect(mocked.updateWorkItem).toHaveBeenLastCalledWith({
        id: 1,
        assigneeId: null,
        sprintId: 9,
        startDate: null,
        endDate: null,
      }),
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
});
