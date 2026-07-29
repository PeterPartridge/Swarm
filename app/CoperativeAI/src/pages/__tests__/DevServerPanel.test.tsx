import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DevServerPanel from "../../components/code/DevServerPanel";
import type { DevCommand, Solution } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    suggestDevCommand: vi.fn(),
    setSolutionRunCommand: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const solution = (over: Partial<Solution> = {}): Solution => ({
  id: 3,
  name: "Shop API",
  productId: 1,
  solutionType: "api",
  answers: "{}",
  origin: "created",
  githubUrl: null,
  githubVisibility: null,
  localPath: "C:/repos/shop-api",
  testCommand: null,
  language: null,
  runCommand: null,
  ...over,
});

const dev = (over: Partial<DevCommand> = {}): DevCommand => ({
  kind: "vite",
  start: "npm run dev",
  watch: "",
  watchNeeds: "",
  foundBy: "package.json",
  custom: false,
  watchReady: true,
  unavailable: null,
  ...over,
});

describe("DevServerPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /// A front end reloads itself, so Run is the whole story — no watcher button.
  it("offers Run for a front end and no hot-refresh button", async () => {
    mocked.suggestDevCommand.mockResolvedValue(dev());
    render(<DevServerPanel solution={solution()} terminalReady onRunInTerminal={() => {}} />);

    expect(await screen.findByText("npm run dev")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hot refresh" })).not.toBeInTheDocument();
  });

  /// A compiled backend does not reload, so it gets the watcher button too.
  it("offers hot refresh for a backend that does not reload itself", async () => {
    mocked.suggestDevCommand.mockResolvedValue(
      dev({ kind: "cargo", start: "cargo run", watch: "cargo watch -x run", foundBy: "Cargo.toml" }),
    );
    render(<DevServerPanel solution={solution()} terminalReady onRunInTerminal={() => {}} />);

    expect(await screen.findByText("cargo run")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hot refresh" })).toBeInTheDocument();
  });

  /// The debt this closes: Hot refresh used to be offered whether or not the
  /// watcher existed, so pressing it produced a "command not found" nobody had
  /// been warned about. The check happens before the press now.
  it("refuses hot refresh when its tool is not installed, and says which", async () => {
    mocked.suggestDevCommand.mockResolvedValue(
      dev({
        kind: "cargo",
        start: "cargo run",
        watch: "cargo watch -x run",
        watchNeeds: "cargo-watch (cargo install cargo-watch)",
        watchReady: false,
        foundBy: "Cargo.toml",
      }),
    );
    render(<DevServerPanel solution={solution()} terminalReady onRunInTerminal={() => {}} />);

    expect(await screen.findByRole("button", { name: "Hot refresh" })).toBeDisabled();
    expect(screen.getByText(/cargo-watch.*is not installed/)).toBeInTheDocument();
    // …and Run is untouched, because it does not need the watcher.
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  /// Run hands the start command to the terminal below.
  it("sends the start command to the terminal", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    mocked.suggestDevCommand.mockResolvedValue(dev());
    render(<DevServerPanel solution={solution()} terminalReady onRunInTerminal={onRun} />);

    await user.click(await screen.findByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledWith("npm run dev");
  });

  /// With no shell open, Run is disabled and says why.
  it("disables Run until a terminal is open", async () => {
    mocked.suggestDevCommand.mockResolvedValue(dev());
    render(
      <DevServerPanel solution={solution()} terminalReady={false} onRunInTerminal={() => {}} />,
    );
    expect(await screen.findByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByText(/Open the terminal below first/)).toBeInTheDocument();
  });

  /// Nothing recognisable to run points at the override rather than dead-ending.
  it("offers to set a command when detection finds nothing", async () => {
    mocked.suggestDevCommand.mockResolvedValue(
      dev({ kind: "custom", start: "", foundBy: "", unavailable: "nothing recognisable to run" }),
    );
    render(<DevServerPanel solution={solution()} terminalReady onRunInTerminal={() => {}} />);

    expect(await screen.findByText(/nothing recognisable to run/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set a run command" })).toBeInTheDocument();
  });

  /// The override is saved for the Solution and detection re-reads it.
  it("saves a run command override", async () => {
    const user = userEvent.setup();
    mocked.suggestDevCommand
      .mockResolvedValueOnce(dev({ kind: "custom", start: "", unavailable: "nothing recognisable" }))
      .mockResolvedValueOnce(dev({ kind: "custom", start: "make serve", custom: true, foundBy: "" }));
    mocked.setSolutionRunCommand.mockResolvedValue();
    render(<DevServerPanel solution={solution()} terminalReady onRunInTerminal={() => {}} />);

    await user.click(await screen.findByRole("button", { name: "Set a run command" }));
    await user.type(screen.getByRole("textbox", { name: "Run command" }), "make serve");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocked.setSolutionRunCommand).toHaveBeenCalledWith(3, "make serve"));
    expect(await screen.findByText("make serve")).toBeInTheDocument();
  });
});
