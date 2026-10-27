import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClaudeSetup from "../../components/ai/ClaudeSetup";
import type { AiProvider } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listAiProviders: vi.fn(),
    claudeCodeStatus: vi.fn(),
    openClaudeSignIn: vi.fn(),
    installClaudeCode: vi.fn(),
    addClaudeCodeProvider: vi.fn(),
    getProductBudget: vi.fn(),
    setProductBudget: vi.fn(),
    getPaidApiAllowed: vi.fn(),
    setPaidApiAllowed: vi.fn(),
    getClaudeTiers: vi.fn(),
    setClaudeTiers: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const cliProvider: AiProvider = {
  id: 7,
  name: "Claude Code (my plan)",
  apiBaseUrl: "",
  models: ["claude-opus-5"],
  keyStored: false,
  kind: "claudeCode",
  metered: false,
};

const apiProvider: AiProvider = {
  id: 3,
  name: "Claude",
  apiBaseUrl: "https://api.anthropic.com",
  models: ["claude-opus-5"],
  keyStored: true,
  kind: "anthropic",
  metered: true,
};

const budget = (chain: number[]) => ({
  productId: 1,
  totalBudgetMicropence: 0,
  aiBudgetMicropence: 0,
  tokenLimit: 0,
  warnPct: 75,
  handoverPct: 90,
  hardStopPct: 100,
  periodDays: 30,
  providerChain: chain,
});

