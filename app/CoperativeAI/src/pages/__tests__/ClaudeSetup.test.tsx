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
    installClaudeCode: vi.fn(),
    addClaudeCodeProvider: vi.fn(),
    getProductBudget: vi.fn(),
    setProductBudget: vi.fn(),
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
    mocked.listAiProviders.mockResolvedValue([]);
    mocked.getProductBudget.mockResolvedValue(budget([]));
    mocked.claudeCodeStatus.mockResolvedValue({
      installed: false,
      version: "",
      problem: "claude native binary not installed",
    });
  });

  /// The distinction the panel exists for. Somebody who reads only one sentence
  /// has to come away knowing a plan does not pay for API credits.
  it("says a plan and API credits are different purchases", async () => {
    const user = userEvent.setup();
    render(<ClaudeSetup productId={1} />);

    expect(await screen.findByText(/Your plan pays for Claude Code/)).toBeInTheDocument();

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
      .mockResolvedValueOnce({ installed: false, version: "", problem: "not installed" })
      .mockResolvedValue({ installed: true, version: "2.1.0", problem: "" });
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

  /// Already installed means don't install again — pressing after a partial
  /// failure resumes rather than starting over.
  it("skips the install when the tool is already there", async () => {
    const user = userEvent.setup();
    mocked.claudeCodeStatus.mockResolvedValue({
      installed: true,
      version: "2.1.0",
      problem: "",
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
      problem: "claude native binary not installed",
    });

    render(<ClaudeSetup productId={1} />);
    await user.click(await screen.findByLabelText("Set up Claude with my plan"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/native binary not installed/);
    expect(mocked.addClaudeCodeProvider).not.toHaveBeenCalled();
  });

  /// Signing in is never claimed as done, and the reason it is not checked is
  /// stated — a tick that quietly meant "probably" is the one that wastes an
  /// afternoon.
  it("never claims the sign-in, and says why it cannot", async () => {
    mocked.claudeCodeStatus.mockResolvedValue({
      installed: true,
      version: "2.1.0",
      problem: "",
    });
    mocked.listAiProviders.mockResolvedValue([cliProvider]);
    mocked.getProductBudget.mockResolvedValue(budget([7]));

    render(<ClaudeSetup productId={1} />);

    // Everything the app can do is done…
    expect(await screen.findByText(/Claude Code is installed — 2\.1\.0/)).toBeInTheDocument();
    expect(screen.getByText(/asks it before anything else/)).toBeInTheDocument();
    // …and the one thing it cannot is still marked as yours, with the reason.
    expect(screen.getByText(/Signing in is yours to do/)).toBeInTheDocument();
    expect(screen.getByText(/spending your allowance/)).toBeInTheDocument();
  });

  /// The API route cannot be started without a key, and the panel says where to
  /// put one rather than offering a button that would fail.
  it("will not run the API route until a key is stored", async () => {
    const user = userEvent.setup();
    render(<ClaudeSetup productId={1} />);

    await user.selectOptions(screen.getByLabelText("How you pay for Claude"), "api");
    expect(
      await screen.findByLabelText("Use the API for this Product"),
    ).toBeDisabled();
    expect(screen.getByText(/Develop → Settings → AI Settings/)).toBeInTheDocument();
  });

  /// With a key stored the app can do its one API step: the ordering.
  it("puts an existing API provider first", async () => {
    const user = userEvent.setup();
    mocked.listAiProviders.mockResolvedValue([apiProvider]);
    mocked.setProductBudget.mockResolvedValue(undefined);

    render(<ClaudeSetup productId={1} />);
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

    render(<ClaudeSetup productId={1} />);
    await user.selectOptions(screen.getByLabelText("How you pay for Claude"), "api");
    await user.click(await screen.findByLabelText("Use the API for this Product"));

    await waitFor(() =>
      expect(mocked.setProductBudget).toHaveBeenCalledWith(
        expect.objectContaining({ providerChain: [3, 9, 11] }),
      ),
    );
  });
});
