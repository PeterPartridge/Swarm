import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductWorkspace from "../../components/ProductWorkspace";
import { PermissionProvider } from "../../lib/permissions";
import type { ActivePermissions } from "../../lib/backend";

// The workspace's own job is which panels exist; the panels' insides are
// tested in their own files, so they are stubbed here rather than letting
// their backend calls fall through to the real invoke and error out quietly.
vi.mock("../../components/ProductStrategy", () => ({ default: () => <div>strategy-stub</div> }));
vi.mock("../../components/PlanningScreen", () => ({ default: () => <div>planning-stub</div> }));
vi.mock("../../components/RoadMap", () => ({ default: () => <div>roadmap-stub</div> }));
vi.mock("../../components/ProductOverview", () => ({ default: () => <div>overview-stub</div> }));
vi.mock("../../components/MarketingDesign", () => ({ default: () => <div>md-stub</div> }));

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return { ...original, getActivePermissions: vi.fn(), openScreenWindow: vi.fn() };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

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
    canMarketing: true,
    canDesign: true,
    ...overrides,
  };
}

const product = { id: 7, name: "Shop App", answers: "{}" };

function renderWorkspace() {
  return render(
    <PermissionProvider>
      <ProductWorkspace product={product} onBack={() => {}} />
    </PermissionProvider>,
  );
}

describe("ProductWorkspace screen gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /// One screen at a time now: the screens are tabs, so gating is about which
  /// tabs a role is offered, not which panels render together.
  it("offers Marketing and Design tabs to a role that holds the flags", async () => {
    mocked.getActivePermissions.mockResolvedValue(perms({}));
    renderWorkspace();

    // Strategy is the default panel; every screen is reachable as a tab.
    expect(await screen.findByRole("region", { name: "Strategy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marketing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Design" })).toBeInTheDocument();
  });

  it("opens a screen when its tab is clicked", async () => {
    const user = userEvent.setup();
    mocked.getActivePermissions.mockResolvedValue(perms({}));
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "Marketing" }));
    expect(await screen.findByRole("region", { name: "Marketing" })).toBeInTheDocument();
    // one at a time: Planning's panel is gone once Marketing is open
    expect(screen.queryByRole("region", { name: "Planning" })).not.toBeInTheDocument();
  });

  /// The flags are separate from canProduct on purpose: a developer often
  /// needs Planning without campaign drafts, and a marketer the reverse.
  it("hides the tabs from a role without the flags, leaving the rest alone", async () => {
    mocked.getActivePermissions.mockResolvedValue(
      perms({ canMarketing: false, canDesign: false }),
    );
    renderWorkspace();

    expect(await screen.findByRole("button", { name: "Planning" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "RoadMap" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marketing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Design" })).not.toBeInTheDocument();
  });

  it("can grant one tab without the other", async () => {
    mocked.getActivePermissions.mockResolvedValue(perms({ canMarketing: false }));
    renderWorkspace();

    expect(await screen.findByRole("button", { name: "Design" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marketing" })).not.toBeInTheDocument();
  });
});
