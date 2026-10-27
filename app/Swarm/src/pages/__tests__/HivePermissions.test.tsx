import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivePermissions } from "../../lib/backend";

// The Hives mount live pages; give them a quiet backend, as the shell test does.
vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    getActivePermissions: vi.fn(),
    listProducts: vi.fn().mockResolvedValue([]),
    getPlanningHierarchy: vi.fn().mockResolvedValue(["epic", "feature", "userStory", "task"]),
    getRoadmapMode: vi.fn().mockResolvedValue("sprints"),
    listTeamMembers: vi.fn().mockResolvedValue([]),
    listSolutions: vi.fn().mockResolvedValue([]),
    githubStatus: vi.fn().mockResolvedValue({ connected: false }),
  };
});

import * as backend from "../../lib/backend";
import WorkspaceShell from "../WorkspaceShell";
import { PermissionProvider } from "../../lib/permissions";
import { HIVES } from "@hives/registry";

const mocked = vi.mocked(backend);

function perms(overrides: Partial<ActivePermissions>): ActivePermissions {
  return {
    memberId: 5,
    role: null,
    hives: [],
    allHives: false,
    canAdmin: false,
    seeCost: false,
    seeProfit: false,
    seeChargeable: false,
    canManageBudget: false,
    canMarketing: false,
    canDesign: false,
    ...overrides,
  };
}

/** The rail once the active user's permissions have landed. The provider
 *  starts at full access, so reading the rail any earlier would pass a test of
 *  "sees everything" without the permissions having been read at all. */
async function railOnceLoaded() {
  await waitFor(() => expect(mocked.getActivePermissions).toHaveBeenCalled());
  await act(async () => {});
  return screen.getAllByRole("tab").map((t) => t.textContent);
}

describe("which Hives the rail shows", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /// Deny by default: the rail is the chat and the Hives this role was
  /// granted, and nothing it was not.
  it("shows only the Hives the role was granted", async () => {
    mocked.getActivePermissions.mockResolvedValue(perms({ hives: ["develop"] }));
    render(
      <PermissionProvider>
        <WorkspaceShell />
      </PermissionProvider>,
    );
    expect(await railOnceLoaded()).toEqual(["Chat", "Develop"]);
  });

  /// Admin — and nobody being active — sees every Hive, including one with no
  /// grant row at all, so a Hive added later can never be invisible to everyone.
  it("shows every Hive to a role that sees them all", async () => {
    mocked.getActivePermissions.mockResolvedValue(
      perms({ hives: [], allHives: true, canAdmin: true }),
    );
    render(
      <PermissionProvider>
        <WorkspaceShell />
      </PermissionProvider>,
    );
    expect(await railOnceLoaded()).toEqual(["Chat", ...HIVES.map((h) => h.label), "Admin"]);
  });
});
