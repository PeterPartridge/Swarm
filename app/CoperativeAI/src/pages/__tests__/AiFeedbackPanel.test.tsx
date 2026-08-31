import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AiFeedbackPanel from "../../components/ai/AiFeedbackPanel";
import type { AiFeedback, AiJob } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listAiFeedback: vi.fn(),
    listAiJobs: vi.fn(),
    resolveAiFeedback: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const feedback = (over: Partial<AiFeedback>): AiFeedback => ({
  id: 1,
  workItemId: 9,
  kind: "cantImplement",
  message: "The payment provider's SDK is not in this repository.",
  whatIsNeeded: "Add it, or say which one to use.",
  resolved: false,
  resolvedNote: "",
  ...over,
});

const job = (over: Partial<AiJob>): AiJob => ({
  id: 4,
  workItemTitle: "Add checkout",
  workItemId: 9,
  purpose: "changePlan",
  state: "failed",
  message: "'Shop Web' has no folder on this machine",
  submittedAt: 1_700_000_000_000,
  startedAt: null,
  finishedAt: null,
  ...over,
});

describe("the AI feedback panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listAiFeedback.mockResolvedValue([]);
    mocked.listAiJobs.mockResolvedValue([]);
    mocked.resolveAiFeedback.mockResolvedValue(undefined);
  });

  /// **What failed, in one place.** An attempt that failed lived only in the
  /// queue on another tab, so the panel about this work item's AI could not say
  /// that its AI had failed.
  it("lists the attempts that failed, with what they said", async () => {
    mocked.listAiJobs.mockResolvedValue([
      job({}),
      job({ id: 5, state: "done", message: "Planned Shop API" }),
      job({ id: 6, workItemId: 99, message: "another item's failure" }),
    ]);
    render(<AiFeedbackPanel workItemId={9} productId={7} />);

    const failures = await screen.findByRole("list", { name: "Attempts that failed" });
    expect(within(failures).getByText(/no folder on this machine/)).toBeInTheDocument();
    // Not the ones that worked, and not another item's.
    expect(within(failures).queryByText(/Planned Shop API/)).not.toBeInTheDocument();
    expect(within(failures).queryByText(/another item/)).not.toBeInTheDocument();
  });

  /// **Read, not edited.** What the AI could not do is a record of what
  /// happened; a box you can type into invites correcting the account rather
  /// than answering it.
  it("shows what the AI could not do as a list nobody can edit", async () => {
    mocked.listAiFeedback.mockResolvedValue([feedback({})]);
    render(<AiFeedbackPanel workItemId={9} productId={7} />);

    const list = await screen.findByRole("list", { name: "What the AI could not do" });
    const row = within(list).getByRole("listitem");
    expect(row).toHaveTextContent(/payment provider's SDK/);

    // The AI's account is text. The only field in the row is the developer's
    // half — how to solve it — so nothing invites editing what it reported.
    const fields = within(row).getAllByRole("textbox");
    expect(fields).toHaveLength(1);
    expect(fields[0]).toHaveAccessibleName(/How to solve/);
    expect(fields[0]).toHaveValue("");
  });

  /// The developer's half: how to solve the thing it could not do. Stored as
  /// the resolution, so it travels into the next attempt rather than being a
  /// note nobody reads.
  it("takes the developer's answer for one of them", async () => {
    mocked.listAiFeedback.mockResolvedValue([feedback({})]);
    const onResolved = vi.fn();
    render(<AiFeedbackPanel workItemId={9} productId={7} onResolved={onResolved} />);

    await userEvent.type(
      await screen.findByLabelText("How to solve: The payment provider's SDK is not in this repository."),
      "Use the Stripe SDK, it is in the shared package",
    );
    await userEvent.click(
      screen.getByLabelText("Save how to solve: The payment provider's SDK is not in this repository."),
    );

    await waitFor(() =>
      expect(mocked.resolveAiFeedback).toHaveBeenCalledWith(
        1,
        "Use the Stripe SDK, it is in the shared package",
      ),
    );
    expect(onResolved).toHaveBeenCalled();
  });

  /// An answered one keeps both halves — what it could not do and what it was
  /// told — because that pair is the record of how it got unstuck.
  it("keeps the answer beside what it could not do", async () => {
    mocked.listAiFeedback.mockResolvedValue([
      feedback({ resolved: true, resolvedNote: "Use the shared Stripe package" }),
    ]);
    render(<AiFeedbackPanel workItemId={9} productId={7} />);

    const list = await screen.findByRole("list", { name: "What the AI could not do" });
    expect(list).toHaveTextContent(/payment provider's SDK/);
    expect(list).toHaveTextContent(/Use the shared Stripe package/);
  });

  /// A question is not the same as a refusal: one wants an answer, the other
  /// wants a decision. They are separate lists.
  it("keeps questions apart from what it could not do", async () => {
    mocked.listAiFeedback.mockResolvedValue([
      feedback({}),
      feedback({ id: 2, kind: "needsInformation", message: "Which currency?" }),
    ]);
    render(<AiFeedbackPanel workItemId={9} productId={7} />);

    const cannot = await screen.findByRole("list", { name: "What the AI could not do" });
    expect(cannot).not.toHaveTextContent(/Which currency/);
    const asked = screen.getByRole("list", { name: "Questions the AI asked" });
    expect(asked).toHaveTextContent(/Which currency/);
  });

  it("says nothing has come back rather than showing three empty headings", async () => {
    render(<AiFeedbackPanel workItemId={9} productId={7} />);
    expect(
      await screen.findByText(/The AI has not reported anything on this item/i),
    ).toBeInTheDocument();
  });
});
