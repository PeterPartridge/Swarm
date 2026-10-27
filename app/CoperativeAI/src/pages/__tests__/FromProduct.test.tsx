import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FromProduct from "../../components/planning/FromProduct";
import type { AiFeedback, WorkItem, WorkItemChange } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listWorkItemChanges: vi.fn(),
    changeKinds: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const item: WorkItem = {
  id: 12,
  title: "Add checkout",
  itemType: "feature",
  status: "planned",
  description: "A customer pays for what is in the basket.",
  productId: 7,
  parentItemId: null,
  assigneeId: null,
  sprintId: null,
  startDate: null,
  endDate: null,
  deliverableId: null,
  expectedCost: null,
  estimatedProfit: null,
  chargeable: false,
  customerCoverPct: null,
  risk: "Card fees are not agreed yet.",
  solutionId: null,
};

const change = (over: Partial<WorkItemChange> = {}): WorkItemChange => ({
  id: 1,
  workItemId: 12,
  solutionId: null,
  kind: "screen",
  action: "add",
  name: "Payment page",
  detail: "Card details and a Pay button.",
  mockupPath: null,
  ...over,
});

const question = (over: Partial<AiFeedback> = {}): AiFeedback => ({
  id: 5,
  workItemId: 12,
  kind: "productQuestion",
  message: "What happens when payment fails?",
  whatIsNeeded: "",
  resolved: false,
  resolvedNote: "",
  ...over,
});

describe("FromProduct", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listWorkItemChanges.mockResolvedValue([change()]);
    mocked.changeKinds.mockResolvedValue([
      { id: "screen", label: "Screen", heading: "Screens", group: "ui", groupLabel: "UI", example: "" },
    ]);
  });

  /// **Read-only, because Product owns it.** A developer looking at what was
  /// asked for must be able to read every word of it and change none — the
  /// boundary is that Product sets what customers get and Develop decides how.
  it("shows what Product asked for, with nothing a developer can edit", async () => {
    render(<FromProduct item={item} questions={[]} onAsk={vi.fn()} onAnswer={vi.fn()} />);

    expect(
      await screen.findByText("A customer pays for what is in the basket."),
    ).toBeInTheDocument();
    expect(screen.getByText("Card fees are not agreed yet.")).toBeInTheDocument();
    expect(screen.getByText(/Payment page/)).toBeInTheDocument();
    expect(screen.getByText(/Card details and a Pay button./)).toBeInTheDocument();

    // The only control here is asking a question. Nothing else is editable.
    expect(screen.queryByRole("textbox", { name: /description/i })).not.toBeInTheDocument();
    const boxes = screen.getAllByRole("textbox");
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toHaveAccessibleName("Ask Product about Add checkout");
  });

  /// An empty half is said rather than left blank, so nobody reads silence as
  /// "Product had nothing to say".
  it("says when Product has written nothing yet", async () => {
    mocked.listWorkItemChanges.mockResolvedValue([]);
    render(
      <FromProduct
        item={{ ...item, description: null, risk: "" }}
        questions={[]}
        onAsk={vi.fn()}
        onAnswer={vi.fn()}
      />,
    );

    expect(await screen.findByText(/has not described this yet/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing has been asked for/i)).toBeInTheDocument();
  });

  /// The questions read as a conversation: what was asked, and what came back.
  it("reads the questions and answers as a conversation", async () => {
    render(
      <FromProduct
        item={item}
        questions={[
          question({ id: 5, message: "What happens when payment fails?", resolved: true, resolvedNote: "Show the error, keep the basket." }),
          question({ id: 6, message: "Which cards do we take?" }),
        ]}
        onAsk={vi.fn()}
        onAnswer={vi.fn()}
      />,
    );

    const chat = await screen.findByRole("log", { name: "Questions for Product" });
    expect(chat).toHaveTextContent("What happens when payment fails?");
    expect(chat).toHaveTextContent("Show the error, keep the basket.");
    expect(chat).toHaveTextContent("Which cards do we take?");
    // The unanswered one is still open for an answer; the settled one is not.
    expect(screen.getByLabelText("Answer: Which cards do we take?")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Answer: What happens when payment fails?"),
    ).not.toBeInTheDocument();
  });

  it("asks a question and answers an open one", async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();
    const onAnswer = vi.fn();
    render(
      <FromProduct
        item={item}
        questions={[question()]}
        onAsk={onAsk}
        onAnswer={onAnswer}
      />,
    );

    await user.type(
      await screen.findByLabelText("Ask Product about Add checkout"),
      "Do we refund partially?",
    );
    await user.click(screen.getByRole("button", { name: "Ask Product" }));
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith("Do we refund partially?"));

    await user.type(
      screen.getByLabelText("Answer: What happens when payment fails?"),
      "Show the error",
    );
    await user.click(
      screen.getByLabelText("Save answer to: What happens when payment fails?"),
    );
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(5, "Show the error"));
  });
});
