import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlanningBoard from "../../components/PlanningBoard";
import { PermissionProvider } from "../../lib/permissions";
import type { ActivePermissions, WorkItem } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    getActivePermissions: vi.fn(),
    listWorkItems: vi.fn(),
    getPlanningHierarchy: vi.fn(),
    listTeamMembers: vi.fn(),
    listSprints: vi.fn(),
    listDeliverables: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const item: WorkItem = {
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
};

function perms(overrides: Partial<ActivePermissions>): ActivePermissions {
  return {
    memberId: 5,
    role: null,
    canProduct: true,
    canDevelop: true,
    canTest: true,
    canAdmin: true,
    seeCost: true,
    seeProfit: true,
    seeChargeable: true,
    canManageBudget: true,
    ...overrides,
  };
}

describe("permission gating of cost fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listWorkItems.mockResolvedValue([item]);
    mocked.getPlanningHierarchy.mockResolvedValue(["epic", "feature", "userStory", "task"]);
    mocked.listTeamMembers.mockResolvedValue([]);
    mocked.listSprints.mockResolvedValue([]);
    mocked.listDeliverables.mockResolvedValue([]);
  });

  it("a role that can't see cost/profit/chargeable hides those fields", async () => {
    mocked.getActivePermissions.mockResolvedValue(
      perms({ seeCost: false, seeProfit: false, seeChargeable: false }),
    );
    render(
      <PermissionProvider>
        <PlanningBoard productId={7} />
      </PermissionProvider>,
    );
    await screen.findByRole("article", { name: "Checkout" });
    expect(screen.queryByLabelText("Expected cost of Checkout")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Chargeable: Checkout")).not.toBeInTheDocument();
  });

  it("a role that can see cost shows the cost field", async () => {
    mocked.getActivePermissions.mockResolvedValue(
      perms({ seeCost: true, seeProfit: false, seeChargeable: false }),
    );
    render(
      <PermissionProvider>
        <PlanningBoard productId={7} />
      </PermissionProvider>,
    );
    expect(await screen.findByLabelText("Expected cost of Checkout")).toBeInTheDocument();
    expect(screen.queryByLabelText("Estimated profit of Checkout")).not.toBeInTheDocument();
  });
});
