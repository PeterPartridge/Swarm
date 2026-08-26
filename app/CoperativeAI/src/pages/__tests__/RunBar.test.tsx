import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RunBar, { type RunRequest } from "../../components/code/RunBar";
import type { DevCommand, Solution } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    suggestDevCommand: vi.fn(),
    setSolutionRunCommand: vi.fn(),
    debugAdapters: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const sol = (id: number, name: string, over: Partial<Solution> = {}): Solution => ({
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
  language: null,
  runCommand: null,
  startFrom: null,
  ...over,
});

const dev = (over: Partial<DevCommand> = {}): DevCommand =>
  ({
    start: "npm run dev",
    watch: "",
    watchReady: false,
    watchNeeds: "",
    foundBy: "package.json",
    custom: false,
    unavailable: "",
    ...over,
  }) as DevCommand;

const web = sol(3, "Shop Web");
const api = sol(4, "Shop API");

describe("RunBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.suggestDevCommand.mockResolvedValue(dev());
    mocked.setSolutionRunCommand.mockResolvedValue(undefined);
    mocked.debugAdapters.mockResolvedValue([]);
  });

  /// Defaulting to the Solution you are on is right nearly always, and wrong
  /// exactly when it matters — so it is a default, not a rule.
  it("starts on the Solution being browsed", async () => {
    render(<RunBar solutions={[web, api]} browsing={3} onRun={() => {}} />);
    expect(await screen.findByLabelText("Choose what to run")).toHaveTextContent("Shop Web");
  });

  /// The front end you are reading is not the API you need up to read it.
  it("runs any number of Solutions, including ones you are not on", async () => {
    const user = userEvent.setup();
    const asked: RunRequest[] = [];
    render(<RunBar solutions={[web, api]} browsing={3} onRun={(r) => asked.push(r)} />);

    await user.click(await screen.findByLabelText("Choose what to run"));
    await user.click(screen.getByLabelText("Run Shop API"));
    // and drop the one it defaulted to, so what runs is neither of the obvious
    // answers a fixed rule would have given
    await user.click(screen.getByLabelText("Run Shop Web"));
    await user.click(screen.getByLabelText("Run the picked Solutions"));

    expect(asked).toHaveLength(1);
    expect(asked[0].solutionIds).toEqual([4]);
    expect(asked[0].how).toBe("run");
  });

  /// A press elsewhere — the Debug button — asks this picker to start what it
  /// holds, rather than a second place working out the same answer. It asks for
  /// a debug, which is not the same request as a run.
  it("asks for a debug when the bar asks it to start", async () => {
    const asked: RunRequest[] = [];
    const { rerender } = render(
      <RunBar solutions={[web, api]} browsing={3} onRun={(r) => asked.push(r)} />,
    );
    await screen.findByLabelText("Choose what to run");

    rerender(
      <RunBar
        solutions={[web, api]}
        browsing={3}
        startNow={1700}
        onRun={(r) => asked.push(r)}
      />,
    );

    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0].solutionIds).toEqual([3]);
    expect(asked[0].how).toBe("debug");
  });

  /// **Everything picked, not only what has a run command.** A Solution
  /// launched under its debugger does not need one, so filtering by it would
  /// drop exactly the Solutions Debug is for.
  it("sends a Solution with no run command to be debugged anyway", async () => {
    const asked: RunRequest[] = [];
    mocked.suggestDevCommand.mockResolvedValue(
      dev({ start: "", unavailable: "nothing detected in that folder" }),
    );
    const { rerender } = render(
      <RunBar solutions={[web]} browsing={3} onRun={(r) => asked.push(r)} />,
    );
    // Run is off, because there is nothing to type into a shell…
    await waitFor(() =>
      expect(screen.getByLabelText("Run the picked Solutions")).toBeDisabled(),
    );

    // …and Debug still reaches it.
    rerender(
      <RunBar solutions={[web]} browsing={3} startNow={1700} onRun={(r) => asked.push(r)} />,
    );
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0].solutionIds).toEqual([3]);
  });

  /// A front end's Run already reloads itself, so a Hot reload button for it
  /// would do the same thing under a name promising something different.
  it("only offers hot reload where there is a watcher", async () => {
    const user = userEvent.setup();
    mocked.suggestDevCommand.mockImplementation(async (id: number) =>
      id === 4 ? dev({ start: "cargo run", watch: "cargo watch -x run" }) : dev(),
    );
    const asked: RunRequest[] = [];
    render(<RunBar solutions={[web, api]} browsing={3} onRun={(r) => asked.push(r)} />);

    // browsing the website, which has no watcher
    await waitFor(() =>
      expect(screen.getByLabelText("Hot reload the picked Solutions")).toBeDisabled(),
    );

    await user.click(screen.getByLabelText("Choose what to run"));
    await user.click(screen.getByLabelText("Run Shop API"));
    await user.click(screen.getByLabelText("Hot reload the picked Solutions"));

    // only the one with a watcher, not both that were ticked
    expect(asked[0].solutionIds).toEqual([4]);
    expect(asked[0].how).toBe("watch");
  });

  /// Detection gets it right for a repository laid out the usual way and cannot
  /// for anything else. The escape hatch used to be a form on another panel.
  it("changes a Solution's command from the same dropdown", async () => {
    const user = userEvent.setup();
    render(<RunBar solutions={[web]} browsing={3} onRun={() => {}} />);

    await user.click(await screen.findByLabelText("Choose what to run"));
    await user.selectOptions(screen.getByLabelText("Command for Shop Web"), "edit");
    // It opens on what was detected rather than blank — the common edit is a
    // tweak to that, not a command typed from nothing.
    const box = screen.getByLabelText("Run command for Shop Web");
    expect(box).toHaveValue("npm run dev");
    await user.clear(box);
    await user.type(box, "pnpm dev");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocked.setSolutionRunCommand).toHaveBeenCalledWith(3, "pnpm dev"),
    );
  });

  /// **Before the press, not by it.** Finding out that Delve is not installed
  /// by pressing Debug and reading a DAP failure is the worst version of this:
  /// the answer is one command, and it can be shown now.
  it("says per Solution what Debug will actually do, and how to fix it", async () => {
    const user = userEvent.setup();
    const go = sol(3, "Orders", { language: "Go (go mod)" });
    const ruby = sol(4, "Legacy", { language: "Ruby" });
    mocked.debugAdapters.mockResolvedValue([
      {
        language: "go",
        label: "Go (Delve)",
        adapter: "dlv",
        transport: "stdio",
        available: false,
        program: "dlv",
        argv: ["dlv"],
        version: "",
        problem: "dlv is not on PATH.",
        install: "go install github.com/go-delve/delve/cmd/dlv@latest",
      },
    ] as never);
    render(<RunBar solutions={[go, ruby]} browsing={3} onRun={() => {}} />);

    await user.click(await screen.findByLabelText("Choose what to run"));

    expect(
      await screen.findByText("Go (Delve) not installed — runs in a shell"),
    ).toBeInTheDocument();
    // a different reason, kept apart because this one is not fixable by a command
    expect(
      screen.getByText("no debugger for its language — runs in a shell"),
    ).toBeInTheDocument();
    // the command itself, copyable rather than only in a tooltip
    expect(
      screen.getByText("go install github.com/go-delve/delve/cmd/dlv@latest"),
    ).toBeInTheDocument();
  });

  it("says which debugger will be used when there is one", async () => {
    const user = userEvent.setup();
    const go = sol(3, "Orders", { language: "Go (go mod)" });
    mocked.debugAdapters.mockResolvedValue([
      {
        language: "go",
        label: "Go (Delve)",
        adapter: "dlv",
        transport: "stdio",
        available: true,
        program: "dlv",
        argv: ["dlv"],
        version: "1.22.0",
        problem: "",
        install: "go install github.com/go-delve/delve/cmd/dlv@latest",
      },
    ] as never);
    render(<RunBar solutions={[go]} browsing={3} onRun={() => {}} />);

    await user.click(await screen.findByLabelText("Choose what to run"));
    expect(await screen.findByText("debugs with Go (Delve)")).toBeInTheDocument();
    expect(
      screen.queryByText(/go install github.com\/go-delve/),
    ).not.toBeInTheDocument();
  });

  /// A Solution with no working copy is listed and cannot be ticked. Leaving it
  /// out entirely invites "where has it gone?"; saying why answers it.
  it("lists a Solution with nowhere to run and says why it cannot", async () => {
    const nowhere = sol(9, "Docs", { localPath: null });
    render(<RunBar solutions={[web, nowhere]} browsing={3} onRun={() => {}} />);

    await userEvent.setup().click(await screen.findByLabelText("Choose what to run"));
    expect(screen.getByLabelText("Run Docs")).toBeDisabled();
    expect(screen.getByText(/no working copy here/)).toBeInTheDocument();
  });
});
