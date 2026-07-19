import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RoadMap from "../../components/RoadMap";
import type { Sprint, WorkItem } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listWorkItems: vi.fn(),
    listSprints: vi.fn(),
    createSprint: vi.fn(),
    getRoadmapMode: vi.fn(),
    getPlanningHierarchy: vi.fn(),
    getSprintLoad: vi.fn(),
    setSprintCapacity: vi.fn(),
    listTeamMembers: vi.fn(),
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

const datedSprint: Sprint = {
  id: 9,
  productId: 7,
  name: "Sprint 1",
  startDate: Date.parse("2026-08-01"),
  endDate: Date.parse("2026-08-14"),
};

describe("RoadMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getPlanningHierarchy.mockResolvedValue([
      "epic",
      "feature",
      "userStory",
      "task",
    ]);
    mocked.getRoadmapMode.mockResolvedValue("sprints");
    mocked.listSprints.mockResolvedValue([datedSprint]);
    mocked.listTeamMembers.mockResolvedValue([]);
    mocked.getSprintLoad.mockResolvedValue([]);
    mocked.listWorkItems.mockResolvedValue([
      item({ id: 1, title: "Checkout", sprintId: 9 }),
      item({ id: 2, title: "Search", sprintId: null }),
      item({ id: 3, title: "Broken button", itemType: "bug" }),
    ]);
  });

  it("sprints mode: one lane per sprint with its dates, plus Unscheduled", async () => {
    render(<RoadMap productId={7} />);

    const sprintLane = await screen.findByRole("region", { name: "Sprint 1" });
    expect(sprintLane).toHaveTextContent("2026-08-01 → 2026-08-14");
    expect(within(sprintLane).getByText("Checkout")).toBeInTheDocument();

    const unscheduled = screen.getByRole("region", { name: "Unscheduled" });
    expect(within(unscheduled).getByText("Search")).toBeInTheDocument();
  });

  it("shows hierarchy items only — bugs stay on the board", async () => {
    render(<RoadMap productId={7} />);
    await screen.findByRole("region", { name: "Sprint 1" });
    expect(screen.queryByText("Broken button")).not.toBeInTheDocument();
  });

  it("kanban mode: one lane per status, no sprint form", async () => {
    mocked.getRoadmapMode.mockResolvedValue("kanban");
    render(<RoadMap productId={7} />);

    expect(await screen.findByRole("region", { name: "planned" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "done" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Create sprint" })).not.toBeInTheDocument();
  });

  it("creates a sprint without dates (teams that don't set times)", async () => {
    const user = userEvent.setup();
    mocked.createSprint.mockResolvedValue(10);
    render(<RoadMap productId={7} />);

    await user.type(await screen.findByLabelText("Sprint name"), "Sprint 2");
    await user.click(screen.getByRole("button", { name: "Add sprint" }));

    await waitFor(() =>
      expect(mocked.createSprint).toHaveBeenCalledWith({
        productId: 7,
        name: "Sprint 2",
        startDate: null,
        endDate: null,
      }),
    );
  });

  /// The point of the panel: someone holding more than they said they had.
  it("flags a member carrying more items than their capacity", async () => {
    mocked.listTeamMembers.mockResolvedValue([
      { id: 5, name: "Ada", roleId: null },
    ]);
    mocked.getSprintLoad.mockResolvedValue([
      { teamMemberId: 5, capacity: 2, assignedItems: 4 },
    ]);
    render(<RoadMap productId={7} />);

    expect(
      await screen.findByRole("region", { name: "Capacity for Sprint 1" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/4 items assigned — over capacity/)).toBeInTheDocument();
  });

  /// A count of items is not effort, and the panel must not imply otherwise.
  it("says the comparison is item count, not effort", async () => {
    mocked.listTeamMembers.mockResolvedValue([
      { id: 5, name: "Ada", roleId: null },
    ]);
    mocked.getSprintLoad.mockResolvedValue([
      { teamMemberId: 5, capacity: 8, assignedItems: 1 },
    ]);
    render(<RoadMap productId={7} />);

    expect(await screen.findByText(/rough signal, not effort/)).toBeInTheDocument();
    expect(screen.queryByText(/over capacity/)).not.toBeInTheDocument();
  });
});
