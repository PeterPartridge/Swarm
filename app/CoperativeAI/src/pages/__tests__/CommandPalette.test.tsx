import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CommandPalette, { type PaletteGroup } from "../../components/common/CommandPalette";

function groups(run = vi.fn()): PaletteGroup[] {
  return [
    {
      name: "Go to",
      items: [
        { glyph: "P", label: "Product", hint: "⌘1", run },
        { glyph: "D", label: "Develop", hint: "⌘2", run },
      ],
    },
    {
      name: "Develop",
      items: [{ glyph: "‹›", label: "Code", hint: "", run }],
    },
  ];
}

describe("CommandPalette", () => {
  it("shows nothing until it is opened", () => {
    render(<CommandPalette open={false} groups={groups()} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists every destination under its group", async () => {
    render(<CommandPalette open groups={groups()} onClose={() => {}} />);
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    expect(screen.getByText("Go to")).toBeInTheDocument();
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByText("Code")).toBeInTheDocument();
  });

  /// Typing narrows to what matches, so the list is a search not a menu.
  it("filters as you type", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open groups={groups()} onClose={() => {}} />);

    await user.type(screen.getByLabelText("Search or run"), "cod");

    expect(screen.getByText("Code")).toBeInTheDocument();
    expect(screen.queryByText("Product")).not.toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open groups={groups()} onClose={() => {}} />);
    await user.type(screen.getByLabelText("Search or run"), "zzzz");
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  /// Enter runs the highlighted row and closes — the whole point of ⌘K is that
  /// you never leave the keyboard.
  it("runs the first match on Enter and closes", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open groups={groups(run)} onClose={onClose} />);

    await user.type(screen.getByLabelText("Search or run"), "cod");
    await user.keyboard("{Enter}");

    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  /// ↑↓ crosses group boundaries: the groups are headings, not separate lists.
  it("moves the selection with the arrow keys across groups", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open groups={groups()} onClose={() => {}} />);

    // first row starts selected
    expect(screen.getByRole("button", { name: /Product/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{ArrowDown}{ArrowDown}");
    // …third row is in the next group
    expect(screen.getByRole("button", { name: /Code/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette open groups={groups()} onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
