import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminArea from "../AdminArea";
import { PermissionProvider } from "../../lib/permissions";
import type { Role, TeamMember } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listTeamMembers: vi.fn(),
    addTeamMember: vi.fn(),
    setMemberRole: vi.fn(),
    removeTeamMember: vi.fn(),
    listRoles: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
    getActivePermissions: vi.fn(),
    listProducts: vi.fn(),
    getDeveloperRules: vi.fn(),
    setDeveloperRules: vi.fn(),
    getProductPolicy: vi.fn(),
    setProductPolicy: vi.fn(),
    listAiProviders: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const adminRole: Role = {
  id: 1,
  name: "Admin",
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
};
const devRole: Role = {
  id: 3,
  name: "Developer",
  canProduct: false,
  canDevelop: true,
  canTest: true,
  canAdmin: false,
  seeCost: false,
  seeProfit: false,
  seeChargeable: false,
  canManageBudget: false,
  canMarketing: false,
  canDesign: false,
};
const member: TeamMember = { id: 5, name: "Ada", roleId: null };

function renderAdmin() {
  return render(
    <PermissionProvider>
      <AdminArea />
    </PermissionProvider>,
  );
}

describe("AdminArea", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listTeamMembers.mockResolvedValue([member]);
    mocked.listRoles.mockResolvedValue([adminRole, devRole]);
    mocked.listProducts.mockResolvedValue([
      { id: 1, name: "Shop App", answers: "{}" },
    ]);
    mocked.getDeveloperRules.mockResolvedValue(null);
    mocked.getProductPolicy.mockResolvedValue(null);
    mocked.listAiProviders.mockResolvedValue([]);
    mocked.getActivePermissions.mockResolvedValue({
      memberId: null,
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
    });
  });

  it("lists members and roles", async () => {
    renderAdmin();
    expect(await screen.findByText(/Ada/)).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "Role Admin" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "Role Developer" })).toBeInTheDocument();
  });

  it("assigns a role to a member", async () => {
    const user = userEvent.setup();
    mocked.setMemberRole.mockResolvedValue();
    renderAdmin();
    await user.selectOptions(await screen.findByLabelText("Role of Ada"), "3");
    await waitFor(() => expect(mocked.setMemberRole).toHaveBeenCalledWith(5, 3));
  });

  it("toggles a role's field visibility", async () => {
    const user = userEvent.setup();
    mocked.updateRole.mockResolvedValue();
    renderAdmin();
    await user.click(await screen.findByLabelText("Developer see Cost"));
    await waitFor(() =>
      expect(mocked.updateRole).toHaveBeenCalledWith(
        expect.objectContaining({ id: 3, seeCost: true }),
      ),
    );
  });

  it("adds a new role", async () => {
    const user = userEvent.setup();
    mocked.createRole.mockResolvedValue(9);
    renderAdmin();
    await user.type(await screen.findByLabelText("Role name"), "Designer");
    await user.click(screen.getByRole("button", { name: "Add role" }));
    await waitFor(() => expect(mocked.createRole).toHaveBeenCalledWith("Designer"));
  });

  it("won't offer to delete the Admin role", async () => {
    renderAdmin();
    await screen.findByRole("row", { name: "Role Admin" });
    expect(
      screen.queryByRole("button", { name: "Delete role Admin" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete role Developer" }),
    ).toBeInTheDocument();
  });

  /// Every policy moved here from the area it governs: those who set what
  /// developers and the AI may do are not the same people it constrains. The
  /// AI planning policy and the developer rules both live in this one section.
  it("owns the policies, editable, per Product", async () => {
    renderAdmin();

    expect(
      await screen.findByRole("region", { name: "Product and development policies" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Policy product")).toBeInTheDocument();

    // the AI planning policy, moved out of the Product Strategy screen
    expect(await screen.findByRole("region", { name: "Product AI policy" })).toBeInTheDocument();
    expect(screen.getByLabelText("Allow AI to read this Product")).not.toBeChecked();

    // and the developer rules, editable here (read-only in Develop)
    const disallowed = await screen.findByLabelText("Disallowed technologies (enforced)");
    expect(disallowed).not.toHaveAttribute("readonly");
  });

  it("saves the AI planning policy from Admin", async () => {
    const user = userEvent.setup();
    mocked.setProductPolicy.mockResolvedValue(undefined);
    renderAdmin();

    await user.click(await screen.findByLabelText("Allow AI to generate work items"));
    await waitFor(() =>
      expect(mocked.setProductPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 1, allowGenerate: true }),
      ),
    );
  });

  it("says so rather than showing an empty picker when there are no Products", async () => {
    mocked.listProducts.mockResolvedValue([]);
    renderAdmin();

    expect(await screen.findByText(/policies are set per Product/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Policy product")).not.toBeInTheDocument();
  });
});
