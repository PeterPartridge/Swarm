import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TestWorkItems from "../../components/testing/TestWorkItems";
import type { LifecycleGate, LifecycleStep, WorkItem } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listWorkItems: vi.fn(),
    updateWorkItemStatus: vi.fn(),
    askProductQuestion: vi.fn(),
    lifecycleGates: vi.fn(),
    listLifecycleSteps: vi.fn(),
    listWorkItemSteps: vi.fn(),
    setWorkItemStep: vi.fn(),
    listAiFeedback: vi.fn(),
    listAiJobs: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const item = (over: Partial<WorkItem>): WorkItem =>
  ({
    id: 1,
    title: "Checkout",
    itemType: "feature",
    status: "building",
    description: "Take a card payment.",
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
    risk: "",
    solutionId: null,
    ...over,
  }) as WorkItem;

const gates: LifecycleGate[] = [
  { id: "toDevelop", label: "Before Product hands it to Develop", owner: "product" },
  { id: "toTest", label: "Before it is ready for QA", owner: "develop" },
  { id: "toRelease", label: "Before it is ready to release", owner: "test" },
];

const steps: LifecycleStep[] = [
  { id: 1, gate: "toDevelop", name: "Story written", position: 0 },
  { id: 2, gate: "toTest", name: "Unit tests pass", position: 0 },
  { id: 3, gate: "toRelease", name: "Regression run", position: 0 },
];

describe("the work waiting for QA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listWorkItems.mockResolvedValue([item({})]);
    mocked.updateWorkItemStatus.mockResolvedValue(undefined);
    mocked.askProductQuestion.mockResolvedValue(5);
    mocked.lifecycleGates.mockResolvedValue(gates);
    mocked.listLifecycleSteps.mockResolvedValue(steps);
    mocked.listWorkItemSteps.mockResolvedValue([]);
    mocked.setWorkItemStep.mockResolvedValue(undefined);
    mocked.listAiFeedback.mockResolvedValue([]);
    mocked.listAiJobs.mockResolvedValue([]);
  });

  /// **QA had no work items at all.** "What has Develop handed me?" is the
  /// first question somebody standing here asks, and it was answered on another
  /// team's screen.
  it("lists the Product's work items", async () => {
    render(<TestWorkItems productId={7} />);
    expect(await screen.findByRole("button", { name: "Open Checkout" })).toBeInTheDocument();
  });

  it("moves an item along", async () => {
    const user = userEvent.setup();
    render(<TestWorkItems productId={7} />);

    await user.click(await screen.findByRole("button", { name: "Open Checkout" }));
    await user.selectOptions(screen.getByLabelText("Status of Checkout"), "done");

    await waitFor(() =>
      expect(mocked.updateWorkItemStatus).toHaveBeenCalledWith(1, "done"),
    );
  });

  /// QA sees the gate it owns and neither of the others — the same rule the
  /// build plan follows for Develop.
  it("shows QA's own checklist and nobody else's", async () => {
    const user = userEvent.setup();
    render(<TestWorkItems productId={7} />);

    await user.click(await screen.findByRole("button", { name: "Open Checkout" }));
    const life = await screen.findByRole("region", { name: "Where this has got to" });
    expect(within(life).getByText("Regression run")).toBeInTheDocument();
    expect(within(life).queryByText("Story written")).not.toBeInTheDocument();
    expect(within(life).queryByText("Unit tests pass")).not.toBeInTheDocument();
  });

  /// **What the work is stays Product's.** A requirement reworded by the person
  /// testing it stops being a requirement — so the description is read, and the
  /// way to change it is to ask.
  it("shows the description without offering to edit it", async () => {
    const user = userEvent.setup();
    render(<TestWorkItems productId={7} />);

    await user.click(await screen.findByRole("button", { name: "Open Checkout" }));
    const open = screen.getByLabelText("QA view of Checkout");
    expect(open).toHaveTextContent("Take a card payment.");
    expect(
      within(open).queryByLabelText(/description/i),
    ).not.toBeInTheDocument();

    await user.type(
      within(open).getByLabelText("Ask Product about Checkout"),
      "Does this cover refunds?",
    );
    await user.click(within(open).getByRole("button", { name: "Ask Product" }));
    await waitFor(() =>
      expect(mocked.askProductQuestion).toHaveBeenCalledWith(1, "Does this cover refunds?"),
    );
  });
});
