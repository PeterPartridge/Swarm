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
    chatTurn: vi.fn(),
    githubStatus: vi.fn().mockResolvedValue({ connected: false }),
  };
});
import WorkspaceShell from "../WorkspaceShell";
import { DEFAULT_TAB_COLORS } from "../../components/common/TabBar";
import { HIVES } from "@hives/registry";

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

  /// The rail is the chat, the registry, then Admin, so a Hive added to the
  /// registry gets its tab without anyone editing the shell.
  it("puts the chat first, then every registered Hive, then Admin", () => {
    render(<WorkspaceShell />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Chat",
      ...HIVES.map((h) => h.label),
      "Admin",
    ]);
  });

  /// The chat is the main screen: it is where the app opens, and it stays
  /// mounted while a Hive is open, so the conversation is still there on return.
  it("opens on the chat and keeps it while a Hive is open", async () => {
    const user = userEvent.setup();
    render(<WorkspaceShell />);
    expect(screen.getByRole("tabpanel", { name: "Chat environment" })).toBeInTheDocument();
    // No Products in this backend, so the chat says it needs one.
    const notice = await screen.findByText(/needs a Product/);
    expect(notice).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Develop" }));
    expect(notice).not.toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Chat" }));
    expect(notice).toBeVisible();
  });

  it("clicking a tab switches to that environment", async () => {
    const user = userEvent.setup();
    render(<WorkspaceShell />);
    await user.click(screen.getByRole("tab", { name: "Product" }));
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

    await user.click(product);
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
