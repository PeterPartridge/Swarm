import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConsoleDock from "../../components/code/ConsoleDock";
import type { Solution } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return { ...original, openConsoleWindow: vi.fn() };
});

// The panes hold a real PTY and xterm.js. What this file is about is the dock
// around them — the grip, the drag, and what happens to the panel afterwards.
vi.mock("../../components/code/ConsolePanes", () => ({
  default: () => null,
}));

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const solution: Solution = {
  id: 3,
  name: "Shop Web",
  productId: 1,
  solutionType: "website",
  answers: "{}",
  origin: "created",
  githubUrl: null,
  githubVisibility: null,
  localPath: "C:/repos/shop-web",
  testCommand: null,
  language: null,
  runCommand: null,
  startFrom: null,
};

/** Drags the grip by `by` pixels and lets go.
 *
 *  Built by hand rather than through `fireEvent.pointerMove`, because jsdom has
 *  no `PointerEvent` and the fallback drops `clientX` — which made every drag
 *  measure `NaN` pixels and, before the component guarded it, pull the console
 *  out on the slightest twitch. */
async function drag(by: number) {
  const grip = screen.getByText("Console").closest("header")!;
  const at = (type: string, x: number) => {
    const e = new MouseEvent(type, { bubbles: true });
    Object.defineProperty(e, "clientX", { value: x });
    Object.defineProperty(e, "clientY", { value: 0 });
    grip.dispatchEvent(e);
  };
  at("pointerdown", 0);
  at("pointermove", by);
  at("pointerup", by);
}

describe("ConsoleDock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.openConsoleWindow.mockResolvedValue(undefined);
  });

  it("sits with the code and says how to pull it out", () => {
    render(<ConsoleDock solution={solution} />);
    expect(screen.getByLabelText("Console for Shop Web")).toBeInTheDocument();
    expect(screen.getByText("drag to pull it out")).toBeInTheDocument();
  });

  /// A window is not something to open by accident, and the header is also
  /// what you click to hide the dock — so a few pixels while clicking must
  /// stay a click.
  it("does not pull out on a short drag", async () => {
    render(<ConsoleDock solution={solution} />);
    await drag(20);
    expect(mocked.openConsoleWindow).not.toHaveBeenCalled();
  });

  it("pulls out into its own window on a real drag", async () => {
    render(<ConsoleDock solution={solution} adoptId="term-3-99" />);
    await drag(200);

    await waitFor(() =>
      // The shell id goes with it, so the new window adopts the running PTY
      // rather than starting a second one beside it.
      expect(mocked.openConsoleWindow).toHaveBeenCalledWith(3, "Shop Web", "term-3-99"),
    );
    expect(await screen.findByText("in its own window")).toBeInTheDocument();
    // The panel keeps its place and says where it went — one that vanished
    // would look like it had been thrown away.
    expect(
      screen.getByText(/The shell kept running/),
    ).toBeInTheDocument();
  });

  /// A drag is not reachable from a keyboard, and a console only mice can pull
  /// out is a console half the people here cannot.
  it("pulls out from a button too", async () => {
    const user = userEvent.setup();
    render(<ConsoleDock solution={solution} />);

    await user.click(
      screen.getByLabelText("Open the console for Shop Web in its own window"),
    );

    await waitFor(() =>
      expect(mocked.openConsoleWindow).toHaveBeenCalledWith(3, "Shop Web", null),
    );
  });

  it("comes back when asked", async () => {
    const user = userEvent.setup();
    render(<ConsoleDock solution={solution} />);
    await drag(200);
    await screen.findByText("in its own window");

    await user.click(screen.getByLabelText("Bring the console for Shop Web back"));
    expect(screen.getByText("drag to pull it out")).toBeInTheDocument();
  });

  /// A window that cannot be opened has to say so rather than leaving the dock
  /// looking like it did nothing.
  it("says so when the window will not open", async () => {
    mocked.openConsoleWindow.mockRejectedValue("no window could be created");
    render(<ConsoleDock solution={solution} />);
    await drag(200);

    expect(await screen.findByRole("alert")).toHaveTextContent("no window could be created");
    expect(screen.getByText("drag to pull it out")).toBeInTheDocument();
  });
});
