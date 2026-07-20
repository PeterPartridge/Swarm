import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductWorkspace from "../../components/ProductWorkspace";
import { PermissionProvider } from "../../lib/permissions";
import type { ActivePermissions } from "../../lib/backend";

// The workspace's own job is which panels exist; the panels' insides are
// tested in their own files, so they are stubbed here rather than letting
// their backend calls fall through to the real invoke and error out quietly.
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

  it("shows Marketing and Design to a role that holds the flags", async () => {
    mocked.getActivePermissions.mockResolvedValue(perms({}));
    renderWorkspace();

    expect(await screen.findByRole("region", { name: "Marketing" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Design" })).toBeInTheDocument();
  });

  /// The flags are separate from canProduct on purpose: a developer often
  /// needs Planning without campaign drafts, and a marketer the reverse.
  it("hides them from a role without the flags, leaving the rest alone", async () => {
    mocked.getActivePermissions.mockResolvedValue(
      perms({ canMarketing: false, canDesign: false }),
    );
    renderWorkspace();

    expect(await screen.findByRole("region", { name: "Planning" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "RoadMap" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Marketing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Design" })).not.toBeInTheDocument();
  });

  it("can grant one without the other", async () => {
    mocked.getActivePermissions.mockResolvedValue(perms({ canMarketing: false }));
    renderWorkspace();

    expect(await screen.findByRole("region", { name: "Design" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Marketing" })).not.toBeInTheDocument();
  });
});
