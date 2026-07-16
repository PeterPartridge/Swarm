import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Product/Develop tabs mount live pages; give them a quiet backend.
vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listProducts: vi.fn().mockResolvedValue([]),
    getPlanningHierarchy: vi
      .fn()
      .mockResolvedValue(["epic", "feature", "userStory", "task"]),
    getRoadmapMode: vi.fn().mockResolvedValue("sprints"),
    listTeamMembers: vi.fn().mockResolvedValue([]),
    listSolutions: vi.fn().mockResolvedValue([]),
  };
});
import WorkspaceShell from "../WorkspaceShell";
import { DEFAULT_TAB_COLORS } from "../../lib/theme";

describe("WorkspaceShell", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("opens straight into the workspace with the three tabs — no login screen", () => {
    render(<WorkspaceShell />);
    expect(screen.getByRole("tab", { name: "Product" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Develop" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Test" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it("clicking a tab switches to that environment", async () => {
    const user = userEvent.setup();
    render(<WorkspaceShell />);
    expect(
      screen.getByRole("tabpanel", { name: "Product environment" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Develop" }));
    expect(
      screen.getByRole("tabpanel", { name: "Develop environment" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Test" }));
    expect(
      screen.getByRole("tabpanel", { name: "Test environment" }),
    ).toBeInTheDocument();
  });

  it("marks the active tab and gives each tab its own colour", async () => {
    const user = userEvent.setup();
    render(<WorkspaceShell />);
    const product = screen.getByRole("tab", { name: "Product" });
    const develop = screen.getByRole("tab", { name: "Develop" });

    expect(product).toHaveAttribute("aria-selected", "true");
    expect(develop).toHaveAttribute("aria-selected", "false");

    expect(product.style.getPropertyValue("--tab-color")).toBe(
      DEFAULT_TAB_COLORS.product,
    );
    expect(develop.style.getPropertyValue("--tab-color")).toBe(
      DEFAULT_TAB_COLORS.develop,
    );

    await user.click(develop);
    expect(develop).toHaveAttribute("aria-selected", "true");
    expect(product).toHaveAttribute("aria-selected", "false");
  });

  it("changing a colour updates the tab and survives a remount (restart)", () => {
    render(<WorkspaceShell />);
    const input = screen.getByLabelText("Product colour") as HTMLInputElement;

    // user-event has no color-picker interaction; fire the change directly.
    fireEvent.change(input, { target: { value: "#112233" } });

    expect(
      screen
        .getByRole("tab", { name: "Product" })
        .style.getPropertyValue("--tab-color"),
    ).toBe("#112233");

    cleanup();
    render(<WorkspaceShell />);
    expect(
      screen
        .getByRole("tab", { name: "Product" })
        .style.getPropertyValue("--tab-color"),
    ).toBe("#112233");
  });
});
