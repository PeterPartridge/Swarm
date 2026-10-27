import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BlockedNote from "../../components/ai/BlockedNote";
import Notice from "../../components/ai/Notice";

const blocked = {
  reason: "No payment provider is named.",
  whatIsNeeded: "Which provider takes the payment?",
  feedbackId: 9,
};

describe("BlockedNote / Notice", () => {
  it("leads with what the AI declined to do, then the reason and the question", () => {
    render(<BlockedNote blocked={blocked} what="guessing" />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      "The AI stopped rather than guessing: No payment provider is named.",
    );
    expect(status).toHaveTextContent("Which provider takes the payment?");
  });

  /// A decline is the framework working. Reading as an error would teach
  /// people to avoid the thing that saves them from invented work.
  it("is never an alert", () => {
    render(<BlockedNote blocked={blocked} what="guessing" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).not.toHaveTextContent(/error|failed/i);
  });

  /// The guard three of the six panels were missing: a decline with no
  /// question used to render a dangling sentence.
  it("says nothing more when there is no question to ask", () => {
    render(
      <BlockedNote blocked={{ ...blocked, whatIsNeeded: "" }} what="guessing" />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("No payment provider is named.");
    expect(status.querySelectorAll("p")).toHaveLength(1);
  });

  /// When the question is stored against the item, the card shows it — so
  /// this points there rather than saying the same thing twice.
  it("points at where the question lives instead of repeating it", () => {
    render(
      <BlockedNote blocked={blocked} what="guessing" answerOn="the card" />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Answer its question on the card");
    expect(status).not.toHaveTextContent("Which provider takes the payment?");
  });

  it("carries a plain sentence unchanged, and renders nothing for no notice", () => {
    const { rerender, container } = render(<Notice value="Saved." />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");

    rerender(<Notice value={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  /// The bug the union exists to prevent: a panel that held a string and a
  /// blocked separately had to remember to clear the other one, and a stale
  /// question under a successful run claims a refusal that did not happen.
  it("replaces a decline when the next attempt succeeds", () => {
    const { rerender } = render(
      <Notice value={{ blocked, what: "guessing" }} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("stopped rather than");

    rerender(<Notice value="Created 3 work items." />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Created 3 work items.");
    expect(status).not.toHaveTextContent("stopped rather than");
  });
});
