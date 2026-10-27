import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiRouting from "../../components/ai/AiRouting";
import * as backend from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    getAiRouting: vi.fn(),
    setAreaProvider: vi.fn(),
    clearAreaProvider: vi.fn(),
  };
});

const mocked = vi.mocked(backend);

/** Every cell always comes back, set or not — the panel must not have to
 *  invent the shape of the grid. */
function grid(overrides: Partial<backend.AreaProvider>[] = []) {
  const cells: backend.AreaProvider[] = [];
  for (const area of ["product", "develop", "test"]) {
    for (const slot of ["main", "secondary"]) {
      const found = overrides.find((o) => o.area === area && o.slot === slot);
      cells.push({
        area,
        slot,
        platform: "none",
        providerId: null,
        providerName: "",
        apiBaseUrl: "",
        metered: false,
        models: [],
        ...found,
      });
    }
  }
  return cells;
}

describe("AiRouting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getAiRouting.mockResolvedValue(grid());
  });

  /** **Secondary assumes nothing**, and the page says what that means rather
   *  than showing an empty box that reads like a broken setting. */
  it("says a Secondary is absent and what that costs, without implying it is missing", async () => {
    render(<AiRouting productId={4} />);
    await waitFor(() => expect(mocked.getAiRouting).toHaveBeenCalledWith(4));

    await userEvent.click(screen.getByRole("tab", { name: /Secondary AI/ }));

    expect(screen.getByText(/No Secondary for this area/)).toBeInTheDocument();
    expect(screen.getByText(/Reviews will not happen for it/)).toBeInTheDocument();
  });

  /** **Three platform options, because "Ollama" is two decisions.** Collapsing
   *  local and hosted into one would hide the only difference that matters. */
  it("separates a local Ollama from the hosted one, and says which costs money", async () => {
    render(<AiRouting productId={4} />);
    await waitFor(() => expect(mocked.getAiRouting).toHaveBeenCalled());

    await userEvent.selectOptions(screen.getByLabelText("Platform"), "ollamaCloud");
    expect(screen.getByText(/It is metered/)).toBeInTheDocument();
    expect(screen.getByLabelText("API key")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Platform"), "ollamaLocal");
    expect(screen.getByText(/no key, no cost/)).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).toBeNull();
  });

  /** Claude Code is the signed-in plan — asking for a URL or a key would be
   *  asking for something that does not exist. */
  it("asks for nothing when the platform is Claude Code", async () => {
    render(<AiRouting productId={4} />);
    await waitFor(() => expect(mocked.getAiRouting).toHaveBeenCalled());

    await userEvent.selectOptions(screen.getByLabelText("Platform"), "claudeCode");
    expect(screen.queryByLabelText("Address")).toBeNull();
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect(screen.getByText(/Nothing to fill in/)).toBeInTheDocument();
  });

  /** The cell being saved is the tab being looked at — a panel that wrote to
   *  the wrong slot would silently replace the provider doing the work. */
  it("saves against the area and slot on screen", async () => {
    mocked.setAreaProvider.mockResolvedValue(7);
    render(<AiRouting productId={4} />);
    await waitFor(() => expect(mocked.getAiRouting).toHaveBeenCalled());

    await userEvent.click(screen.getByRole("tab", { name: /Secondary AI/ }));
    await userEvent.click(screen.getByRole("tab", { name: /QA/ }));
    await userEvent.selectOptions(screen.getByLabelText("Platform"), "ollamaLocal");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocked.setAreaProvider).toHaveBeenCalledWith(
        4,
        "test",
        "secondary",
        "ollamaLocal",
        "http://localhost:11434",
        "",
      ),
    );
  });

  /** **The refusal is the useful part.** The address and key are checked
   *  against the real server before anything is stored. */
  it("shows why a platform could not be saved", async () => {
    mocked.setAreaProvider.mockRejectedValue(
      "http://localhost:11434 answered but offered no models — pull one first",
    );
    render(<AiRouting productId={4} />);
    await waitFor(() => expect(mocked.getAiRouting).toHaveBeenCalled());

    await userEvent.selectOptions(screen.getByLabelText("Platform"), "ollamaLocal");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("offered no models");
  });

  /** Clearing is offered only where there is something to clear, so the button
   *  is never a no-op somebody presses twice wondering what happened. */
  it("offers clearing only for a cell that is set", async () => {
    mocked.getAiRouting.mockResolvedValue(
      grid([
        {
          area: "develop",
          slot: "main",
          platform: "ollamaLocal",
          providerId: 3,
          providerName: "Ollama (local)",
          apiBaseUrl: "http://localhost:11434",
          models: ["kimi-k2"],
        },
      ]),
    );
    mocked.clearAreaProvider.mockResolvedValue(undefined);

    render(<AiRouting productId={4} />);
    await waitFor(() => expect(mocked.getAiRouting).toHaveBeenCalled());

    // Develop/Main is set, so it can be cleared and says what it is.
    expect(await screen.findByText(/Ollama \(local\)/)).toBeInTheDocument();
    expect(screen.getByText(/not metered/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear this one" }));
    await waitFor(() =>
      expect(mocked.clearAreaProvider).toHaveBeenCalledWith(4, "develop", "main"),
    );

    // Product/Main is not, so there is nothing to clear.
    await userEvent.click(screen.getByRole("tab", { name: /Product/ }));
    expect(screen.queryByRole("button", { name: "Clear this one" })).toBeNull();
  });

  /** Switching tabs must show what is actually stored, not whatever was last
   *  typed against a different cell. */
  it("follows the cell being looked at rather than keeping the last form", async () => {
    mocked.getAiRouting.mockResolvedValue(
      grid([
        {
          area: "develop",
          slot: "main",
          platform: "ollamaCloud",
          providerId: 9,
          providerName: "Ollama Cloud",
          apiBaseUrl: "https://ollama.com",
          metered: true,
          models: ["kimi-k2"],
        },
      ]),
    );
    render(<AiRouting productId={4} />);

    // Waited on the value, not on the call: the fetch resolving is not the
    // form having caught up with it.
    await waitFor(() =>
      expect(screen.getByLabelText("Platform")).toHaveValue("ollamaCloud"),
    );
    await userEvent.click(screen.getByRole("tab", { name: /Product/ }));
    expect(screen.getByLabelText("Platform")).toHaveValue("none");
  });

  /** Routing is per Product, so with none chosen the panel says so rather than
   *  showing a grid that would write nowhere. */
  it("asks for a Product before offering anything", async () => {
    render(<AiRouting productId={null} />);
    expect(screen.getByText(/Choose a Product above/)).toBeInTheDocument();
    expect(mocked.getAiRouting).not.toHaveBeenCalled();
  });
});
