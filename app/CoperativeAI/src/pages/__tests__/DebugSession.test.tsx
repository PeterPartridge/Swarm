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
    debugRestartFrame: vi.fn(),
    debugThreads: vi.fn(),
    debugEvaluate: vi.fn(),
    debugSetVariable: vi.fn(),
    debugSetExpression: vi.fn(),
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
      restartFrame: true,
      hovers: true,
      setVariable: true,
      setExpression: true,
    });
    mocked.debugStop.mockResolvedValue();
    mocked.debugResume.mockResolvedValue();
    // One thread unless a test says otherwise — the ordinary case, and the one
    // where the picker stays out of the way.
    mocked.debugThreads.mockResolvedValue([{ id: 1, name: "main" }]);
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
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 8, column: 2, canRestart: true },
      { id: 1001, name: "runtime.main", path: "", line: 267, column: 1, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([
      { name: "subtotal", value: "11810", kind: "int", children: 0, parent: 12 },
      { name: "tax", value: "1185", kind: "int", children: 0, parent: 12 },
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
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 12, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([
      { name: "order", value: "main.Order {Subtotal: 11810, Tax: 1185}", kind: "main.Order", children: 4, parent: 12 },
      { name: "total", value: "0", kind: "int", children: 0, parent: 12 },
    ]);
    mocked.debugExpand.mockResolvedValue([
      { name: "Subtotal", value: "11810", kind: "int", children: 0, parent: 12 },
      { name: "Tax", value: "1185", kind: "int", children: 0, parent: 12 },
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
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 12, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([
      { name: "order", value: "main.Order {...}", kind: "main.Order", children: 4, parent: 12 },
    ]);
    mocked.debugExpand.mockResolvedValue([
      { name: "Subtotal", value: "11810", kind: "int", children: 0, parent: 12 },
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
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 12, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([
      { name: "order", value: "main.Order {...}", kind: "main.Order", children: 4, parent: 12 },
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

  /// **Writing into a running program.** The last obviously-missing piece of
  /// an ordinary debugger, and the one with real consequences: the program
  /// carries on from here with a value it would never have computed.
  it("writes a new value into a variable", async () => {
    const user = userEvent.setup();
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 8, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([
      { name: "tax", value: "1185", kind: "int", children: 0, parent: 12 },
    ]);
    mocked.debugSetVariable.mockResolvedValue({
      name: "tax",
      value: "5000",
      kind: "int",
      children: 0,
      parent: 12,
    });
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await user.click(await within(panel).findByLabelText("Change tax"));

    // The box opens on the current value, so a small edit is a small edit.
    const box = within(panel).getByLabelText("New value for tax");
    expect(box).toHaveValue("1185");
    await user.clear(box);
    await user.type(box, "5000{Enter}");

    expect(mocked.debugSetVariable).toHaveBeenCalledWith("dbg-go-1", 12, "tax", "5000");
    // **Re-read, not patched.** A write can change more than the row it was
    // made on, so everything else on screen would otherwise be quietly stale.
    await waitFor(() => expect(mocked.debugVariables).toHaveBeenCalledTimes(2));
  });

  /// Escape has to leave the program exactly as it was — the only safe thing a
  /// half-typed value can do.
  it("writes nothing when an edit is abandoned", async () => {
    const user = userEvent.setup();
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 8, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([
      { name: "tax", value: "1185", kind: "int", children: 0, parent: 12 },
    ]);
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await user.click(await within(panel).findByLabelText("Change tax"));
    await user.type(within(panel).getByLabelText("New value for tax"), "9999{Escape}");

    expect(mocked.debugSetVariable).not.toHaveBeenCalled();
    expect(within(panel).queryByLabelText("New value for tax")).not.toBeInTheDocument();
  });

  /// **A value that opened and then refused would be worse than one that never
  /// opened.** netcoredbg and js-debug can assign to an expression; Delve
  /// cannot, and reports so.
  it("offers no editing where the adapter cannot write", async () => {
    const user = userEvent.setup();
    mocked.debugStart.mockResolvedValue({
      session: "dbg-go-1",
      language: "go",
      breakpoints: [],
      conditions: true,
      logPoints: true,
      hitCounts: false,
      restartFrame: false,
      hovers: true,
      setVariable: false,
      setExpression: false,
    });
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 8, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([
      { name: "tax", value: "1185", kind: "int", children: 0, parent: 12 },
    ]);
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await within(panel).findByText("1185");
    expect(within(panel).queryByLabelText("Change tax")).not.toBeInTheDocument();
  });

  /// **A watch is an expression, not a name in a container**, so it goes
  /// through the other request entirely. Delve reports `setVariable` and not
  /// `setExpression`, which is why these are two capabilities and not one.
  it("assigns to a watched expression through setExpression", async () => {
    const user = userEvent.setup();
    localStorage.setItem("coperativeai.watches", JSON.stringify({ "5": ["order.Total"] }));
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 8, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([]);
    mocked.debugEvaluate.mockResolvedValue({
      name: "order.Total",
      value: "12995",
      kind: "int",
      children: 0,
      parent: 0,
    });
    mocked.debugSetExpression.mockResolvedValue({
      name: "order.Total",
      value: "1",
      kind: "int",
      children: 0,
      parent: 0,
    });
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await user.click(await within(panel).findByLabelText("Change order.Total"));
    const box = within(panel).getByLabelText("New value for order.Total");
    await user.clear(box);
    await user.type(box, "1{Enter}");

    expect(mocked.debugSetExpression).toHaveBeenCalledWith("dbg-go-1", "order.Total", 1000, "1");
  });

  /// **The editor follows the selection, not only the stop.** Picking a caller
  /// is a request to look at that frame — so the highlight moves to its line,
  /// and a hover there is evaluated in its scope, which is a different question
  /// from the same name in the innermost frame.
  it("tells the workspace which frame is selected, not only where it stopped", async () => {
    const user = userEvent.setup();
    const seen: { line: number; hovers: boolean }[] = [];
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.priced", path: "C:/repos/orders/main.go", line: 8, column: 2, canRestart: true },
      { id: 1001, name: "main.main", path: "C:/repos/orders/main.go", line: 12, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([]);
    render(
      <DebugSession
        solution={sol()}
        onStopped={(at) => seen.push({ line: at.frame.line, hovers: at.hovers })}
      />,
    );

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await within(panel).findByLabelText("Frame main.main");
    expect(seen[seen.length - 1]).toEqual({ line: 8, hovers: true });

    await user.click(within(panel).getByLabelText("Frame main.main"));

    await waitFor(() => expect(seen[seen.length - 1]).toEqual({ line: 12, hovers: true }));
  });

  /// **What the variable list cannot answer.** That shows what happens to have
  /// a name in scope; a watch shows what somebody wants to know, and
  /// `subtotal + tax` is not a variable anywhere.
  it("works out a watched expression in the selected frame", async () => {
    const user = userEvent.setup();
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.priced", path: "C:/repos/orders/main.go", line: 8, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([]);
    mocked.debugEvaluate.mockResolvedValue({
      name: "subtotal + tax",
      value: "12995",
      kind: "int",
      children: 0,
      parent: 12,
    });
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await within(panel).findByLabelText("Watch an expression");

    await user.type(within(panel).getByLabelText("Watch an expression"), "subtotal + tax");
    await user.click(within(panel).getByRole("button", { name: "Watch" }));

    // Worked out on adding rather than at the next stop: the reason somebody
    // types one is to see it now.
    expect(mocked.debugEvaluate).toHaveBeenCalledWith("dbg-go-1", "subtotal + tax", 1000);
    expect(await within(panel).findByText("12995")).toBeInTheDocument();
  });

  /// **Out of scope is an ordinary answer, not a broken session.** You set the
  /// watch for a different frame, and the message belongs on that one row.
  it("says on the row when a watch is out of scope, and keeps the rest", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "coperativeai.watches",
      JSON.stringify({ "5": ["subtotal + tax", "len(items)"] }),
    );
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 12, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([]);
    mocked.debugEvaluate.mockImplementation(async (_s: string, expression: string) => {
      if (expression === "subtotal + tax") throw "could not find symbol value for subtotal";
      // An evaluated expression has no container, so `parent` is zero — there
      // is nothing for `setVariable` to name it by.
      return { name: expression, value: "2", kind: "int", children: 0, parent: 0 };
    });
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    expect(
      await within(panel).findByText(/could not find symbol value for subtotal/),
    ).toBeInTheDocument();
    // The one that did work is unaffected — a single failed watch must not
    // blank the pane.
    expect(within(panel).getByText("2")).toBeInTheDocument();
    // And nothing was raised over the panel as a session error.
    expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
  });

  /// A watch belongs to a frame, so picking a different one asks again rather
  /// than leaving the last frame's answer under the same expression.
  it("works the watches out again when a different frame is picked", async () => {
    const user = userEvent.setup();
    localStorage.setItem("coperativeai.watches", JSON.stringify({ "5": ["total"] }));
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.priced", path: "C:/repos/orders/main.go", line: 8, column: 2, canRestart: true },
      { id: 1001, name: "main.main", path: "C:/repos/orders/main.go", line: 12, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([]);
    mocked.debugEvaluate.mockResolvedValue({ name: "total", value: "12995", kind: "int", children: 0, parent: 12 });
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await waitFor(() =>
      expect(mocked.debugEvaluate).toHaveBeenCalledWith("dbg-go-1", "total", 1000),
    );

    await user.click(within(panel).getByLabelText("Frame main.main"));

    await waitFor(() =>
      expect(mocked.debugEvaluate).toHaveBeenCalledWith("dbg-go-1", "total", 1001),
    );
  });

  /// A watch that comes back a struct opens like any variable — the same
  /// machinery, because it is the same kind of answer.
  it("opens a watch that came back with fields", async () => {
    const user = userEvent.setup();
    localStorage.setItem("coperativeai.watches", JSON.stringify({ "5": ["items"] }));
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.priced", path: "C:/repos/orders/main.go", line: 8, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([]);
    mocked.debugEvaluate.mockResolvedValue({
      name: "items",
      value: "[]string len: 2",
      kind: "[]string",
      children: 9,
      parent: 12,
    });
    mocked.debugExpand.mockResolvedValue([
      { name: "[0]", value: "desk", kind: "string", children: 0, parent: 12 },
      { name: "[1]", value: "lamp", kind: "string", children: 0, parent: 12 },
    ]);
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await within(panel).findByLabelText("Open items");
    await user.click(within(panel).getByLabelText("Open items"));

    expect(mocked.debugExpand).toHaveBeenCalledWith("dbg-go-1", 9);
    expect(await within(panel).findByText("desk")).toBeInTheDocument();
  });

  /// The expression outlasts the session; the answer does not. Showing the last
  /// value against a program that has moved on would be worse than showing
  /// nothing.
  it("keeps the expression but drops its value when the program moves", async () => {
    const user = userEvent.setup();
    localStorage.setItem("coperativeai.watches", JSON.stringify({ "5": ["total"] }));
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 12, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([]);
    mocked.debugEvaluate.mockResolvedValue({ name: "total", value: "12995", kind: "int", children: 0, parent: 12 });
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    expect(await within(panel).findByText("12995")).toBeInTheDocument();

    act(() => {
      emit?.({ session: "dbg-go-1", event: "continued", body: {} });
    });

    expect(within(panel).queryByText("12995")).not.toBeInTheDocument();
  });

  /// **The correction, and it is the protocol's own.** Nothing is bound until
  /// the program actually runs, so both handshakes answer `verified: false` —
  /// js-debug says "breakpoint.provisionalBreakpoint" while doing exactly that.
  /// DAP sends a `breakpoint` event when it really binds one, and until this
  /// listened for it a TypeScript session reported its breakpoints as unset
  /// while stopping on them perfectly well.
  it("stops saying a breakpoint failed once the adapter binds it", async () => {
    const user = userEvent.setup();
    mocked.debugStart.mockResolvedValue({
      session: "dbg-ts-1",
      language: "typescript",
      breakpoints: [
        {
          path: "C:/repos/orders/app.js",
          requested: 3,
          line: null,
          verified: false,
          message: "breakpoint.provisionalBreakpoint",
          id: 1,
        },
      ],
      conditions: true,
      logPoints: true,
      hitCounts: true,
      restartFrame: true,
      hovers: true,
      setVariable: true,
      setExpression: true,
    });
    render(<DebugSession solution={sol({ language: "TypeScript (vite)" })} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    // What the handshake said, which is not yet true.
    expect(await screen.findByText(/1 could not be set/)).toBeInTheDocument();

    act(() => {
      emit?.({
        session: "dbg-ts-1",
        event: "breakpoint",
        body: { reason: "changed", breakpoint: { id: 1, verified: true, line: 3 } },
      });
    });

    expect(screen.queryByText(/could not be set/)).not.toBeInTheDocument();
  });

  /// A correction for a breakpoint this session does not have must not quietly
  /// alter one that it does — ids come from the adapter and are not ours.
  it("ignores a correction for a breakpoint it does not know", async () => {
    const user = userEvent.setup();
    mocked.debugStart.mockResolvedValue({
      session: "dbg-ts-1",
      language: "typescript",
      breakpoints: [
        {
          path: "C:/repos/orders/app.js",
          requested: 3,
          line: null,
          verified: false,
          message: "breakpoint.provisionalBreakpoint",
          id: 1,
        },
      ],
      conditions: true,
      logPoints: true,
      hitCounts: true,
      restartFrame: true,
      hovers: true,
      setVariable: true,
      setExpression: true,
    });
    render(<DebugSession solution={sol({ language: "TypeScript (vite)" })} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    expect(await screen.findByText(/1 could not be set/)).toBeInTheDocument();

    act(() => {
      emit?.({
        session: "dbg-ts-1",
        event: "breakpoint",
        body: { reason: "changed", breakpoint: { id: 99, verified: true, line: 3 } },
      });
    });

    expect(screen.getByText(/1 could not be set/)).toBeInTheDocument();
  });

  /// The other thing this event is for: an adapter slides a breakpoint to the
  /// next line that actually runs, and saying nothing would leave the gutter
  /// disagreeing with where the program will stop.
  it("says when a breakpoint moved to the next line that runs", async () => {
    const user = userEvent.setup();
    mocked.debugStart.mockResolvedValue({
      session: "dbg-go-1",
      language: "go",
      breakpoints: [
        {
          path: "C:/repos/orders/main.go",
          requested: 7,
          line: 7,
          verified: true,
          message: "",
          id: 1,
        },
      ],
      conditions: true,
      logPoints: true,
      hitCounts: true,
      restartFrame: true,
      hovers: true,
      setVariable: true,
      setExpression: true,
    });
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());

    act(() => {
      emit?.({
        session: "dbg-go-1",
        event: "breakpoint",
        body: { reason: "changed", breakpoint: { id: 1, verified: true, line: 8 } },
      });
    });

    expect(await screen.findByText(/1 moved to the next line that runs/)).toBeInTheDocument();
  });


  /// **A log point's message and the debugger clearing its throat looked
  /// alike.** DAP marks output produced at a known place with a source and a
  /// line, and an adapter's own chatter carries neither — verified against the
  /// real Delve, whose log points arrive with `line` and `source` set and whose
  /// "Type 'dlv help'…" banner does not.
  it("says which line printed a log point message, and leaves chatter alone", async () => {
    const user = userEvent.setup();
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());

    act(() => {
      emit?.({
        session: "dbg-go-1",
        event: "output",
        body: { category: "console", output: "Type 'dlv help' for list of commands.\n" },
      });
      emit?.({
        session: "dbg-go-1",
        event: "output",
        body: {
          category: "stdout",
          output: "> [Go 1]: round 2\n",
          line: 8,
          source: { path: "C:/repos/orders/main.go" },
        },
      });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    const out = await within(panel).findByLabelText("Program output");
    // The message says where it came from…
    expect(within(out).getByText("main.go:8")).toBeInTheDocument();
    // …and the chatter is left as it is rather than given a location it never
    // claimed.
    expect(out).toHaveTextContent("Type 'dlv help'");
    expect(within(out).queryAllByText(/^main\.go:/)).toHaveLength(1);
  });

  /// **The case this exists for is deadlock.** The thread that stopped is
  /// rarely the one holding the lock, so a debugger that only ever showed the
  /// stopped thread could not show you the problem at all.
  it("lists every thread and marks the one that stopped", async () => {
    const user = userEvent.setup();
    mocked.debugThreads.mockResolvedValue([
      { id: 1, name: "main" },
      { id: 17, name: "goroutine 17 [chan receive]" },
    ]);
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 21, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([]);
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const threads = await screen.findByRole("group", { name: "Threads" });
    expect(within(threads).getByLabelText("Thread main")).toBeInTheDocument();
    // Everything is stopped, but only one of them is why.
    expect(within(threads).getByLabelText("Thread main")).toHaveTextContent("stopped here");
    expect(
      within(threads).getByLabelText("Thread goroutine 17 [chan receive]"),
    ).not.toHaveTextContent("stopped here");
  });

  /// **The whole point: somebody else's stack.** In a deadlock the interesting
  /// frames belong to a thread the breakpoint never touched.
  it("shows another thread's stack when one is picked", async () => {
    const user = userEvent.setup();
    mocked.debugThreads.mockResolvedValue([
      { id: 1, name: "main" },
      { id: 17, name: "waiter" },
    ]);
    mocked.debugStack.mockImplementation(async (_s: string, thread: number) =>
      thread === 1
        ? [{ id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 21, column: 2, canRestart: true }]
        : [{ id: 2000, name: "main.waiter", path: "C:/repos/orders/main.go", line: 10, column: 2, canRestart: true }],
    );
    mocked.debugVariables.mockResolvedValue([]);
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await within(panel).findByLabelText("Frame main.main");

    await user.click(within(panel).getByLabelText("Thread waiter"));

    expect(await within(panel).findByLabelText("Frame main.waiter")).toBeInTheDocument();
    expect(within(panel).queryByLabelText("Frame main.main")).not.toBeInTheDocument();
  });

  /// **Unlike a frame, a thread is something a step can be pointed at.** DAP's
  /// step requests carry a `threadId`, so picking a thread and stepping it is a
  /// real operation rather than a UI that only looks like one.
  it("steps the thread that is selected, not the one that stopped", async () => {
    const user = userEvent.setup();
    mocked.debugThreads.mockResolvedValue([
      { id: 1, name: "main" },
      { id: 17, name: "waiter" },
    ]);
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 21, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([]);
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await within(panel).findByLabelText("Thread waiter");
    await user.click(within(panel).getByLabelText("Thread waiter"));
    await user.click(within(panel).getByLabelText("Step over"));

    expect(mocked.debugResume).toHaveBeenCalledWith("dbg-go-1", "over", 17);
  });

  /// A single-threaded program has nothing to pick between, and a picker with
  /// one entry is a control that cannot do anything.
  it("shows no thread picker when there is only one thread", async () => {
    const user = userEvent.setup();
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 8, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([]);
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    await screen.findByLabelText("Frame main.main");
    expect(screen.queryByRole("group", { name: "Threads" })).not.toBeInTheDocument();
  });

  /// The list is a snapshot of one moment. While the program runs it is out of
  /// date, and offering threads that may have ended is worse than none.
  it("puts the thread list away while the program is running", async () => {
    const user = userEvent.setup();
    mocked.debugThreads.mockResolvedValue([
      { id: 1, name: "main" },
      { id: 17, name: "waiter" },
    ]);
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "main.main", path: "C:/repos/orders/main.go", line: 21, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([]);
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });
    await screen.findByRole("group", { name: "Threads" });

    act(() => {
      emit?.({ session: "dbg-go-1", event: "continued", body: {} });
    });

    expect(screen.queryByRole("group", { name: "Threads" })).not.toBeInTheDocument();
  });

  /// **What DAP cannot do, said out loud.** `next`, `stepIn` and `stepOut`
  /// carry a thread and nothing else, so a step always acts on the innermost
  /// frame however the stack is selected. There is no version of this app that
  /// could make stepping follow the selection, so it says so instead.
  it("says that stepping acts on the innermost frame, not the selected one", async () => {
    const user = userEvent.setup();
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "inner", path: "C:/repos/orders/main.go", line: 2, column: 2, canRestart: true },
      { id: 1001, name: "outer", path: "C:/repos/orders/main.go", line: 6, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([]);
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await within(panel).findByLabelText("Frame inner");
    // Nothing to warn about while the innermost frame is the selected one.
    expect(within(panel).queryByText(/Stepping always acts on/)).not.toBeInTheDocument();

    await user.click(within(panel).getByLabelText("Frame outer"));

    // And it names the frame that will actually be stepped, rather than
    // leaving "the innermost one" to be worked out from the list.
    const notice = await within(panel).findByText(/Stepping always acts on/);
    expect(notice).toHaveTextContent("inner");
  });

  /// **The one thing selecting a frame can actually do.** `restartFrame` is the
  /// only DAP request that names a frame rather than a thread.
  it("runs one frame again from its first line", async () => {
    const user = userEvent.setup();
    mocked.debugRestartFrame.mockResolvedValue();
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "inner", path: "C:/repos/orders/main.go", line: 2, column: 2, canRestart: true },
      { id: 1001, name: "outer", path: "C:/repos/orders/main.go", line: 6, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([]);
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await within(panel).findByLabelText("Run outer again");
    // Not offered on the innermost frame: restarting where you already are is
    // "step out and back in", which the step controls already do.
    expect(within(panel).queryByLabelText("Run inner again")).not.toBeInTheDocument();

    await user.click(within(panel).getByLabelText("Run outer again"));
    expect(mocked.debugRestartFrame).toHaveBeenCalledWith("dbg-go-1", 1001);
  });

  /// A runtime frame is on the stack and cannot be restarted even where its
  /// neighbours can — offering a button that always failed would be worse than
  /// not offering one.
  it("offers no restart on a frame the adapter says cannot be restarted", async () => {
    const user = userEvent.setup();
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "inner", path: "C:/repos/orders/main.go", line: 2, column: 2, canRestart: true },
      { id: 1001, name: "runtime.main", path: "", line: 267, column: 1, canRestart: false },
    ]);
    mocked.debugVariables.mockResolvedValue([]);
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await within(panel).findByLabelText("Frame runtime.main");
    expect(within(panel).queryByLabelText("Run runtime.main again")).not.toBeInTheDocument();
  });

  /// An adapter that cannot do it at all — Delve and netcoredbg both report no
  /// `supportsRestartFrame` — gets no button rather than a failing one.
  it("offers no restart when the adapter cannot do it", async () => {
    const user = userEvent.setup();
    mocked.debugStart.mockResolvedValue({
      session: "dbg-go-1",
      language: "go",
      breakpoints: [],
      conditions: true,
      logPoints: true,
      hitCounts: false,
      restartFrame: false,
      hovers: true,
      setVariable: true,
      setExpression: true,
    });
    mocked.debugStack.mockResolvedValue([
      { id: 1000, name: "inner", path: "C:/repos/orders/main.go", line: 2, column: 2, canRestart: true },
      { id: 1001, name: "outer", path: "C:/repos/orders/main.go", line: 6, column: 2, canRestart: true },
    ]);
    mocked.debugVariables.mockResolvedValue([]);
    render(<DebugSession solution={sol()} />);

    await user.click(screen.getByLabelText("Debug Orders"));
    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    act(() => {
      emit?.({ session: "dbg-go-1", event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    });

    const panel = screen.getByRole("region", { name: "Debugger for Orders" });
    await within(panel).findByLabelText("Frame outer");
    expect(within(panel).queryByLabelText("Run outer again")).not.toBeInTheDocument();
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
          id: 7,
        },
      ],
      conditions: false,
      logPoints: true,
      hitCounts: true,
      restartFrame: true,
      hovers: true,
      setVariable: true,
      setExpression: true,
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
