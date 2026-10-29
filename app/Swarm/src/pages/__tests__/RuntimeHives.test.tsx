import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listProducts: vi.fn().mockResolvedValue([]),
    listTeamMembers: vi.fn().mockResolvedValue([]),
    chatTurn: vi.fn(),
  };
});

import WorkspaceShell from "../WorkspaceShell";
import { HivesContext } from "../../lib/hives";
import { HIVES, type Hive } from "@hives/registry";
import { renderHook } from "@testing-library/react";
import { useHives } from "../../lib/hives";

/** A Hive the static registry does not have — what an installed one from
 *  outside looks like to the shell. */
const studio: Hive = {
  id: "studio",
  label: "Studio",
  color: "#0d9488",
  icon: <circle cx="10" cy="10" r="6" fill="currentColor" />,
  Screen: () => <p>Studio screen</p>,
  views: [{ id: "board", label: "Board", glyph: "▦" }],
};

function renderWith(hives: readonly Hive[]) {
  return render(
    <HivesContext.Provider value={{ hives, reload: async () => {} }}>
      <WorkspaceShell />
    </HivesContext.Provider>,
  );
}

describe("Hives read at run time", () => {
  /// With no provider, nothing changes: the three built in, in order.
  it("defaults to the built-in Hives", () => {
    const { result } = renderHook(() => useHives());
    expect(result.current.hives.map((h) => h.id)).toEqual(HIVES.map((h) => h.id));
  });

  /// The rail, the screen and the colour footer are drawn from the list, so a
  /// Hive the registry does not know appears once it is in it.
  it("draws a Hive that is not in the registry", async () => {
    const user = userEvent.setup();
    renderWith([...HIVES, studio]);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Chat", ...HIVES.map((h) => h.label), "Studio", "Admin"]);
    expect(screen.getByLabelText("Studio colour")).toHaveValue("#0d9488");

    await user.click(screen.getByRole("tab", { name: "Studio" }));
    expect(screen.getByText("Studio screen")).toBeInTheDocument();
  });

  it("offers its views in the palette", async () => {
    const user = userEvent.setup();
    renderWith([...HIVES, studio]);
    await user.click(screen.getByRole("button", { name: /Search or run/ }));
    expect(screen.getByRole("button", { name: /Board/ })).toBeInTheDocument();
  });

  /// A Hive that leaves the list while open: the shell falls back rather than
  /// failing to find its label.
  it("survives the open Hive leaving the list", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWith([...HIVES, studio]);
    await user.click(screen.getByRole("tab", { name: "Studio" }));
    rerender(
      <HivesContext.Provider value={{ hives: HIVES, reload: async () => {} }}>
        <WorkspaceShell />
      </HivesContext.Provider>,
    );
    expect(screen.queryByText("Studio screen")).toBeNull();
    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
  });
});
