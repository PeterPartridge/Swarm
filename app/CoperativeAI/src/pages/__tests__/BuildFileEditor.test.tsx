import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BuildFileEditor from "../../components/code/BuildFileEditor";
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
    ...over,
  }) as Solution;

describe("BuildFileEditor breakpoint conditions", () => {
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

  /// **The mismatch this closes.** The Debuggers panel already reported that
  /// the adapters support conditional breakpoints, and there was nowhere to set
  /// one — a capability shown and not offered.
  it("gives each breakpoint in the file a condition, and stores it", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "coperativeai.breakpoints",
      JSON.stringify({ "5": { "main.go": [{ line: 8, condition: "" }] } }),
    );
    render(<BuildFileEditor solution={sol()} path="main.go" onClose={() => {}} />);
    await waitFor(() => expect(mocked.readSolutionFile).toHaveBeenCalled());

    const box = screen.getByLabelText("Condition for line 8");
    // The empty state says what happens rather than leaving it to be guessed.
    expect(box).toHaveAttribute("placeholder", "stop every time");

    await user.type(box, "i == 7");

    expect(marksIn(loadBreakpoints(), 5, "main.go")).toEqual([
      { line: 8, condition: "i == 7", log: "" },
    ]);
  });

  /// **The feature that removes a rebuild.** A message on the line prints and
  /// carries on instead of stopping — the `println` you would otherwise add.
  it("takes a message that prints instead of stopping, and stores it", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "coperativeai.breakpoints",
      JSON.stringify({ "5": { "main.go": [{ line: 8, condition: "", log: "" }] } }),
    );
    render(<BuildFileEditor solution={sol()} path="main.go" onClose={() => {}} />);
    await waitFor(() => expect(mocked.readSolutionFile).toHaveBeenCalled());

    const box = screen.getByLabelText("Message for line 8");
    expect(box).toHaveAttribute("placeholder", "print instead of stopping");

    // `{{` is userEvent's escape for a literal brace — the typed text is
    // `round {i}`, which is the interpolation the adapter evaluates.
    await user.type(box, "round {{i}");

    expect(marksIn(loadBreakpoints(), 5, "main.go")).toEqual([
      { line: 8, condition: "", log: "round {i}" },
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
            { line: 8, condition: "", log: "" },
            { line: 12, condition: "", log: "round {i}" },
          ],
        },
      }),
    );
    render(<BuildFileEditor solution={sol()} path="main.go" onClose={() => {}} />);
    await waitFor(() => expect(mocked.readSolutionFile).toHaveBeenCalled());

    const strip = screen.getByLabelText("Breakpoints in main.go");
    expect(within(strip).getAllByText("logs")).toHaveLength(1);
    // And the condition box changes what it promises, since the line no longer
    // stops at all.
    expect(screen.getByLabelText("Condition for line 12")).toHaveAttribute(
      "placeholder",
      "log every time",
    );
  });

  /// The adapter evaluates the expression inside the running program, so it is
  /// the program's language — not JavaScript, and not something this app parses.
  it("says which language the condition is written in", async () => {
    localStorage.setItem(
      "coperativeai.breakpoints",
      JSON.stringify({ "5": { "main.go": [{ line: 8, condition: "" }] } }),
    );
    render(<BuildFileEditor solution={sol()} path="main.go" onClose={() => {}} />);
    await waitFor(() => expect(mocked.readSolutionFile).toHaveBeenCalled());

    expect(screen.getByText(/Go \(go mod\)/)).toBeInTheDocument();
    expect(screen.getByText(/evaluated by the debugger, in the running program/)).toBeInTheDocument();
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

    expect(screen.getByLabelText("Condition for line 8")).toBeInTheDocument();
    expect(screen.queryByLabelText("Condition for line 44")).not.toBeInTheDocument();
  });
});
