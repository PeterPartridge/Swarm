import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BuildFileEditor from "../../components/code/BuildFileEditor";
import { summarise } from "../../components/code/BreakpointBehaviour";
import { loadBreakpoints, marksIn } from "../../lib/breakpoints";
import type { Solution } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return { ...original, readSolutionFile: vi.fn(), writeSolutionFile: vi.fn() };
});

vi.mock("../../lib/monacoSetup", () => ({ ensureMonaco: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@monaco-editor/react", async () => {
  const { createElement } = await import("react");
  return {
    default: (props: { value: string; "aria-label"?: string }) =>
      createElement("textarea", {
        "aria-label": props["aria-label"],
        value: props.value,
        readOnly: true,
      }),
    loader: { config: vi.fn() },
  };
});

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
    startFrom: null,
    kindLocations: "{}",
    ...over,
  }) as Solution;

/** Opens the behaviour menu for one breakpoint and returns the strip. */
async function openBehaviour(user: ReturnType<typeof userEvent.setup>, line: number) {
  await user.click(screen.getByLabelText(`What the breakpoint at line ${line} does`));
}

describe("BuildFileEditor breakpoint behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocked.readSolutionFile.mockResolvedValue("package main\n\nfunc main() {}\n");
  });

  /// A control with nothing to act on is worse than no control: the strip only
  /// appears once there is a breakpoint to condition.
  it("shows nothing until there is a breakpoint", async () => {
    render(<BuildFileEditor solution={sol()} path="main.go" onClose={() => {}} />);
    await waitFor(() => expect(mocked.readSolutionFile).toHaveBeenCalled());

    expect(screen.queryByLabelText("Breakpoints in main.go")).not.toBeInTheDocument();
  });

  /// **The three boxes that were always on screen.** Their placeholders were
  /// the only thing saying what they were for, so they read as three unrelated
  /// fields rather than one question about one breakpoint. Closed, the control
  /// says what the breakpoint does; open, it is a tick per behaviour.
  it("says what the breakpoint does, and opens onto the behaviours", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "coperativeai.breakpoints",
      JSON.stringify({ "5": { "main.go": [{ line: 8, condition: "" }] } }),
    );
    render(<BuildFileEditor solution={sol()} path="main.go" onClose={() => {}} />);
    await waitFor(() => expect(mocked.readSolutionFile).toHaveBeenCalled());

    const control = screen.getByLabelText("What the breakpoint at line 8 does");
    expect(control).toHaveTextContent("Stops every time");
    expect(screen.queryByLabelText("Only when a condition holds")).not.toBeInTheDocument();

    await openBehaviour(user, 8);
    expect(screen.getByLabelText("Only when a condition holds")).toBeInTheDocument();
    expect(screen.getByLabelText("After a number of hits")).toBeInTheDocument();
    expect(screen.getByLabelText("Print instead of stopping")).toBeInTheDocument();
  });

  /// **The mismatch this closes.** The Debuggers panel already reported that
  /// the adapters support conditional breakpoints, and there was nowhere to set
  /// one — a capability shown and not offered. The expression stays free text:
  /// `model.value == -3` is not something anybody could put in a dropdown.
  it("takes a typed condition, in the program's own language", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "coperativeai.breakpoints",
      JSON.stringify({ "5": { "main.go": [{ line: 8, condition: "" }] } }),
    );
    render(<BuildFileEditor solution={sol()} path="main.go" onClose={() => {}} />);
    await waitFor(() => expect(mocked.readSolutionFile).toHaveBeenCalled());

    await openBehaviour(user, 8);
    await user.click(screen.getByLabelText("Only when a condition holds"));
    await user.type(
      screen.getByLabelText("Only when a condition holds at line 8"),
      "model.value == -3",
    );

    expect(marksIn(loadBreakpoints(), 5, "main.go")).toEqual([
      { line: 8, condition: "model.value == -3", log: "", hits: "" },
    ]);
  });

  /// **All three at once**, because the adapters allow it: print the total, but
  /// only after the seventh time round, and only when it is negative. A
  /// single-choice dropdown could not have said that.
  it("takes a condition, a hit count and a message together", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "coperativeai.breakpoints",
      JSON.stringify({ "5": { "main.go": [{ line: 8, condition: "" }] } }),
    );
    render(<BuildFileEditor solution={sol()} path="main.go" onClose={() => {}} />);
    await waitFor(() => expect(mocked.readSolutionFile).toHaveBeenCalled());

    await openBehaviour(user, 8);
    await user.click(screen.getByLabelText("Only when a condition holds"));
    await user.type(screen.getByLabelText("Only when a condition holds at line 8"), "i > 3");
    await user.click(screen.getByLabelText("After a number of hits"));
    // Delve's grammar, kept as typed: the app does not parse it, because
    // js-debug wants a bare number for the same thing.
    await user.type(screen.getByLabelText("After a number of hits at line 8"), "== 7");
    await user.click(screen.getByLabelText("Print instead of stopping"));
    // `{{` is userEvent's escape for a literal brace — the typed text is
    // `round {i}`, which is the interpolation the adapter evaluates.
    await user.type(screen.getByLabelText("Print instead of stopping at line 8"), "round {{i}");

    expect(marksIn(loadBreakpoints(), 5, "main.go")).toEqual([
      { line: 8, condition: "i > 3", log: "round {i}", hits: "== 7" },
    ]);
  });

  /// Unticking clears what was written. A condition left behind in a hidden box
  /// would still be sent to the debugger, and the breakpoint would go on not
  /// stopping for a reason nothing on screen could explain.
  it("clears the box when its behaviour is turned off", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "coperativeai.breakpoints",
      JSON.stringify({ "5": { "main.go": [{ line: 8, condition: "i == 7" }] } }),
    );
    render(<BuildFileEditor solution={sol()} path="main.go" onClose={() => {}} />);
    await waitFor(() => expect(mocked.readSolutionFile).toHaveBeenCalled());

    await openBehaviour(user, 8);
    // It came back ticked, because it has something in it.
    expect(screen.getByLabelText("Only when a condition holds")).toBeChecked();
    await user.click(screen.getByLabelText("Only when a condition holds"));

    expect(marksIn(loadBreakpoints(), 5, "main.go")).toEqual([
      { line: 8, condition: "", log: "", hits: "" },
    ]);
  });

  /// **A mark that never stops must say so**, or it reads as a debugger that is
  /// not working.
  it("says which breakpoints log rather than stop", async () => {
    localStorage.setItem(
      "coperativeai.breakpoints",
      JSON.stringify({
        "5": {
          "main.go": [
            { line: 8, condition: "" },
            { line: 12, condition: "", log: "round {i}" },
          ],
        },
      }),
    );
    render(<BuildFileEditor solution={sol()} path="main.go" onClose={() => {}} />);
    await waitFor(() => expect(mocked.readSolutionFile).toHaveBeenCalled());

    const strip = screen.getByLabelText("Breakpoints in main.go");
    expect(within(strip).getAllByText("logs")).toHaveLength(1);
    // …and the closed control says it too, without being opened.
    expect(screen.getByLabelText("What the breakpoint at line 12 does")).toHaveTextContent(
      "prints",
    );
  });

  /// The adapter evaluates the expression inside the running program, so it is
  /// the program's language — not JavaScript, and not something this app parses.
  it("says which language the condition is written in", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "coperativeai.breakpoints",
      JSON.stringify({ "5": { "main.go": [{ line: 8, condition: "" }] } }),
    );
    render(<BuildFileEditor solution={sol()} path="main.go" onClose={() => {}} />);
    await waitFor(() => expect(mocked.readSolutionFile).toHaveBeenCalled());

    await openBehaviour(user, 8);
    expect(screen.getByText(/Go \(go mod\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/worked out by the debugger inside the running program/),
    ).toBeInTheDocument();
  });

  /// Only this file's breakpoints, or the strip would offer to condition lines
  /// in a file that is not open.
  it("shows only the breakpoints in the open file", async () => {
    localStorage.setItem(
      "coperativeai.breakpoints",
      JSON.stringify({
        "5": {
          "main.go": [{ line: 8, condition: "" }],
          "other.go": [{ line: 44, condition: "" }],
        },
      }),
    );
    render(<BuildFileEditor solution={sol()} path="main.go" onClose={() => {}} />);
    await waitFor(() => expect(mocked.readSolutionFile).toHaveBeenCalled());

    expect(
      screen.getByLabelText("What the breakpoint at line 8 does"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("What the breakpoint at line 44 does"),
    ).not.toBeInTheDocument();
  });
});

/// "Stop every time" is the absence of the other three, not a fourth tick —
/// two ways to say one thing is a control somebody finds in the wrong one.
describe("summarise", () => {
  const mark = (over: Partial<{ condition: string; log: string; hits: string }> = {}) => ({
    line: 8,
    condition: "",
    log: "",
    hits: "",
    ...over,
  });

  it("says stops every time when nothing else is set", () => {
    expect(summarise(mark())).toBe("Stops every time");
    expect(summarise(mark({ condition: "   " }))).toBe("Stops every time");
  });

  it("names every behaviour that is on", () => {
    expect(summarise(mark({ log: "x" }))).toBe("prints");
    expect(summarise(mark({ condition: "i > 3" }))).toBe("conditional");
    expect(summarise(mark({ hits: "== 7" }))).toBe("after == 7");
    expect(summarise(mark({ condition: "i > 3", log: "x", hits: "7" }))).toBe(
      "prints · conditional · after 7",
    );
  });
});
