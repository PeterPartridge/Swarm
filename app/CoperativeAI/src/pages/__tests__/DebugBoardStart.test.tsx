import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DebugBoard from "../../components/code/DebugBoard";
import type { Solution } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listTerminals: vi.fn(),
    suggestDevCommand: vi.fn(),
    debugStart: vi.fn(),
    debugStop: vi.fn(),
    debugCheck: vi.fn(),
    debugAdapters: vi.fn(),
  };
});

// A real PTY and xterm.js are not what this file is about — what is, is which
// Solutions get a debugger and which only get a command typed at them.
vi.mock("../../components/code/TerminalPanel", () => ({
  default: ({
    pendingCommand,
    solution,
  }: {
    pendingCommand: string | null;
    solution?: Solution | null;
  }) => (
    <div data-testid={`terminal-${solution?.id}`} data-command={pendingCommand ?? ""} />
  ),
}));
vi.mock("../../components/code/DevServerPanel", () => ({ default: () => null }));
vi.mock("../../components/code/DebugAdapters", () => ({ default: () => null }));

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const sol = (id: number, name: string, language: string | null): Solution => ({
  id,
  name,
  productId: 1,
  solutionType: "api",
  answers: "{}",
  origin: "created",
  githubUrl: null,
  githubVisibility: null,
  localPath: `C:/repos/${name}`,
  testCommand: null,
  language,
  runCommand: null,
  startFrom: null,
  kindLocations: "{}",
});

/// Go launches under Delve; Ruby has no launch shape in this app.
const go = sol(3, "Orders", "Go (go mod)");
const ruby = sol(4, "Legacy", "Ruby");

const started = {
  session: "dap-1",
  language: "go",
  conditions: true,
  logPoints: true,
  hitCounts: true,
  restartFrame: true,
  hovers: true,
  setVariable: true,
  setExpression: false,
  note: "",
  breakpoints: [],
};

/** The adapter list as `debug_adapters` returns it — each entry the result of
 *  actually running the candidate, not of finding a filename. */
const adapter = (language: string, available: boolean) => ({
  language,
  label: language === "go" ? "Go (Delve)" : language,
  adapter: "dlv",
  transport: "stdio" as const,
  available,
  program: "dlv",
  argv: ["dlv"],
  version: available ? "1.22.0" : "",
  problem: available ? "" : "dlv is not on PATH.",
  install: "go install github.com/go-delve/delve/cmd/dlv@latest",
});

describe("DebugBoard — what a Debug press starts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocked.listTerminals.mockResolvedValue([]);
    mocked.debugStart.mockResolvedValue(started);
    mocked.debugStop.mockResolvedValue(undefined);
    mocked.debugAdapters.mockResolvedValue([adapter("go", true)] as never);
    mocked.suggestDevCommand.mockResolvedValue({
      start: "go run .",
      watch: "",
      watchReady: false,
      watchNeeds: "",
      foundBy: "go.mod",
      custom: false,
      unavailable: "",
    } as never);
  });

  /// **The double-start this avoids.** A debug adapter starts the program
  /// itself — Delve launches the binary — so typing `go run .` into a shell as
  /// well would start a second copy, and two processes fighting over one port
  /// look exactly like a broken debugger.
  it("launches under the debugger and does not also run it in a shell", async () => {
    render(
      <DebugBoard
        solutions={[go]}
        run={{ solutionIds: [3], how: "debug", at: 1700 }}
      />,
    );

    // The Solution goes with it, so the backend can honour its "start from"
    // against the working copy as it is now rather than a path resolved here.
    await waitFor(() =>
      expect(mocked.debugStart).toHaveBeenCalledWith("go", "C:/repos/Orders", [], 3),
    );
    expect(screen.getByTestId("terminal-3")).toHaveAttribute("data-command", "");
  });

  /// A language with no launch shape still gets started — as a plain run — and
  /// is named, because a Solution that quietly got a run when you pressed Debug
  /// leaves you wondering why the breakpoints never hit.
  it("falls back to a shell run where there is no debugger, and says which", async () => {
    render(
      <DebugBoard
        solutions={[go, ruby]}
        run={{ solutionIds: [3, 4], how: "debug", at: 1700 }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("terminal-4")).toHaveAttribute("data-command", "go run ."),
    );
    // the one that can be debugged was not also run
    expect(screen.getByTestId("terminal-3")).toHaveAttribute("data-command", "");

    const said = await screen.findByRole("status");
    expect(said).toHaveTextContent("Started in a shell rather than under a debugger");
    expect(said).toHaveTextContent("Legacy");
    expect(said).not.toHaveTextContent("Orders");
  });

  /// **Checked before the press, not discovered by it.** An adapter that is
  /// not on this machine used to be found out by starting a session and reading
  /// a DAP failure. The answer is one command, and this already knows it.
  it("does not start a debugger whose adapter is not installed", async () => {
    mocked.debugAdapters.mockResolvedValue([adapter("go", false)] as never);
    render(
      <DebugBoard solutions={[go]} run={{ solutionIds: [3], how: "debug", at: 1700 }} />,
    );

    // Started, so the app is at least up — and said, with the command.
    await waitFor(() =>
      expect(screen.getByTestId("terminal-3")).toHaveAttribute("data-command", "go run ."),
    );
    expect(mocked.debugStart).not.toHaveBeenCalled();

    // Said twice, and deliberately: the board reports what the press did, and
    // the Solution's own panel explains why its Debug button is dead. Both
    // carry the command, because either is where somebody might be looking.
    const said = await screen.findAllByText(/Go \(Delve\) is not installed/);
    expect(said.length).toBeGreaterThan(0);
    for (const one of said) {
      expect(one).toHaveTextContent("go install github.com/go-delve/delve/cmd/dlv@latest");
    }
    // The board's line names which Solution it was.
    expect(said.some((one) => one.textContent?.includes("Orders"))).toBe(true);
  });

  /// The Solution's own Debug button is refused too, rather than offering a
  /// press that can only fail.
  it("refuses the per-Solution Debug button when the adapter is missing", async () => {
    mocked.debugAdapters.mockResolvedValue([adapter("go", false)] as never);
    render(<DebugBoard solutions={[go]} />);

    await waitFor(() => expect(screen.getByLabelText("Debug Orders")).toBeDisabled());
  });

  /// **A list that could not be read is not proof of absence.** Refusing on
  /// "nobody knows" would silently downgrade a Debug press to a run on the
  /// strength of a question that never got answered — worse than the DAP
  /// failure this check exists to avoid, because at least that one speaks.
  it("still tries when it could not find out what is installed", async () => {
    mocked.debugAdapters.mockRejectedValue("could not look");
    render(
      <DebugBoard solutions={[go]} run={{ solutionIds: [3], how: "debug", at: 1700 }} />,
    );

    await waitFor(() => expect(mocked.debugStart).toHaveBeenCalled());
    expect(screen.getByTestId("terminal-3")).toHaveAttribute("data-command", "");
  });

  /// Run means run. Pressing it must not start a debugger nobody asked for.
  it("does not attach a debugger for a plain Run", async () => {
    render(
      <DebugBoard solutions={[go]} run={{ solutionIds: [3], how: "run", at: 1700 }} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("terminal-3")).toHaveAttribute("data-command", "go run ."),
    );
    expect(mocked.debugStart).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
