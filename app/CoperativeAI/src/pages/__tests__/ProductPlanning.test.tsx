import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductPlanning from "../ProductPlanning";
import type { Repository, WorkItem } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listWorkItems: vi.fn(),
    listRepositories: vi.fn(),
    createWorkItem: vi.fn(),
    updateWorkItemStatus: vi.fn(),
    deleteWorkItem: vi.fn(),
    addRepository: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const repo: Repository = {
  id: 1,
  name: "main-repo",
  localPath: "C:/repos/main",
  isActive: true,
};

function item(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: 1,
    title: "Login feature",
    itemType: "feature",
    status: "planned",
    description: null,
    repositoryId: 1,
    parentItemId: null,
    ...overrides,
  };
}

describe("ProductPlanning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listRepositories.mockResolvedValue([repo]);
    mocked.listWorkItems.mockResolvedValue([]);
  });

  it("shows the five status columns", async () => {
    render(<ProductPlanning />);
    for (const status of backend.STATUSES) {
      expect(
        await screen.findByRole("region", { name: status }),
      ).toBeInTheDocument();
    }
  });

  it("shows work items in the column matching their status", async () => {
    mocked.listWorkItems.mockResolvedValue([
      item({ id: 1, title: "Login feature", status: "planned" }),
      item({ id: 2, title: "Fix crash", itemType: "bug", status: "building" }),
    ]);
    render(<ProductPlanning />);

    const planned = await screen.findByRole("region", { name: "planned" });
    const building = await screen.findByRole("region", { name: "building" });
    expect(planned).toHaveTextContent("Login feature");
    expect(building).toHaveTextContent("Fix crash");
  });

  it("creates a work item from the form and refreshes the board", async () => {
    const user = userEvent.setup();
    mocked.createWorkItem.mockResolvedValue(7);
    render(<ProductPlanning />);

    await user.type(await screen.findByLabelText("Title"), "New feature");
    await user.selectOptions(screen.getByLabelText("Type"), "feature");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(mocked.createWorkItem).toHaveBeenCalledWith({
        title: "New feature",
        itemType: "feature",
        repositoryId: 1,
      }),
    );
    expect(mocked.listWorkItems).toHaveBeenCalledTimes(2);
  });

  it("changes an item's status", async () => {
    const user = userEvent.setup();
    mocked.listWorkItems.mockResolvedValue([
      item({ id: 3, title: "Login feature", status: "planned" }),
    ]);
    mocked.updateWorkItemStatus.mockResolvedValue();
    render(<ProductPlanning />);

    await user.selectOptions(
      await screen.findByLabelText("Status of Login feature"),
      "designing",
    );
    await waitFor(() =>
      expect(mocked.updateWorkItemStatus).toHaveBeenCalledWith(3, "designing"),
    );
  });

  it("deletes an item", async () => {
    const user = userEvent.setup();
    mocked.listWorkItems.mockResolvedValue([
      item({ id: 4, title: "Old idea", status: "planned" }),
    ]);
    mocked.deleteWorkItem.mockResolvedValue();
    render(<ProductPlanning />);

    await user.click(
      await screen.findByRole("button", { name: "Delete Old idea" }),
    );
    await waitFor(() => expect(mocked.deleteWorkItem).toHaveBeenCalledWith(4));
  });

  it("offers first-repository registration when none exist", async () => {
    const user = userEvent.setup();
    mocked.listRepositories.mockResolvedValue([]);
    mocked.addRepository.mockResolvedValue(1);
    render(<ProductPlanning />);

    expect(
      await screen.findByRole("form", { name: "Register first repository" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Repository name"), "main-repo");
    await user.type(screen.getByLabelText("Local folder"), "C:/repos/main");
    await user.click(
      screen.getByRole("button", { name: "Register repository" }),
    );
    await waitFor(() =>
      expect(mocked.addRepository).toHaveBeenCalledWith(
        "main-repo",
        "C:/repos/main",
      ),
    );
  });

  it("surfaces backend errors instead of crashing", async () => {
    mocked.listWorkItems.mockRejectedValue("backend unavailable");
    render(<ProductPlanning />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "backend unavailable",
    );
  });
});