describe("ClaudeSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // AiSettings lives inside this panel's Advanced fold and brings the
    // Complexity setting with it; unmocked it renders a second alert.
    mocked.getClaudeTiers.mockResolvedValue([
      { model: "claude-sonnet-5", effort: "low" },
      { model: "claude-sonnet-5", effort: "medium" },
      { model: "claude-fable-5", effort: "high" },
    ]);
    mocked.setClaudeTiers.mockResolvedValue(undefined);
    mocked.listAiProviders.mockResolvedValue([]);
    mocked.getProductBudget.mockResolvedValue(budget([]));
    // Off is the shipped default; the tests that need the API turn it on.
    mocked.getPaidApiAllowed.mockResolvedValue(false);
    mocked.setPaidApiAllowed.mockResolvedValue(undefined);
    mocked.claudeCodeStatus.mockResolvedValue({
      installed: false,
      version: "",
      path: "",
      problem: "claude native binary not installed",
      signedIn: false,
      authMethod: "",
    });
  });

  /// The distinction the panel exists for. Somebody who reads only one sentence
  /// has to come away knowing a plan does not pay for API credits.
  it("says a plan and API credits are different purchases", async () => {
    const user = userEvent.setup();
    mocked.getPaidApiAllowed.mockResolvedValue(true);
    render(<ClaudeSetup productId={1} />);

    expect(await screen.findByText(/Your plan pays for Claude Code/)).toBeInTheDocument();

    await screen.findByRole("option", { name: "API credits" });
    await user.selectOptions(screen.getByLabelText("How you pay for Claude"), "api");
    expect(
      await screen.findByText(/A Claude plan does not pay for these/),
    ).toBeInTheDocument();
  });

  /// **The ask.** One press runs the setup rather than printing instructions:
  /// install, add the provider, put it first — in that order, because a provider
  /// added before the tool exists would be one that cannot work.
  it("installs, adds the provider and puts it first, on one press", async () => {
    const user = userEvent.setup();
    mocked.installClaudeCode.mockResolvedValue("added 1 package");
    mocked.claudeCodeStatus
      .mockResolvedValueOnce({ installed: false, version: "", path: "", problem: "not installed", signedIn: false, authMethod: "" })
      .mockResolvedValue({ installed: true, version: "2.1.0", path: "", problem: "", signedIn: true, authMethod: "claudeai" });
    mocked.addClaudeCodeProvider.mockResolvedValue(7);
    mocked.setProductBudget.mockResolvedValue(undefined);

    render(<ClaudeSetup productId={1} />);
    await user.click(await screen.findByLabelText("Set up Claude with my plan"));

    await waitFor(() => expect(mocked.installClaudeCode).toHaveBeenCalled());
    await waitFor(() => expect(mocked.addClaudeCodeProvider).toHaveBeenCalled());
    // First in the chain, not merely in it: anything after the first is only
    // reached once a budget runs down.
    await waitFor(() =>
      expect(mocked.setProductBudget).toHaveBeenCalledWith(
        expect.objectContaining({ providerChain: [7] }),
      ),
    );
  });

  /// **"I have it installed" — and they did.** The Claude desktop app keeps its
  /// own copy under %APPDATA% and never puts it on PATH, so a machine with a
  /// perfectly good Claude Code was being told it had none. Detection finds it,
  /// and says *which* copy, because there is usually more than one and they do
  /// not all work.
  it("reports an install found off the PATH, and names it", async () => {
    mocked.claudeCodeStatus.mockResolvedValue({
      installed: true,
      version: "2.1.219 (Claude Code)",
      path: "C:\\Users\\me\\AppData\\Roaming\\Claude\\claude-code\\2.1.219\\claude.exe",
      problem: "",
      signedIn: true,
      authMethod: "claudeai",
    });
    render(<ClaudeSetup productId={1} />);

    expect(
      await screen.findByText(/Claude Code is installed — 2\.1\.219/),
    ).toBeInTheDocument();
    expect(screen.getByText(/claude-code\\2\.1\.219\\claude\.exe/)).toBeInTheDocument();
    // And it does not offer to install what is already there.
    expect(mocked.installClaudeCode).not.toHaveBeenCalled();
  });

  /// Already installed means don't install again — pressing after a partial
  /// failure resumes rather than starting over.
  it("skips the install when the tool is already there", async () => {
    const user = userEvent.setup();
    mocked.claudeCodeStatus.mockResolvedValue({
      installed: true,
      version: "2.1.0",
      path: "",
      problem: "",
      signedIn: true,
      authMethod: "claudeai",
    });
    mocked.addClaudeCodeProvider.mockResolvedValue(7);
    mocked.setProductBudget.mockResolvedValue(undefined);

    render(<ClaudeSetup productId={1} />);
    await user.click(await screen.findByLabelText("Set up Claude with my plan"));

    await waitFor(() => expect(mocked.addClaudeCodeProvider).toHaveBeenCalled());
    expect(mocked.installClaudeCode).not.toHaveBeenCalled();
  });

  /// The button has to say what it is doing: a cold npm install runs for
  /// minutes, and a frozen "Set up" reads as a hang.
  it("names the stage it is on while it works", async () => {
    const user = userEvent.setup();
    let finishInstall: (out: string) => void = () => {};
    mocked.installClaudeCode.mockReturnValue(
      new Promise<string>((resolve) => {
        finishInstall = resolve;
      }),
    );

    render(<ClaudeSetup productId={1} />);
    await user.click(await screen.findByLabelText("Set up Claude with my plan"));

    const button = screen.getByLabelText("Set up Claude with my plan");
    await waitFor(() => expect(button).toHaveTextContent("Installing Claude Code…"));
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    // Let it finish inside the test rather than after it, so the state updates
    // it causes are ones React was watching for.
    await act(async () => {
      finishInstall("done");
    });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy", "true"));
  });

  /// npm exiting 0 while the tool still will not run is the exact state this
  /// machine was in. Adding a provider on top of that would produce something
  /// that fails later, for a reason nothing connects back to here.
  it("stops when npm succeeds but the tool still will not run", async () => {
    const user = userEvent.setup();
    mocked.installClaudeCode.mockResolvedValue("added 1 package");
    mocked.claudeCodeStatus.mockResolvedValue({
      installed: false,
      version: "",
      path: "",
      problem: "claude native binary not installed",
      signedIn: false,
      authMethod: "",
    });

    render(<ClaudeSetup productId={1} />);
    await user.click(await screen.findByLabelText("Set up Claude with my plan"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/native binary not installed/);
    expect(mocked.addClaudeCodeProvider).not.toHaveBeenCalled();
  });

  /// **This test used to assert the opposite**, and was right to at the time:
  /// the panel said signing in could not be checked because proving it would
  /// spend plan allowance on every page load. That turned out to be wrong —
  /// `claude auth status` answers directly, runs no model and comes back in
  /// about a second — and until it was asked, an expired session was
  /// indistinguishable from a working provider.
  it("claims the sign-in only when it has actually been checked", async () => {
    mocked.claudeCodeStatus.mockResolvedValue({
      installed: true,
      version: "2.1.0",
      path: "",
      problem: "",
      signedIn: true,
      authMethod: "claudeai",
    });
    mocked.listAiProviders.mockResolvedValue([cliProvider]);
    mocked.getProductBudget.mockResolvedValue(budget([7]));

    render(<ClaudeSetup productId={1} />);

    expect(await screen.findByText(/Claude Code is installed — 2\.1\.0/)).toBeInTheDocument();
    expect(screen.getByText(/asks it before anything else/)).toBeInTheDocument();
    // Said, because it was asked — and it names how, since a subscription and
    // an API key are different things to be signed in with.
    expect(screen.getByText(/Signed in — claudeai/)).toBeInTheDocument();
    // Nothing left to press once it really is ready.
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });


  /// The API route cannot be started without a key, and the panel says where to
  /// put one rather than offering a button that would fail.
  it("will not run the API route until a key is stored", async () => {
    const user = userEvent.setup();
    mocked.getPaidApiAllowed.mockResolvedValue(true);
    render(<ClaudeSetup productId={1} />);

    await screen.findByRole("option", { name: "API credits" });
    await user.selectOptions(screen.getByLabelText("How you pay for Claude"), "api");
    expect(
      await screen.findByLabelText("Use the API for this Product"),
    ).toBeDisabled();
    expect(
      screen.getByText(/Add the provider and its key first/),
    ).toBeInTheDocument();
  });

  /// With a key stored the app can do its one API step: the ordering.
  it("puts an existing API provider first", async () => {
    const user = userEvent.setup();
    mocked.listAiProviders.mockResolvedValue([apiProvider]);
    mocked.setProductBudget.mockResolvedValue(undefined);
    mocked.getPaidApiAllowed.mockResolvedValue(true);

    render(<ClaudeSetup productId={1} />);
    await screen.findByRole("option", { name: "API credits" });
    await user.selectOptions(screen.getByLabelText("How you pay for Claude"), "api");
    await user.click(await screen.findByLabelText("Use the API for this Product"));

    await waitFor(() =>
      expect(mocked.setProductBudget).toHaveBeenCalledWith(
        expect.objectContaining({ providerChain: [3] }),
      ),
    );
  });

  /// Putting one first must not drop the others — they are the handover chain
  /// for when the budget runs down.
  it("keeps the rest of the chain behind the new first", async () => {
    const user = userEvent.setup();
    mocked.listAiProviders.mockResolvedValue([apiProvider]);
    mocked.getProductBudget.mockResolvedValue(budget([9, 3, 11]));
    mocked.setProductBudget.mockResolvedValue(undefined);
    mocked.getPaidApiAllowed.mockResolvedValue(true);

    render(<ClaudeSetup productId={1} />);
    await screen.findByRole("option", { name: "API credits" });
    await user.selectOptions(screen.getByLabelText("How you pay for Claude"), "api");
    await user.click(await screen.findByLabelText("Use the API for this Product"));

    await waitFor(() =>
      expect(mocked.setProductBudget).toHaveBeenCalledWith(
        expect.objectContaining({ providerChain: [3, 9, 11] }),
      ),
    );
  });
});

