import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DebugSession, { debugLanguageOf } from "../../components/code/DebugSession";
import type { Solution } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    debugStart: vi.fn(),
    debugStop: vi.fn(),
    debugResume: vi.fn(),
    debugStack: vi.fn(),
    debugVariables: vi.fn(),
    debugExpand: vi.fn(),
    debugSetBreakpoints: vi.fn(),
  };
});

/// The adapter speaks through Tauri events, so the tests drive it the same way:
/// a captured listener, called with what Delve would really send.
let emit: ((payload: unknown) => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, handler: (m: { payload: unknown }) => void) => {
    emit = (payload) => handler({ payload });
    return Promise.resolve(() => {});
  }),
}));

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const sol = (over: Partial<Solution> = {}): Solution =>
  ({
    id: 5,
    name: "Orders",
    productId: 1,
    solutionType: "api",
    answers: "{}",
    origin: "created",
    githubUrl: null,
    githubVisibility: null,
    localPath: "C:/repos/orders",
    testCommand: null,
    language: "Go (go mod)",
    runCommand: null,
    ...over,
  }) as Solution;

/// The only language signal recorded is what the Solution was created as, and
/// it is prose rather than an enum.
describe("debugLanguageOf", () => {
  it("reads the language out of what the Solution was started as", () => {
    expect(debugLanguageOf("Go (go mod)")).toBe("go");
    expect(debugLanguageOf("Python (venv)")).toBe("python");
    expect(debugLanguageOf("C# (dotnet)")).toBe("csharp");
    expect(debugLanguageOf("TypeScript (vite)")).toBe("typescript");
  });

  it("says nothing rather than guessing when there is no signal", () => {
    expect(debugLanguageOf(null)).toBeNull();
    expect(debugLanguageOf("Elixir")).toBeNull();
  });
});

