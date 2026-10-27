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
  { model: "claude-fable-5", effort: "xhigh" },
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
    expect(screen.getByLabelText("high complexity effort")).toHaveValue("xhigh");
    // The three that were briefly complexities are gone from here; they are
    // effort levels, and live in the effort dropdown above.
    expect(screen.queryByLabelText("ultra complexity model")).toBeNull();
  });

  /// **The levels above "high" have to be reachable.** They are the reason
  /// this list was wrong before: a setting that stops at high cannot ask for
  /// the two levels every model here supports.
  it("offers xhigh and max as efforts", async () => {
    render(<ClaudeTiers />);

    const effort = await screen.findByLabelText("high complexity effort");
    const offered = Array.from(effort.querySelectorAll("option")).map((o) => o.value);
    expect(offered).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  /// Haiku takes no effort parameter at all, so offering one would be a
  /// setting that does nothing — and it sits on the cheapest row by default.
  it("says so when the chosen model has no effort setting", async () => {
    mocked.getClaudeTiers.mockResolvedValue([
      { model: "claude-haiku-4-5", effort: "low" },
      { model: "claude-sonnet-5", effort: "medium" },
      { model: "claude-fable-5", effort: "xhigh" },
    ]);
    render(<ClaudeTiers />);

    expect(await screen.findByText(/no effort setting/i)).toBeInTheDocument();
    expect(screen.getByLabelText("low complexity effort")).toBeDisabled();
    // …and only that row: the others still choose.
    expect(screen.getByLabelText("high complexity effort")).toBeEnabled();
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
        ...tiers.slice(1),
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
        tiers[0],
        { model: "claude-sonnet-5", effort: "high" },
        ...tiers.slice(2),
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

  /// **The ceiling that Extra/Max/Ultra were meant to lift was on effort.**
  /// They were briefly complexity rows, which was a misreading — those are
  /// Claude's own effort levels. Raising the effort on the High row is the
  /// thing they were reaching for, and this is it working.
  it("reaches above high by raising the effort, not by adding a row", async () => {
    const user = userEvent.setup();
    render(<ClaudeTiers />);

    await user.selectOptions(
      await screen.findByLabelText("high complexity effort"),
      "max",
    );
    await waitFor(() =>
      expect(mocked.setClaudeTiers).toHaveBeenCalledWith([
        ...tiers.slice(0, 2),
        { model: "claude-fable-5", effort: "max" },
      ]),
    );
  });
});
