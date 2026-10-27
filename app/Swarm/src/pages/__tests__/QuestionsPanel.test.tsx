import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QuestionsPanel from "../../components/ai/QuestionsPanel";
import type { OpenQuestion } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listOpenQuestions: vi.fn(),
    resolveAiFeedback: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const question = (over: Partial<OpenQuestion> = {}): OpenQuestion => ({
  id: 1,
  workItemId: 9,
  workItemTitle: "Add checkout",
  kind: "clarification",
  message: "Which payment provider?",
  whatIsNeeded: "Name the provider and whether it is already contracted.",
  ...over,
});

describe("QuestionsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listOpenQuestions.mockResolvedValue([]);
  });

  it("says nothing is waiting when there are no questions", async () => {
    render(<QuestionsPanel productId={1} />);
    expect(await screen.findByText(/Nothing is waiting on you/)).toBeInTheDocument();
  });

  /// The point of a Product-wide list: a question from any agent is findable
  /// without opening each work item to check.
  it("names the work item each question came from", async () => {
    mocked.listOpenQuestions.mockResolvedValue([
      question({ id: 1, workItemTitle: "Add checkout" }),
      question({ id: 2, workItemTitle: "Add refunds", message: "Refund window?" }),
    ]);
    render(<QuestionsPanel productId={1} />);

    expect(await screen.findByText("Add checkout")).toBeInTheDocument();
    expect(screen.getByText("Add refunds")).toBeInTheDocument();
    expect(screen.getByText("Which payment provider?")).toBeInTheDocument();
    // the count is in the heading, so the tab says how much is waiting
    expect(screen.getByRole("heading", { name: /Questions \(2\)/ })).toBeInTheDocument();
  });

  /// The actionable half — what would unblock it — is shown, not just the
  /// question.
  it("shows what would unblock the work", async () => {
    mocked.listOpenQuestions.mockResolvedValue([question()]);
    render(<QuestionsPanel productId={1} />);
    expect(
      await screen.findByText(/Name the provider and whether it is already contracted/),
    ).toBeInTheDocument();
  });

  /// Answering records a clarification that travels with the next prompt — so
  /// the panel says that, rather than implying the box was merely dismissed.
  it("sends an answer and says where it goes", async () => {
    const user = userEvent.setup();
    mocked.listOpenQuestions.mockResolvedValue([question()]);
    mocked.resolveAiFeedback.mockResolvedValue(undefined);
    render(<QuestionsPanel productId={1} />);

    await user.type(
      await screen.findByLabelText("Answer to: Which payment provider?"),
      "Stripe, already contracted",
    );
    await user.click(screen.getByLabelText("Send answer for Add checkout"));

    await waitFor(() =>
      expect(mocked.resolveAiFeedback).toHaveBeenCalledWith(1, "Stripe, already contracted"),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/travels with Add checkout/);
  });

  /// An empty answer is not an answer — the backend refuses it, so the button
  /// does too rather than round-tripping to find out.
  it("will not send an empty answer", async () => {
    mocked.listOpenQuestions.mockResolvedValue([question()]);
    render(<QuestionsPanel productId={1} />);
    expect(await screen.findByLabelText("Send answer for Add checkout")).toBeDisabled();
  });
});