describe("the paid-calls switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // AiSettings lives inside this panel's Advanced fold and brings the
    // Complexity setting with it; unmocked it renders a second alert.
    mocked.getClaudeTiers.mockResolvedValue([
      { model: "claude-sonnet-5", effort: "low" },
      { model: "claude-sonnet-5", effort: "medium" },
      { model: "claude-fable-5", effort: "high" },
    ]);
    mocked.setClaudeTiers.mockResolvedValue(undefined);
    mocked.listAiProviders.mockResolvedValue([]);
    mocked.getProductBudget.mockResolvedValue(budget([]));
    mocked.setPaidApiAllowed.mockResolvedValue(undefined);
    mocked.claudeCodeStatus.mockResolvedValue({
      installed: true,
      version: "2.1.219",
      path: "C:/claude.exe",
      problem: "",
      signedIn: true,
      authMethod: "claudeai",
    });
  });

  /// **Off by default.** A plan and API credits are separate purchases, and
  /// somebody with the plan alone has no use for a metered provider — every
  /// call it makes fails, and every prompt to set one up is noise. A fresh
  /// install also cannot spend before anyone has agreed it may.
  it("is off to begin with, and the API route is not even offered", async () => {
    mocked.getPaidApiAllowed.mockResolvedValue(false);
    render(<ClaudeSetup productId={1} />);

    expect(await screen.findByLabelText("Allow calls that cost money")).not.toBeChecked();
    expect(screen.queryByRole("option", { name: "API credits" })).not.toBeInTheDocument();
    expect(screen.getByText(/nothing that charges will be called/)).toBeInTheDocument();
  });

  /// Turning it on saves the setting — the router reads that, so the control
  /// has to actually write it rather than only re-rendering.
  it("saves the setting when switched on", async () => {
    const user = userEvent.setup();
    mocked.getPaidApiAllowed.mockResolvedValue(false);
    render(<ClaudeSetup productId={1} />);

    await user.click(await screen.findByLabelText("Allow calls that cost money"));
    await waitFor(() => expect(mocked.setPaidApiAllowed).toHaveBeenCalledWith(true));
    expect(await screen.findByRole("option", { name: "API credits" })).toBeInTheDocument();
  });

  /// A save that fails must not leave the control claiming something untrue —
  /// the switch says what the setting *is*, and the router obeys the setting.
  it("puts itself back if the setting will not save", async () => {
    const user = userEvent.setup();
    mocked.getPaidApiAllowed.mockResolvedValue(false);
    mocked.setPaidApiAllowed.mockRejectedValue("the database is read-only");
    render(<ClaudeSetup productId={1} />);

    const toggle = await screen.findByLabelText("Allow calls that cost money");
    await user.click(toggle);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/read-only/));
    expect(toggle).not.toBeChecked();
  });

  /// **Installed is not signed in**, and treating them as one answer is why an
  /// expired session looked like a healthy provider right up until the first
  /// real turn failed.
  it("says when Claude Code is installed but signed out, and offers to fix it", async () => {
    mocked.claudeCodeStatus.mockResolvedValue({
      installed: true,
      version: "2.1.227 (Claude Code)",
      path: "C:/claude.exe",
      problem: "",
      signedIn: false,
      authMethod: "none",
    });
    render(<ClaudeSetup productId={1} />);

    expect(
      await screen.findByText(/Installed, but not signed in/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  /// **The sign-in happens here, not somewhere else.** It used to open a
  /// terminal on the Build board and tell you to go and finish it there —
  /// sending somebody to a different page to complete what they started on this
  /// one is the kind of seam that makes a button feel broken.
  ///
  /// It has to be a real terminal rather than a pane of output: run without
  /// one, `claude auth login --claudeai` prints its URL and then waits at
  /// "Paste code here if prompted", so somewhere to type is part of the job.
  it("starts the sign-in in a terminal on this page", async () => {
    const user = userEvent.setup();
    mocked.claudeCodeStatus.mockResolvedValue({
      installed: true,
      version: "2.1.227 (Claude Code)",
      path: "C:/claude.exe",
      problem: "",
      signedIn: false,
      authMethod: "none",
    });
    mocked.openClaudeSignIn.mockResolvedValue({ id: "term-0-1", cwd: "C:/Users/someone" });
    render(<ClaudeSetup productId={1} />);

    await user.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(mocked.openClaudeSignIn).toHaveBeenCalled();
    // A terminal on this page, adopting the shell that was just started.
    expect(await screen.findByLabelText("Terminal")).toBeInTheDocument();
    // And it says the browser is the next step, plus what to do if it does not
    // open — the login prints a link precisely because it sometimes does not.
    expect(screen.getByText(/browser should open/)).toBeInTheDocument();
    expect(screen.getByText(/prints a link/)).toBeInTheDocument();
    // Nothing sends anybody to another page any more.
    expect(screen.queryByText(/Build board/)).not.toBeInTheDocument();
  });

  /// Nothing is shown until it has been asked for: a terminal sitting on the
  /// setup page before anybody pressed Sign in would be furniture.
  it("shows no terminal until the sign-in is started", async () => {
    mocked.claudeCodeStatus.mockResolvedValue({
      installed: true,
      version: "2.1.227 (Claude Code)",
      path: "C:/claude.exe",
      problem: "",
      signedIn: false,
      authMethod: "none",
    });
    render(<ClaudeSetup productId={1} />);

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.queryByLabelText("Terminal")).not.toBeInTheDocument();
  });

  /// Nothing to sign in with yet — a button that could only fail is worse than
  /// one that is plainly not ready.
  it("cannot sign in before Claude Code is installed", async () => {
    mocked.claudeCodeStatus.mockResolvedValue({
      installed: false,
      version: "",
      path: "",
      problem: "not found",
      signedIn: false,
      authMethod: "",
    });
    render(<ClaudeSetup productId={1} />);

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeDisabled();
  });
});