describe("DebugSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    emit = null;
    mocked.debugStart.mockResolvedValue({
      session: "dbg-go-1",
      language: "go",
      breakpoints: [],
      conditions: true,
      logPoints: true,
      hitCounts: true,
    });
    mocked.debugStop.mockResolvedValue();
    mocked.debugResume.mockResolvedValue();
  });

  /// A launch shape that is not built must not be offered as a button that
  /// always fails — the panel names the language and says which do work.
  it("will not offer to debug a language whose launch is not built", () => {
    render(<DebugSession solution={sol({ language: "Python (venv)" })} />);

    expect(screen.getByLabelText("Debug Orders")).toBeDisabled();
    expect(screen.getByText(/Launching python is not wired up yet/)).toBeInTheDocument();
  });

  /// TypeScript launches now, through js-debug — verified against the real
  /// adapter in the Rust suite, and offered here because of it.
  it("offers to debug a TypeScript Solution", () => {
    render(<DebugSession solution={sol({ language: "TypeScript (vite)" })} />);

    expect(screen.getByLabelText("Debug Orders")).toBeEnabled();
    expect(screen.queryByText(/is not wired up yet/)).not.toBeInTheDocument();
  });

  /// C# launches now, through netcoredbg — verified against the real adapter
  /// in the Rust suite, stopping a real program on a real line.
  it("offers to debug a C# Solution", () => {
    render(<DebugSession solution={sol({ language: "C# (.NET 8)" })} />);

    expect(screen.getByLabelText("Debug Orders")).toBeEnabled();
    expect(screen.queryByText(/is not wired up yet/)).not.toBeInTheDocument();
  });

  it("says so when there is no working copy to run", () => {
    render(<DebugSession solution={sol({ localPath: null })} />);
    expect(screen.getByLabelText("Debug Orders")).toBeDisabled();
    expect(screen.getByText(/No working copy on this machine/)).toBeInTheDocument();
  });

  /// **The stop is the whole feature.** A `stopped` event names a thread, the
  /// thread gives a stack, and the innermost frame gives the variables — which
  /// is what somebody came to a debugger to see.
  it("shows the stack and the variables when the program stops", async () => {
    const user = userEvent.setup();
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 8, column: 2 },
      { id: 1001, name: "runtime.main", path: "", line: 267, column: 1 },
    ]);
    mocked.debugVariables.mockResolvedValue([
      { name: "subtotal", value: "11810", kind: "int", children: 0 },
      { name: "tax", value: "1185", kind: "int", children: 0 },
    ]);
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());

    act(() => {
      emit?.({
        session: "dbg-go-1",
        event: "stopped",
        body: { threadId: 1, reason: "breakpoint" },
      });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    expect(await within(panel).findByText("main.main")).toBeInTheDocument();
    expect(panel).toHaveTextContent("stopped — breakpoint");
    expect(await within(panel).findByText("subtotal")).toBeInTheDocument();
    expect(within(panel).getByText("11810")).toBeInTheDocument();
    // A frame with no source is still a frame — hiding it would make the stack
    // lie about how the program got here.
    expect(within(panel).getByText("no source")).toBeInTheDocument();

    // Stepping is offered only where there is something to step.
    await user.click(within(panel).getByLabelText("Step over"));
    expect(mocked.debugResume).toHaveBeenCalledWith("dbg-go-1", "over", 1);
  });

  /// **A struct is only interesting opened.** The flat list shows
  /// `main.Order {...}`, and what somebody came for is what is inside it.
  it("opens a variable to show its fields, and closes it again", async () => {
    const user = userEvent.setup();
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 12, column: 2 },
    ]);
    mocked.debugVariables.mockResolvedValue([
      { name: "order", value: "main.Order {Subtotal: 11810, Tax: 1185}", kind: "main.Order", children: 4 },
      { name: "total", value: "0", kind: "int", children: 0 },
    ]);
    mocked.debugExpand.mockResolvedValue([
      { name: "Subtotal", value: "11810", kind: "int", children: 0 },
      { name: "Tax", value: "1185", kind: "int", children: 0 },
    ]);
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await within(panel).findByText("order");
    // A scalar has nothing to open, and is not given a caret that does nothing.
    expect(within(panel).queryByLabelText("Open total")).not.toBeInTheDocument();

    await user.click(within(panel).getByLabelText("Open order"));
    expect(mocked.debugExpand).toHaveBeenCalledWith("dbg-go-1", 4);
    expect(await within(panel).findByText("Subtotal")).toBeInTheDocument();
    expect(within(panel).getByText("1185")).toBeInTheDocument();

    await user.click(within(panel).getByLabelText("Close order"));
    expect(within(panel).queryByText("Subtotal")).not.toBeInTheDocument();
  });

  /// **Every handle dies when the program moves.** An expansion left open across
  /// a step would redraw memory that has since been reused, under the old name.
  it("forgets what was open when the program moves on", async () => {
    const user = userEvent.setup();
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 12, column: 2 },
    ]);
    mocked.debugVariables.mockResolvedValue([
      { name: "order", value: "main.Order {...}", kind: "main.Order", children: 4 },
    ]);
    mocked.debugExpand.mockResolvedValue([
      { name: "Subtotal", value: "11810", kind: "int", children: 0 },
    ]);
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await within(panel).findByText("order");
    await user.click(within(panel).getByLabelText("Open order"));
    expect(await within(panel).findByText("Subtotal")).toBeInTheDocument();

    act(() => {
      emit?.({ session: "dbg-go-1", event: "continued", body: {} });
    });
    expect(within(panel).queryByText("Subtotal")).not.toBeInTheDocument();
  });

  /// A failed expansion says why, on the row it failed on. Silently drawing an
  /// empty struct would read as "it has no fields".
  it("says why a variable would not open", async () => {
    const user = userEvent.setup();
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 12, column: 2 },
    ]);
    mocked.debugVariables.mockResolvedValue([
      { name: "order", value: "main.Order {...}", kind: "main.Order", children: 4 },
    ]);
    mocked.debugExpand.mockRejectedValue("that debug session has ended");
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await within(panel).findByText("order");
    await user.click(within(panel).getByLabelText("Open order"));

    expect(await within(panel).findByText(/that debug session has ended/)).toBeInTheDocument();
  });

  /// Stepping a program that is running has nothing to step, so the controls
  /// are off rather than sending a request the adapter will refuse.
  it("keeps the stepping controls off until the program has stopped", async () => {
    const user = userEvent.setup();
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());

    for (const label of ["Continue", "Step over", "Step into", "Step out"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
  });

  /// Two sessions at once must not read each other's stops.
  it("ignores events belonging to another session", async () => {
    const user = userEvent.setup();
    render(<DebugSession solution={sol()} />);
    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());

    act(() => {
      emit?.({ session: "dbg-go-somebody-else", event: "stopped", body: { threadId: 9 } });
    });

    expect(mocked.debugStack).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Debugger for Orders" })).toHaveTextContent(
      "running",
    );
  });

  /// A breakpoint set mid-session that only took effect on the next run would
  /// be worse than one that did nothing, because you would believe it.
  it("pushes the current breakpoints into a running session", async () => {
    const user = userEvent.setup();
    mocked.debugSetBreakpoints.mockResolvedValue([]);
    localStorage.setItem(
      "coperativeai.breakpoints",
      JSON.stringify({ "5": { "main.go": [8] } }),
    );
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    await user.click(screen.getByLabelText("Send the current breakpoints"));

    // Absolute, because an adapter matches what the compiler recorded. The
    // stored shape above is the pre-conditions one, so this also proves it is
    // read rather than dropped.
    expect(mocked.debugSetBreakpoints).toHaveBeenCalledWith("dbg-go-1", [
      { path: "C:/repos/orders/main.go", line: 8, condition: "", log: "", hits: "" },
    ]);
  });

  /// **A refusal carries the adapter's own words.** "3 could not be set" is not
  /// an answer; "this debugger cannot evaluate breakpoint conditions" is.
  it("says why a breakpoint could not be set", async () => {
    const user = userEvent.setup();
    mocked.debugStart.mockResolvedValue({
      session: "dbg-go-1",
      language: "go",
      breakpoints: [
        {
          path: "C:/repos/orders/main.go",
          requested: 8,
          line: null,
          verified: false,
          message: "this debugger cannot evaluate breakpoint conditions",
        },
      ],
      conditions: false,
      logPoints: true,
      hitCounts: true,
    });
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));

    expect(
      await screen.findByText(/this debugger cannot evaluate breakpoint conditions/),
    ).toBeInTheDocument();
    // And said once for the session as a whole, so somebody who has typed a
    // condition knows before wondering why nothing stopped.
    expect(
      screen.getByText(/This debugger does not evaluate breakpoint conditions/),
    ).toBeInTheDocument();
  });
});
