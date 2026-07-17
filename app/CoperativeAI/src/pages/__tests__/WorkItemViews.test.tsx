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
    listTeamMembers: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

function item(o: Partial<WorkItem>): WorkItem {
  return {
    id: 1, title: "Checkout", itemType: "feature", status: "planned", description: null,
    productId: 7, parentItemId: null, assigneeId: null, sprintId: null, startDate: null,
    endDate: null, deliverableId: null, expectedCost: null, estimatedProfit: null,
    chargeable: false, customerCoverPct: null, ...o,
  };
}

const ada: TeamMember = { id: 5, name: "Ada", roleId: null };
const bob: TeamMember = { id: 6, name: "Bob", roleId: null };
const sprint: Sprint = { id: 9, productId: 7, name: "Sprint 1", startDate: null, endDate: null };

describe("WorkItemViews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listSprints.mockResolvedValue([sprint]);
    mocked.listTeamMembers.mockResolvedValue([ada, bob]);
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
});
