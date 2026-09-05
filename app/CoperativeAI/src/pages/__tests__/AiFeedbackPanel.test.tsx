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
    clearAiJobs: vi.fn(),
    readAgentRecord: vi.fn(),
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
    mocked.clearAiJobs.mockResolvedValue(0);
    mocked.readAgentRecord.mockResolvedValue(null);
  });

  /// **The round record, which the app used to have no way of seeing.** An
  /// agent finished a job and wrote a careful account of what it built and what
  /// it left behind — into its terminal, because the brief never asked for one
  /// and nothing read one back. Both halves are fixed now, and this is the end
  /// of that: what it said, on the panel about what the AI reported.
  it("shows what the agent reported when it finished, debt and all", async () => {
    mocked.readAgentRecord.mockResolvedValue({
      whatIBuilt: "A NameGreeter class and the console entry point.",
      tests: "15 passed, 0 failed.",
      feedback: "The brief said the same rule twice.",
      technicalDebt: "No integration test for the entry point. Half a day to add one.",
      couldNotDo: "",
      other: "",
    });
    render(<AiFeedbackPanel workItemId={9} productId={7} runId={3} />);

    const reported = await screen.findByRole("region", {
      name: "What the agent reported",
    });
    expect(reported).toHaveTextContent(/NameGreeter/);
    expect(reported).toHaveTextContent(/15 passed/);
    expect(reported).toHaveTextContent(/same rule twice/);
    expect(reported).toHaveTextContent(/No integration test/);
  });

  /// A section the agent left blank is left out rather than shown as an empty
  /// heading — an empty "Technical debt" reads as "there is none", which is a
  /// claim the app has no business making on the agent's behalf.
  it("leaves out the sections the agent did not write", async () => {
    mocked.readAgentRecord.mockResolvedValue({
      whatIBuilt: "The thing.",
      tests: "",
      feedback: "",
      technicalDebt: "",
      couldNotDo: "",
      other: "",
    });
    render(<AiFeedbackPanel workItemId={9} productId={7} runId={3} />);

    const reported = await screen.findByRole("region", {
      name: "What the agent reported",
    });
    expect(reported).toHaveTextContent("The thing.");
    expect(reported).not.toHaveTextContent("Technical debt");
  });

  /// Nothing back yet is the ordinary state for most of a run's life, and it is
  /// not an error — so the panel says so and shows the rest as it always did.
  it("says nothing has come back from the agent yet", async () => {
    render(<AiFeedbackPanel workItemId={9} productId={7} runId={3} />);
    expect(
      await screen.findByText(/has not written its round record yet/i),
    ).toBeInTheDocument();
  });

  /// Without a run there is no record to read, and no reason to say anything
  /// about one — this panel is also shown on items no agent has touched.
  it("says nothing about a record when there is no run", async () => {
    render(<AiFeedbackPanel workItemId={9} productId={7} />);
    await screen.findByText(/The AI has not reported anything on this item/i);
    expect(mocked.readAgentRecord).not.toHaveBeenCalled();
    expect(screen.queryByText(/round record/i)).not.toBeInTheDocument();
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
  /// **Nine rows saying one thing.** A refusal repeated on every attempt is one
  /// fact about this item, not nine — and read as a list it looks like nine
  /// separate things going wrong.
  it("says a repeated failure once, with how many times", async () => {
    const same = "'Create a console app' has no AI policy, so AI can't touch it";
    mocked.listAiJobs.mockResolvedValue([
      job({ id: 1, message: same, submittedAt: 1_700_000_000_000 }),
      job({ id: 2, message: same, submittedAt: 1_700_000_100_000 }),
      job({ id: 3, message: same, submittedAt: 1_700_000_200_000 }),
      job({ id: 4, message: "something else" }),
    ]);
    render(<AiFeedbackPanel workItemId={9} productId={7} />);

    const failures = await screen.findByRole("list", { name: "Attempts that failed" });
    expect(within(failures).getAllByRole("listitem")).toHaveLength(2);
    expect(within(failures).getByText("3 times")).toBeInTheDocument();
  });

  /// **A failure with no date reads as a failure now.** These are the record of
  /// every attempt, including ones from before whatever was wrong got fixed —
  /// undated, an old refusal is indistinguishable from a current one.
  it("says when each one happened", async () => {
    const at = new Date("2026-03-04T09:00:00");
    mocked.listAiJobs.mockResolvedValue([job({ id: 1, submittedAt: at.getTime() })]);
    render(<AiFeedbackPanel workItemId={9} productId={7} />);

    // **The date in the reader's own locale, not in mine.** This asserted
    // "4 Mar" and passed on an en-GB laptop while failing on an en-US runner,
    // where the same day is "Mar 4" — a green suite locally and a red pipeline,
    // over a difference the app is right to have. What is worth pinning is that
    // the row carries *that* day, short, however the reader's machine writes
    // it.
    const short = at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    expect(short).not.toBe("—");
    const failures = await screen.findByRole("list", { name: "Attempts that failed" });
    expect(failures).toHaveTextContent(short);
  });

  /// **Old attempts are noise once they are fixed, and only a person can say
  /// so.** Nothing prunes them on its own: they are the record of what was
  /// tried, and an app that quietly tidied history would be deciding for
  /// somebody which failures mattered.
  it("clears the settled attempts when asked, and says what stays", async () => {
    mocked.listAiJobs.mockResolvedValue([job({ id: 1 }), job({ id: 2 })]);
    mocked.clearAiJobs.mockResolvedValue(2);
    render(<AiFeedbackPanel workItemId={9} productId={7} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Clear the failed attempts" }),
    );

    await waitFor(() => expect(mocked.clearAiJobs).toHaveBeenCalledWith(9));
    expect(await screen.findByRole("status")).toHaveTextContent(/2 attempts/);
    // Says what it did not touch, because "cleared" should not read as "the
    // spend is gone too".
    expect(screen.getByRole("status")).toHaveTextContent(/what they cost/i);
  });

});
