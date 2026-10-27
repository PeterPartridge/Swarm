import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiSettings from "../../components/ai/AiSettings";
import type { AiProvider } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listAiProviders: vi.fn(),
    addOllamaProvider: vi.fn(),
    addOllamaCloudProvider: vi.fn(),
    addClaudeCodeProvider: vi.fn(),
    addAiProvider: vi.fn(),
    removeAiProvider: vi.fn(),
    testAiProvider: vi.fn(),
    getClaudeTiers: vi.fn(),
    setClaudeTiers: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const provider: AiProvider = {
  id: 1,
  name: "Claude",
  apiBaseUrl: "https://api.anthropic.com",
  models: ["claude-opus-4-8"],
  keyStored: true,
  kind: "anthropic",
  metered: true,
};

/** The forms are split by provider family now, so a test reaches the one it
 *  wants the way a person does. Claude is the default. */
async function openFamily(
  user: ReturnType<typeof userEvent.setup>,
  name: "Claude" | "Ollama",
) {
  await user.click(await screen.findByRole("tab", { name }));
}

describe("AiSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listAiProviders.mockResolvedValue([provider]);
    // The Complexity setting now sits at the top of the Claude tab; left
    // unmocked it falls through to the real invoke and renders an error alert
    // that collides with the alerts these tests assert on.
    mocked.getClaudeTiers.mockResolvedValue([
      { model: "claude-sonnet-5", effort: "low" },
      { model: "claude-sonnet-5", effort: "medium" },
      { model: "claude-fable-5", effort: "high" },
    ]);
    mocked.setClaudeTiers.mockResolvedValue(undefined);
  });

  it("shows providers with key stored state, never the key value", async () => {
    render(<AiSettings />);
    expect(await screen.findByText(/key: stored/)).toBeInTheDocument();
    expect(screen.queryByText(/sk-/)).not.toBeInTheDocument();
  });

  it("adds a provider and clears the key field afterwards", async () => {
    const user = userEvent.setup();
    mocked.addAiProvider.mockResolvedValue(2);
    render(<AiSettings />);

    const keyInput = await screen.findByLabelText("API key");
    await user.type(keyInput, "sk-test-key");
    await user.click(screen.getByRole("button", { name: "Add provider" }));

    await waitFor(() =>
      expect(mocked.addAiProvider).toHaveBeenCalledWith({
        name: "Claude",
        apiBaseUrl: "https://api.anthropic.com",
        apiKey: "sk-test-key",
      }),
    );
    expect((keyInput as HTMLInputElement).value).toBe("");
  });

  it("adds a local Ollama provider without asking for a key", async () => {
    const user = userEvent.setup();
    mocked.addOllamaProvider.mockResolvedValue(2);
    render(<AiSettings />);
    await openFamily(user, "Ollama");

    await user.click(await screen.findByRole("button", { name: "Add Ollama" }));

    await waitFor(() =>
      expect(mocked.addOllamaProvider).toHaveBeenCalledWith(
        "Ollama (local)",
        "http://localhost:11434",
      ),
    );
  });

  it("shows whether a provider costs money, since that drives handover", async () => {
    mocked.listAiProviders.mockResolvedValue([
      provider,
      {
        id: 2,
        name: "Ollama (local)",
        apiBaseUrl: "http://localhost:11434",
        models: ["llama3"],
        keyStored: false,
        kind: "ollama",
        metered: false,
      },
    ]);
    render(<AiSettings />);

    expect(await screen.findByText(/\(metered\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(free\)/)).toBeInTheDocument();
    expect(screen.getByText(/local, no key/)).toBeInTheDocument();
  });

  /// A hosted Ollama is somebody else's hardware being paid for. Calling it
  /// free because its local sibling is free would let a Product spend past its
  /// budget on the very provider chosen because the budget ran out.
  it("keeps a hosted Ollama key and clears the field, and calls it metered", async () => {
    const user = userEvent.setup();
    mocked.addOllamaCloudProvider.mockResolvedValue(3);
    render(<AiSettings />);
    await openFamily(user, "Ollama");

    const keyField = await screen.findByLabelText("Hosted Ollama API key");
    await user.type(keyField, "ollama-secret");
    await user.click(screen.getByRole("button", { name: "Add hosted Ollama" }));

    await waitFor(() =>
      expect(mocked.addOllamaCloudProvider).toHaveBeenCalledWith(
        "Ollama Cloud",
        "https://ollama.com",
        "ollama-secret",
      ),
    );
    // The key goes to the credential store and leaves the form.
    expect((keyField as HTMLInputElement).value).toBe("");
  });

  /// The two Ollamas share a provider kind, so the list has to tell them apart
  /// by the same signal the backend authenticates on — whether a key is stored.
  it("tells a hosted Ollama from a local one in the list", async () => {
    mocked.listAiProviders.mockResolvedValue([
      {
        id: 2,
        name: "Ollama Cloud",
        apiBaseUrl: "https://ollama.com",
        models: ["gpt-oss:120b"],
        keyStored: true,
        kind: "ollama",
        metered: true,
      },
    ]);
    render(<AiSettings />);

    expect(await screen.findByText(/hosted, key stored/)).toBeInTheDocument();
    expect(screen.getByText(/\(metered\)/)).toBeInTheDocument();
    expect(screen.queryByText(/local, no key/)).not.toBeInTheDocument();
  });

  /// Claude Code is neither metered nor free: the plan is paid for, the
  /// allowance is finite, and this app cannot see what a call consumed. Saying
  /// "free" would be a lie; inventing a number would be worse.
  it("says a Claude Code provider's cost is not visible rather than free", async () => {
    mocked.listAiProviders.mockResolvedValue([
      {
        id: 4,
        name: "Claude Code (my plan)",
        apiBaseUrl: "",
        models: ["claude-opus-5"],
        keyStored: false,
        kind: "claudeCode",
        metered: false,
      },
    ]);
    render(<AiSettings />);

    expect(
      await screen.findByText(/on your plan — cost not visible here/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\(free\)/)).not.toBeInTheDocument();
    expect(screen.getByText(/signed in through the CLI, no key/)).toBeInTheDocument();
  });

  it("test connection surfaces the result", async () => {
    const user = userEvent.setup();
    mocked.testAiProvider.mockResolvedValue("Connection OK (claude-opus-4-8)");
    render(<AiSettings />);

    await user.click(await screen.findByRole("button", { name: "Test Claude" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Connection OK");
  });

  it("removes a provider", async () => {
    const user = userEvent.setup();
    mocked.removeAiProvider.mockResolvedValue();
    render(<AiSettings />);

    await user.click(
      await screen.findByRole("button", { name: "Remove provider Claude" }),
    );
    await waitFor(() => expect(mocked.removeAiProvider).toHaveBeenCalledWith(1));
  });
});
