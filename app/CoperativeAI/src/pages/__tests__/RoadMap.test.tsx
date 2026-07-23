import { render, screen, within } from "@testing-library/react";
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
    risk: "",
    solutionId: null,
    developmentDetails: "",
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
    mocked.listSprints.mockResolvedValue([datedSprint]);
    mocked.listTeamMembers.mockResolvedValue([]);
    mocked.getSprintLoad.mockResolvedValue([]);
    mocked.listWorkItems.mockResolvedValue([
      item({ id: 1, title: "Checkout", sprintId: 9 }),
      item({ id: 2, title: "Search", sprintId: null }),
      item({ id: 3, title: "Broken button", itemType: "bug" }),
    ]);
  });

  /// The default view: a month timeline. Checkout takes its month from the
  /// sprint it is in (August); Search has no date and no dated sprint, so it
  /// sits apart in Undated rather than being silently dropped.
  it("month view is the default and places work by month", async () => {
    render(<RoadMap productId={7} />);

    const august = await screen.findByRole("region", { name: "August 2026" });
    expect(within(august).getByText("Checkout")).toBeInTheDocument();

    const undated = screen.getByRole("region", { name: "Undated" });
    expect(within(undated).getByText("Search")).toBeInTheDocument();
  });

  /// A timeline that showed a three-month piece of work in one month would
  /// hide how long things take.
  it("shows work spanning several months in each month it runs", async () => {
    mocked.listSprints.mockResolvedValue([]);
    mocked.listWorkItems.mockResolvedValue([
      item({
        id: 4,
        title: "Migration",
        startDate: Date.parse("2026-08-10"),
        endDate: Date.parse("2026-10-05"),
      }),
    ]);
    render(<RoadMap productId={7} />);

    for (const month of ["August 2026", "September 2026", "October 2026"]) {
      const lane = await screen.findByRole("region", { name: month });
      expect(within(lane).getByText("Migration")).toBeInTheDocument();
    }
  });

  it("bugs stay off the roadmap in every view", async () => {
    render(<RoadMap productId={7} />);
    await screen.findByRole("region", { name: "August 2026" });
    expect(screen.queryByText("Broken button")).not.toBeInTheDocument();
  });

  /// A timeline needs something to place; with no roadmap items at all, say so
  /// rather than showing a blank month strip.
  it("explains the empty timeline when there is nothing to place", async () => {
    mocked.listSprints.mockResolvedValue([]);
    mocked.listWorkItems.mockResolvedValue([]);
    render(<RoadMap productId={7} />);

    expect(await screen.findByText(/Nothing to place on a timeline yet/)).toBeInTheDocument();
  });

  it("by sprint: one lane per sprint with its dates, plus Unscheduled", async () => {
    const user = userEvent.setup();
    render(<RoadMap productId={7} />);
    await user.click(await screen.findByRole("button", { name: "By sprint" }));

    const sprintLane = await screen.findByRole("region", { name: "Sprint 1" });
    expect(sprintLane).toHaveTextContent("2026-08-01 → 2026-08-14");
    expect(within(sprintLane).getByText("Checkout")).toBeInTheDocument();

    const unscheduled = screen.getByRole("region", { name: "Unscheduled" });
    expect(within(unscheduled).getByText("Search")).toBeInTheDocument();
  });

  /// Sprint creation moved to Planning — the roadmap only shows.
  it("has no sprint-create form in any view", async () => {
    const user = userEvent.setup();
    render(<RoadMap productId={7} />);
    await user.click(await screen.findByRole("button", { name: "By sprint" }));
    expect(screen.queryByLabelText("Sprint name")).not.toBeInTheDocument();
  });

  it("by status: one lane per status", async () => {
    const user = userEvent.setup();
    render(<RoadMap productId={7} />);
    await user.click(await screen.findByRole("button", { name: "By status" }));

    expect(await screen.findByRole("region", { name: "planned" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "done" })).toBeInTheDocument();
  });

  /// The point of the panel: someone holding more than they said they had.
  /// Capacity is a sprint idea, so it shows on the sprint view.
  it("flags a member carrying more items than their capacity", async () => {
    const user = userEvent.setup();
    mocked.listTeamMembers.mockResolvedValue([{ id: 5, name: "Ada", roleId: null }]);
    mocked.getSprintLoad.mockResolvedValue([{ teamMemberId: 5, capacity: 2, assignedItems: 4 }]);
    render(<RoadMap productId={7} />);
    await user.click(await screen.findByRole("button", { name: "By sprint" }));

    expect(
      await screen.findByRole("region", { name: "Capacity for Sprint 1" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/4 items assigned — over capacity/)).toBeInTheDocument();
  });

  /// A count of items is not effort, and the panel must not imply otherwise.
  it("says the comparison is item count, not effort", async () => {
    const user = userEvent.setup();
    mocked.listTeamMembers.mockResolvedValue([{ id: 5, name: "Ada", roleId: null }]);
    mocked.getSprintLoad.mockResolvedValue([{ teamMemberId: 5, capacity: 8, assignedItems: 1 }]);
    render(<RoadMap productId={7} />);
    await user.click(await screen.findByRole("button", { name: "By sprint" }));

    expect(await screen.findByText(/rough signal, not effort/)).toBeInTheDocument();
    expect(screen.queryByText(/over capacity/)).not.toBeInTheDocument();
  });
});
