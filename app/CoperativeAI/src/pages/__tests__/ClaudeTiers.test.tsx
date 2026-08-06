import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClaudeTiers from "../../components/ai/ClaudeTiers";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return { ...original, getClaudeTiers: vi.fn(), setClaudeTiers: vi.fn() };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const tiers = [
  { model: "claude-sonnet-5", effort: "low" },
  { model: "claude-sonnet-5", effort: "medium" },
  { model: "claude-fable-5", effort: "high" },
];

describe("ClaudeTiers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getClaudeTiers.mockResolvedValue(tiers);
    mocked.setClaudeTiers.mockResolvedValue(undefined);
  });

  /// **Two choices per complexity, because they are two decisions.** Model and
  /// effort used to be one word, which meant "high" picked the last model in a
  /// list and nothing else — with no way to say "use the big model but do not
  /// labour over it".
  it("offers a model and an effort for each complexity", async () => {
    render(<ClaudeTiers />);

    for (const level of ["low", "medium", "high"]) {
      expect(await screen.findByLabelText(`${level} complexity model`)).toBeInTheDocument();
      expect(screen.getByLabelText(`${level} complexity effort`)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("high complexity model")).toHaveValue("claude-fable-5");
    expect(screen.getByLabelText("high complexity effort")).toHaveValue("high");
  });

  /// Saves on change: there is nothing to batch, and a page that silently
  /// discarded a choice because a button was missed would be worse.
  it("saves a changed model without a Save button", async () => {
    const user = userEvent.setup();
    render(<ClaudeTiers />);

    await user.selectOptions(
      await screen.findByLabelText("low complexity model"),
      "claude-haiku-4-5",
    );

    await waitFor(() =>
      expect(mocked.setClaudeTiers).toHaveBeenCalledWith([
        { model: "claude-haiku-4-5", effort: "low" },
        { model: "claude-sonnet-5", effort: "medium" },
        { model: "claude-fable-5", effort: "high" },
      ]),
    );
  });

  /// The effort is the half that was missing. Changing it must not disturb the
  /// model beside it.
  it("saves a changed effort and leaves the model alone", async () => {
    const user = userEvent.setup();
    render(<ClaudeTiers />);

    await user.selectOptions(
      await screen.findByLabelText("medium complexity effort"),
      "high",
    );

    await waitFor(() =>
      expect(mocked.setClaudeTiers).toHaveBeenCalledWith([
        { model: "claude-sonnet-5", effort: "low" },
        { model: "claude-sonnet-5", effort: "high" },
        { model: "claude-fable-5", effort: "high" },
      ]),
    );
  });

  /// A model stored before the list was updated shows as typed rather than
  /// snapping to a default — that would change behaviour just by opening the
  /// page.
  it("shows an unknown model as typed", async () => {
    mocked.getClaudeTiers.mockResolvedValue([
      { model: "claude-from-the-future", effort: "low" },
      ...tiers.slice(1),
    ]);
    render(<ClaudeTiers />);

    expect(await screen.findByLabelText("low complexity model")).toHaveValue(
      "claude-from-the-future",
    );
  });

  /// A refused save must not leave a choice on screen that was not kept.
  it("puts the setting back if it will not save", async () => {
    const user = userEvent.setup();
    mocked.setClaudeTiers.mockRejectedValue("the database is read-only");
    render(<ClaudeTiers />);

    await user.selectOptions(
      await screen.findByLabelText("low complexity model"),
      "claude-haiku-4-5",
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/read-only/);
    await waitFor(() =>
      expect(screen.getByLabelText("low complexity model")).toHaveValue("claude-sonnet-5"),
    );
  });
});
