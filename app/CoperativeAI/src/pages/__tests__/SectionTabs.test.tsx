import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import SectionTabs from "../../components/common/SectionTabs";

const options = [
  { id: "board", label: "Board" },
  { id: "sprint", label: "Sprint" },
  { id: "list", label: "List" },
];

/** Pretends the window is narrow (or not) for one test. jsdom has no
 *  `matchMedia` at all, which is why the component treats its absence as wide. */
function setViewport(narrow: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: narrow,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SectionTabs", () => {
  /// A row is one press; a dropdown is two. For anyone taking the shortest
  /// route the row wins whenever it fits, so it is the default.
  it("shows a row of tabs when there is room", () => {
    render(
      <SectionTabs label="View" options={options} active="board" onSelect={() => {}} />,
    );

    const tabs = screen.getByRole("tablist", { name: "View" });
    expect(tabs).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Board" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Sprint" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("reports which one was chosen", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SectionTabs label="View" options={options} active="board" onSelect={onSelect} />,
    );

    await user.click(screen.getByRole("tab", { name: "List" }));
    expect(onSelect).toHaveBeenCalledWith("list");
  });

  /// Below the breakpoint a row wraps onto three lines and stops being a row —
  /// the one case a dropdown is genuinely better.
  it("becomes a dropdown when the window is too narrow for a row", () => {
    setViewport(true);
    render(
      <SectionTabs label="View" options={options} active="sprint" onSelect={() => {}} />,
    );

    const select = screen.getByLabelText("View");
    expect(select).toHaveValue("sprint");
    // The same choices, none dropped.
    expect(screen.getByRole("option", { name: "Board" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "List" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("reports the choice from the dropdown too", async () => {
    setViewport(true);
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SectionTabs label="View" options={options} active="board" onSelect={onSelect} />,
    );

    await user.selectOptions(screen.getByLabelText("View"), "list");
    expect(onSelect).toHaveBeenCalledWith("list");
  });

  /// The name is what every test and every screen reader finds these by, so it
  /// has to survive the change of shape. Otherwise a narrow window would quietly
  /// break navigation that works wide.
  it("keeps the same accessible name in both shapes", () => {
    const wide = render(
      <SectionTabs label="Settings sections" options={options} active="board" onSelect={() => {}} />,
    );
    expect(screen.getByRole("tablist", { name: "Settings sections" })).toBeInTheDocument();
    wide.unmount();

    setViewport(true);
    render(
      <SectionTabs label="Settings sections" options={options} active="board" onSelect={() => {}} />,
    );
    expect(screen.getByLabelText("Settings sections")).toBeInTheDocument();
  });

  /// A page that already owns a tablist gets pressed buttons instead, so a
  /// screen reader is not asked which of two sets of "the tabs" is meant.
  it("can render as pressed buttons rather than a second tablist", () => {
    render(
      <SectionTabs
        label="Develop sections"
        options={options}
        active="board"
        onSelect={() => {}}
        as="buttons"
      />,
    );

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
