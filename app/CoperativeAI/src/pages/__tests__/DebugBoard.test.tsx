import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DebugBoard, { uptime } from "../../components/code/DebugBoard";
import type { Solution } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    // The run panel inside each attached process reads this. Left unmocked it
    // falls through to the real invoke and the panel renders its error state
    // while the assertions below still pass.
    suggestDevCommand: vi.fn(),
    setSolutionRunCommand: vi.fn(),
    openTerminal: vi.fn(),
    closeTerminal: vi.fn(),
    // The board asks the registry what is already running. Left unmocked this
    // falls through to the real invoke, the board swallows it by design, and
    // the reattach half of these tests would never run.
    listTerminals: vi.fn(),
    attachTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    // The debuggers panel searches for adapters on mount.
    debugAdapters: vi.fn(),
    debugCheck: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const sol = (id: number, name: string, over: Partial<Solution> = {}): Solution =>
  ({
    id,
    name,
    productId: 1,
    solutionType: "api",
    answers: "{}",
    origin: "created",
    githubUrl: null,
    githubVisibility: null,
    localPath: "C:/repos/" + name.toLowerCase(),
    testCommand: null,
    language: null,
    runCommand: null,
    ...over,
  }) as Solution;

describe("DebugBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listTerminals.mockResolvedValue([]);
    mocked.debugAdapters.mockResolvedValue([]);
    mocked.suggestDevCommand.mockResolvedValue({
      kind: "npm",
      start: "npm run dev",
      watch: "",
      watchNeeds: "",
      watchReady: false,
      watchBin: "",
      foundBy: "package.json",
      custom: false,
      unavailable: "",
    } as never);
  });

  /// The thing the Code tab's single terminal could never do: every Solution
  /// listed, so several can be up at once.
  it("lists every Solution, running none of them until asked", () => {
    render(<DebugBoard solutions={[sol(1, "Web"), sol(2, "API")]} />);

    expect(screen.getByRole("region", { name: "Process for Web" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Process for API" })).toBeInTheDocument();
    expect(screen.getByText("0 of 2 running")).toBeInTheDocument();
    // A shell is a real child process, so none is opened just by looking.
    expect(mocked.openTerminal).not.toHaveBeenCalled();
    expect(screen.getAllByText("not started")).toHaveLength(2);
  });

  /// Attaching is the deliberate press: it mounts the run command and a real
  /// shell for that Solution, and detaching takes them away again.
  it("attaches a run command and a shell on request, and detaches them", async () => {
    const user = userEvent.setup();
    render(<DebugBoard solutions={[sol(1, "Web")]} />);

    const card = screen.getByRole("region", { name: "Process for Web" });
    expect(within(card).queryByRole("region", { name: "Terminal" })).not.toBeInTheDocument();

    await user.click(within(card).getByLabelText("Attach a shell to Web"));
    expect(await within(card).findByRole("region", { name: "Run" })).toBeInTheDocument();
    expect(within(card).getByRole("region", { name: "Terminal" })).toBeInTheDocument();
    expect(await within(card).findByText("npm run dev")).toBeInTheDocument();

    await user.click(within(card).getByLabelText("Detach Web"));
    expect(within(card).queryByRole("region", { name: "Terminal" })).not.toBeInTheDocument();
  });

  /// A Solution with no working copy has nowhere to run, and the card says which
  /// rather than offering a button that would fail.
  it("will not attach to a Solution with no working copy, and says why", () => {
    render(<DebugBoard solutions={[sol(1, "Web", { localPath: null })]} />);

    const card = screen.getByRole("region", { name: "Process for Web" });
    expect(within(card).getByLabelText("Attach a shell to Web")).toBeDisabled();
    expect(card).toHaveTextContent(/No working copy on this machine/);
    expect(screen.getByText("no folder")).toBeInTheDocument();
    // It cannot run, so it is not counted among the things that could.
    expect(screen.getByText("0 of 0 running")).toBeInTheDocument();
  });

  /// **The honesty rule, in Debug — now that there really is an adapter layer.**
  /// The protocol client and the adapter search are built; stepping is not. So
  /// the stepping controls stay away rather than appearing ahead of the thing
  /// that would make them work, and the panel says as much.
  it("offers no stepping controls until they can be honoured, and says so", () => {
    render(<DebugBoard solutions={[sol(1, "Web")]} />);

    const board = screen.getByRole("region", { name: "Debug" });
    expect(board).toHaveTextContent(/stays unclickable until/);
    expect(board).toHaveTextContent(/reads no CPU or memory/);

    // Asserting on the controls rather than the words, because the panel has to
    // be free to name the things it is disclaiming.
    for (const control of [/step/i, /continue/i, /pause/i, /breakpoint/i]) {
      expect(within(board).queryByRole("button", { name: control })).not.toBeInTheDocument();
    }
    // No invented process figures.
    expect(board.textContent).not.toMatch(/\d+\s*% cpu/i);
    expect(board.textContent).not.toMatch(/\d+\s*MB/);
  });

  /// An adapter that is missing has to say why **and** how to get it — "not
  /// available" alone sends somebody hunting through their own PATH.
  it("names a missing debugger's problem and the command that installs it", async () => {
    mocked.debugAdapters.mockResolvedValue([
      {
        language: "go", label: "Go", adapter: "Delve", transport: "tcp",
        available: true, program: "C:/go/bin/dlv.exe dap", argv: [], version: "Delve 1.25.2",
        problem: "", install: "go install github.com/go-delve/delve/cmd/dlv@latest",
      },
      {
        language: "python", label: "Python", adapter: "debugpy", transport: "stdio",
        available: false, program: "", argv: [], version: "",
        problem: "the `python` on PATH is often the Microsoft Store stub, which cannot run.",
        install: "pip install debugpy",
      },
    ]);
    render(<DebugBoard solutions={[sol(1, "Web")]} />);

    const panel = await screen.findByRole("region", { name: "Debuggers" });
    expect(await within(panel).findByText("1 of 2 installed")).toBeInTheDocument();
    expect(panel).toHaveTextContent(/Microsoft Store stub/);
    expect(panel).toHaveTextContent("pip install debugpy");
    // Checking means talking to it, so it is offered only where there is
    // something to talk to.
    expect(within(panel).getByLabelText("Check the Go debugger")).toBeEnabled();
    expect(within(panel).getByLabelText("Check the Python debugger")).toBeDisabled();
  });

  /// Finding a binary that runs is not the same as finding one that speaks the
  /// protocol, and the breakpoint UI will rest on the second claim.
  it("proves an adapter speaks DAP rather than inferring it from a filename", async () => {
    const user = userEvent.setup();
    mocked.debugAdapters.mockResolvedValue([
      {
        language: "go", label: "Go", adapter: "Delve", transport: "tcp",
        available: true, program: "dlv dap", argv: ["dlv", "dap"], version: "Delve 1.25.2",
        problem: "", install: "go install …",
      },
    ]);
    mocked.debugCheck.mockResolvedValue({
      language: "go",
      speaksDap: true,
      configurationDone: true,
      conditionalBreakpoints: true,
      functionBreakpoints: true,
      problem: "",
      reported: "{}",
    });
    render(<DebugBoard solutions={[sol(1, "Web")]} />);

    const panel = await screen.findByRole("region", { name: "Debuggers" });
    await user.click(within(panel).getByLabelText("Check the Go debugger"));

    expect(mocked.debugCheck).toHaveBeenCalledWith("go");
    expect(await within(panel).findByText(/Speaks DAP/)).toBeInTheDocument();
    expect(panel).toHaveTextContent(/can carry conditions/);
  });

  /// The port is a guess from the run command, and is labelled as one — a URL
  /// presented as fact sends somebody hunting a bug in their server when the
  /// guess was simply wrong.
  it("labels the likely port as a guess, from the run command", async () => {
    render(<DebugBoard solutions={[sol(1, "Web")]} />);

    const card = screen.getByRole("region", { name: "Process for Web" });
    // `npm run dev` is Vite's default in the shared table.
    expect(await within(card).findByText("probably :5173")).toBeInTheDocument();
    expect(within(card).getByText("probably :5173")).toHaveAttribute(
      "title",
      "Guessed from the run command",
    );
  });

  /// Restart beats Detach-and-Attach because closing the shell loses the
  /// scrollback, which is usually what you wanted to read before restarting.
  /// It is offered only once there is something to restart.
  it("offers Restart only once a shell is actually open", async () => {
    const user = userEvent.setup();
    render(<DebugBoard solutions={[sol(1, "Web")]} />);

    const card = screen.getByRole("region", { name: "Process for Web" });
    await user.click(within(card).getByLabelText("Attach a shell to Web"));
    await within(card).findByRole("region", { name: "Run" });

    // The terminal cannot open in jsdom (xterm needs a real canvas), so it never
    // reports itself open — and Restart stays away rather than pretending.
    expect(within(card).queryByLabelText("Restart Web")).not.toBeInTheDocument();
  });

  /// **The process registry, from the front.** A shell that was left running is
  /// picked up rather than started again — and rather than being killed, which
  /// is what used to happen every time this board unmounted.
  it("picks up a shell that was already running, without opening a new one", async () => {
    mocked.listTerminals.mockResolvedValue([
      {
        id: "term-1-1700",
        solutionId: 1,
        shell: "powershell.exe",
        cwd: "C:/repos/web",
        startedAt: 1_700_000_000_000,
      },
    ]);
    mocked.attachTerminal.mockResolvedValue({
      id: "term-1-1700",
      solutionId: 1,
      shell: "powershell.exe",
      cwd: "C:/repos/web",
      startedAt: 1_700_000_000_000,
      replay: "vite ready in 412ms",
    });
    render(<DebugBoard solutions={[sol(1, "Web"), sol(2, "API")]} />);

    // Attached on arrival, because it is this board's own process from before.
    const card = await screen.findByRole("region", { name: "Process for Web" });
    expect(await within(card).findByRole("region", { name: "Terminal" })).toBeInTheDocument();
    expect(within(card).getByLabelText("Detach Web")).toBeInTheDocument();

    // The one that was not running is left alone.
    const other = screen.getByRole("region", { name: "Process for API" });
    expect(within(other).queryByRole("region", { name: "Terminal" })).not.toBeInTheDocument();

    // Nothing new was started for a shell that never stopped.
    expect(mocked.openTerminal).not.toHaveBeenCalled();
  });

  /// Leaving the board must not take the dev servers with it — that was the
  /// debt this registry paid off.
  it("leaves running shells alive when the board goes away", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DebugBoard solutions={[sol(1, "Web")]} />);

    await user.click(screen.getByLabelText("Attach a shell to Web"));
    await screen.findByRole("region", { name: "Terminal" });
    unmount();

    expect(mocked.closeTerminal).not.toHaveBeenCalled();
  });

  /// Solutions that cannot run at all should not bury the ones that can.
  it("hides the Solutions with no working copy on request", async () => {
    const user = userEvent.setup();
    render(
      <DebugBoard
        solutions={[sol(1, "Web"), sol(2, "Legacy", { localPath: null })]}
      />,
    );

    expect(screen.getByRole("region", { name: "Process for Legacy" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide the 1 with no working copy" }));
    expect(screen.queryByRole("region", { name: "Process for Legacy" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Process for Web" })).toBeInTheDocument();
  });
});

/// Timed from when this window opened the shell — the only start the app can
/// honestly claim to know.
describe("uptime", () => {
  const t0 = 1_700_000_000_000;

  it("counts in the coarsest unit that still says something", () => {
    expect(uptime(t0, t0 + 4_000)).toBe("4s");
    expect(uptime(t0, t0 + 65_000)).toBe("1m 5s");
    expect(uptime(t0, t0 + 3_900_000)).toBe("1h 5m");
  });

  /// A clock that went backwards must not read as a negative age.
  it("never goes negative", () => {
    expect(uptime(t0, t0 - 5_000)).toBe("0s");
  });
});
