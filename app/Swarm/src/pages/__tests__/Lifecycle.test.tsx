import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LifecycleSteps from "../../components/planning/LifecycleSteps";
import WorkItemLifecycle from "../../components/planning/WorkItemLifecycle";
import type { LifecycleGate, LifecycleStep } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    lifecycleGates: vi.fn(),
    listLifecycleSteps: vi.fn(),
    setLifecycleSteps: vi.fn(),
    listWorkItemSteps: vi.fn(),
    setWorkItemStep: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const gates: LifecycleGate[] = [
  { id: "toDevelop", label: "Before Product hands it to Develop", owner: "product" },
  { id: "toTest", label: "Before it is ready for QA", owner: "develop" },
  { id: "toRelease", label: "Before it is ready to release", owner: "test" },
];

const step = (over: Partial<LifecycleStep>): LifecycleStep => ({
  id: 1,
  gate: "toDevelop",
  name: "Story written",
  position: 0,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocked.lifecycleGates.mockResolvedValue(gates);
  mocked.listLifecycleSteps.mockResolvedValue([]);
  mocked.setLifecycleSteps.mockResolvedValue(undefined);
  mocked.listWorkItemSteps.mockResolvedValue([]);
  mocked.setWorkItemStep.mockResolvedValue(undefined);
});

describe("defining the steps", () => {
  /// **Nothing ships a default list.** A team that writes "spike the API" and
  /// one that writes "signed off by legal" are both right, so the app asks
  /// rather than assuming.
  it("offers the three handovers, each empty until somebody writes one", async () => {
    render(<LifecycleSteps productId={7} />);

    for (const gate of gates) {
      expect(
        await screen.findByRole("group", { name: gate.label }),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByText(/No steps yet/i)).toHaveLength(3);
  });

  /// **Each list is written where it is owned.** Product writes its handover in
  /// Product Strategy, Develop in Rules, QA beside the Testing Strategy — a
  /// team editing another team's checklist is what the areas exist to prevent.
  it("shows only the gate the area owns", async () => {
    render(<LifecycleSteps productId={7} owner="test" />);

    expect(
      await screen.findByRole("group", { name: "Before it is ready to release" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Before Product hands it to Develop" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Before it is ready for QA" }),
    ).not.toBeInTheDocument();
  });

  it("adds a step to the gate it was typed into", async () => {
    const user = userEvent.setup();
    mocked.listLifecycleSteps.mockResolvedValue([step({})]);
    render(<LifecycleSteps productId={7} />);

    const group = await screen.findByRole("group", { name: "Before it is ready for QA" });
    await user.type(
      within(group).getByLabelText("A step before it is ready for QA"),
      "Unit tests pass",
    );
    await user.click(within(group).getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(mocked.setLifecycleSteps).toHaveBeenCalledWith(7, "toTest", [
        "Unit tests pass",
      ]),
    );
  });

  /// The list is sent whole, so removing one is sending the rest — which is
  /// also what keeps the ticks on the steps that stay.
  it("removes a step by sending the list without it", async () => {
    const user = userEvent.setup();
    mocked.listLifecycleSteps.mockResolvedValue([
      step({ id: 1, name: "Story written" }),
      step({ id: 2, name: "Mockups attached", position: 1 }),
    ]);
    render(<LifecycleSteps productId={7} />);

    await user.click(
      await screen.findByRole("button", { name: "Remove Story written" }),
    );

    await waitFor(() =>
      expect(mocked.setLifecycleSteps).toHaveBeenCalledWith(7, "toDevelop", [
        "Mockups attached",
      ]),
    );
  });
});

describe("a work item's life", () => {
  const all = [
    step({ id: 1, gate: "toDevelop", name: "Story written" }),
    step({ id: 2, gate: "toTest", name: "Unit tests pass" }),
    step({ id: 3, gate: "toRelease", name: "Signed off" }),
  ];

  /// **Product sees the whole life.** It is the only area that does: an item's
  /// journey is Product's to follow end to end.
  it("shows every gate in Product", async () => {
    mocked.listLifecycleSteps.mockResolvedValue(all);
    render(<WorkItemLifecycle workItemId={9} productId={7} area="product" />);

    expect(await screen.findByText("Story written")).toBeInTheDocument();
    expect(screen.getByText("Unit tests pass")).toBeInTheDocument();
    expect(screen.getByText("Signed off")).toBeInTheDocument();
  });

  /// **Develop and QA see their bit.** Not as a permission — this app has no
  /// security — but because a checklist you cannot act on is noise on the
  /// screen of somebody trying to work.
  it("shows only its own gate in Develop and in QA", async () => {
    mocked.listLifecycleSteps.mockResolvedValue(all);
    const { unmount } = render(
      <WorkItemLifecycle workItemId={9} productId={7} area="develop" />,
    );
    expect(await screen.findByText("Unit tests pass")).toBeInTheDocument();
    expect(screen.queryByText("Story written")).not.toBeInTheDocument();
    expect(screen.queryByText("Signed off")).not.toBeInTheDocument();
    unmount();

    render(<WorkItemLifecycle workItemId={9} productId={7} area="test" />);
    expect(await screen.findByText("Signed off")).toBeInTheDocument();
    expect(screen.queryByText("Unit tests pass")).not.toBeInTheDocument();
  });

  it("ticks a step off and says how far the gate has got", async () => {
    const user = userEvent.setup();
    mocked.listLifecycleSteps.mockResolvedValue([
      step({ id: 2, gate: "toTest", name: "Unit tests pass" }),
      step({ id: 4, gate: "toTest", name: "Reviewed", position: 1 }),
    ]);
    render(<WorkItemLifecycle workItemId={9} productId={7} area="develop" />);

    expect(await screen.findByText("0 of 2")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Unit tests pass" }));

    await waitFor(() =>
      expect(mocked.setWorkItemStep).toHaveBeenCalledWith(9, 2, true),
    );
  });

  it("says the gate is clear when every step is ticked", async () => {
    mocked.listLifecycleSteps.mockResolvedValue([
      step({ id: 2, gate: "toTest", name: "Unit tests pass" }),
    ]);
    mocked.listWorkItemSteps.mockResolvedValue([2]);
    render(<WorkItemLifecycle workItemId={9} productId={7} area="develop" />);

    // Asserted on the panel, not on the words alone: the gate's own label is
    // "Before it is ready for QA", so a loose text match finds two.
    const panel = await screen.findByRole("region", { name: "Where this has got to" });
    expect(panel).toHaveTextContent(/1 of 1 · Ready for QA/);
  });

  /// A Product that has written no checklist has no gate to fail, and the panel
  /// says where to write one rather than showing an empty box — each area sent
  /// to the screen that now holds its own list.
  it("points each area at the screen that holds its list", async () => {
    const { unmount } = render(
      <WorkItemLifecycle workItemId={9} productId={7} area="develop" />,
    );
    expect(await screen.findByText(/Develop → Rules/)).toBeInTheDocument();
    unmount();

    const second = render(
      <WorkItemLifecycle workItemId={9} productId={7} area="product" />,
    );
    expect(await screen.findByText(/Product → Strategy/)).toBeInTheDocument();
    second.unmount();

    render(<WorkItemLifecycle workItemId={9} productId={7} area="test" />);
    expect(await screen.findByText(/the Testing Strategy/)).toBeInTheDocument();
  });
});
