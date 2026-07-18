import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiSettings from "../../components/AiSettings";
import type { AiProvider } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listAiProviders: vi.fn(),
    addAiProvider: vi.fn(),
    removeAiProvider: vi.fn(),
    testAiProvider: vi.fn(),
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
};

describe("AiSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listAiProviders.mockResolvedValue([provider]);
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
        // cheapest first — the effort tier indexes into this order
        models: ["claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-4-8"],
        apiKey: "sk-test-key",
      }),
    );
    expect((keyInput as HTMLInputElement).value).toBe("");
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
