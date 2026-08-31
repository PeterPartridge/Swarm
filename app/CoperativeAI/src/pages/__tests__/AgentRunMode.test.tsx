import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AgentRunMode from "../../components/ai/AgentRunMode";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    agentRunModes: vi.fn(),
    getAgentRunMode: vi.fn(),
    setAgentRunMode: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const modes: [string, string][] = [
  ["ask", "Ask before everything (Claude Code's default)"],
  ["acceptEdits", "Write files without asking; stop for anything else"],
  ["never", "Never ask — the agent runs unattended"],
];

describe("how agents run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.agentRunModes.mockResolvedValue(modes);
    mocked.getAgentRunMode.mockResolvedValue("acceptEdits");
    mocked.setAgentRunMode.mockResolvedValue(undefined);
  });

  /// **The default is the one that stops the prompts without handing over the
  /// machine.** Writing files inside the checkout a run was made for is the one
  /// thing the agent was sent there to do.
  it("opens on writing without asking", async () => {
    render(<AgentRunMode />);
    expect(
      await screen.findByRole("radio", { name: /Write files without asking/ }),
    ).toBeChecked();
  });

  it("records the choice", async () => {
    render(<AgentRunMode />);
    await userEvent.click(
      await screen.findByRole("radio", { name: /Ask before everything/ }),
    );
    await waitFor(() => expect(mocked.setAgentRunMode).toHaveBeenCalledWith("ask"));
  });

  /// **Said where the choice is made.** This is the one option that can do
  /// something nobody watched happen, so it says what it turns on rather than
  /// leaving that to a doc.
  it("says what unattended means, when unattended is chosen", async () => {
    render(<AgentRunMode />);
    await userEvent.click(await screen.findByRole("radio", { name: /Never ask/ }));
    expect(
      await screen.findByText(/no prompt before anything they do/i),
    ).toBeInTheDocument();
  });
});
