import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ModelTierPicker from "../../components/ai/ModelTierPicker";
import { modelsForTiers, tiersFromModels } from "../../lib/models";

const value = {
  low: "claude-sonnet-5",
  medium: "claude-sonnet-5",
  high: "claude-fable-5",
};

describe("modelsForTiers / tiersFromModels", () => {
  /// The order *is* the contract: `ai::tiering` reads the first for low, the
  /// middle for medium and the last for high. Getting it wrong sends
  /// architecture work to the cheapest model and never says so.
  it("stores one model per tier, in the order the router reads", () => {
    expect(modelsForTiers("a", "b", "c")).toEqual(["a", "b", "c"]);
  });

  it("reads the tiers back the way the router would", () => {
    expect(tiersFromModels(["a", "b", "c"])).toEqual({
      low: "a",
      medium: "b",
      high: "c",
    });
  });

  /// A provider saved before this UI existed may hold any number of models. One
  /// entry means that model does every tier — the same rule the Rust side uses,
  /// so the two cannot disagree about what an old row means.
  it("handles lists that are not three long", () => {
    expect(tiersFromModels(["only"])).toEqual({
      low: "only",
      medium: "only",
      high: "only",
    });
    expect(tiersFromModels([])).toEqual({ low: "", medium: "", high: "" });
  });
});

describe("ModelTierPicker", () => {
  /// The mapping said out loud. It used to be "list them cheapest first", which
  /// left you to work out which one "high" would reach for.
  it("offers a choice per effort, and says what each effort is for", async () => {
    render(<ModelTierPicker value={value} onChange={() => {}} />);

    expect(screen.getByLabelText("Low effort model")).toHaveValue("claude-sonnet-5");
    expect(screen.getByLabelText("Medium effort model")).toHaveValue("claude-sonnet-5");
    expect(screen.getByLabelText("High effort model")).toHaveValue("claude-fable-5");

    expect(screen.getByText(/Small, well-defined edits/)).toBeInTheDocument();
    expect(screen.getByText(/Architecture changes, cross-file refactors/)).toBeInTheDocument();
  });

  /// What the chosen model is good at, beside the choice — from the Project
  /// brief, rather than in documentation nobody opens.
  it("says what the chosen model is for", () => {
    render(<ModelTierPicker value={value} onChange={() => {}} />);
    expect(
      screen.getByText(/Complex UI or coding work, unfamiliar systems/),
    ).toBeInTheDocument();
  });

  it("reports a changed tier without touching the others", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelTierPicker value={value} onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText("Low effort model"), "claude-haiku-4-5");
    expect(onChange).toHaveBeenCalledWith({
      low: "claude-haiku-4-5",
      medium: "claude-sonnet-5",
      high: "claude-fable-5",
    });
  });

  /// **The escape hatch.** The list is one somebody maintains, so a model
  /// released after it was written must still be reachable — otherwise the
  /// dropdown is a cage.
  it("lets a model be typed when it is not on the list", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelTierPicker value={value} onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText("High effort model"), "__other__");
    // Clears the tier so the box starts empty rather than holding a value the
    // person is about to replace.
    expect(onChange).toHaveBeenCalledWith({ ...value, high: "" });

    // …and the control is now a text box.
    expect(screen.getByLabelText("High effort model")).toHaveAttribute("placeholder");
  });

  /// A model stored before the list was updated must show as typed rather than
  /// silently snapping to whatever the dropdown defaults to — that would change
  /// a provider's behaviour just by opening the page.
  it("shows an unknown stored model as typed, not replaced", () => {
    render(
      <ModelTierPicker
        value={{ ...value, high: "claude-from-the-future" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("High effort model")).toHaveValue(
      "claude-from-the-future",
    );
  });

  /// Ollama's models are whatever that server has pulled, so the caller supplies
  /// them — a fixed list would be a guess about somebody else's machine.
  it("takes a caller's own list of models", () => {
    render(
      <ModelTierPicker
        choices={[{ id: "llama3", label: "Llama 3", note: "local" }]}
        value={{ low: "llama3", medium: "llama3", high: "llama3" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Low effort model")).toHaveValue("llama3");
    expect(screen.queryByText("Fable 5")).not.toBeInTheDocument();
  });
});
