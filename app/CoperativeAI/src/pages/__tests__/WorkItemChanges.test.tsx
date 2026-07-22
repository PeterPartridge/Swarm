import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkItemChanges from "../../components/WorkItemChanges";
import type { Solution, WorkItemChange } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listWorkItemChanges: vi.fn(),
    addWorkItemChange: vi.fn(),
    assignWorkItemChange: vi.fn(),
    deleteWorkItemChange: vi.fn(),
    changeKindsForSolution: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const solution = (over: Partial<Solution> = {}): Solution => ({
  id: 3,
  name: "Shop API",
  productId: 1,
  solutionType: "api",
  answers: "{}",
  origin: "created",
  githubUrl: null,
  githubVisibility: null,
  localPath: null,
  testCommand: null,
  language: null,
  ...over,
});

const change = (over: Partial<WorkItemChange> = {}): WorkItemChange => ({
  id: 1,
  workItemId: 9,
  solutionId: null,
  kind: "screen",
  action: "add",
  name: "Basket",
  detail: "shows what is in the basket",
  ...over,
});

describe("WorkItemChanges — Product's half", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listWorkItemChanges.mockResolvedValue([]);
    mocked.addWorkItemChange.mockResolvedValue(1);
  });

  /// Product knows what they want to see, not which repository grows it. That
  /// has to be a legitimate state or Product cannot record anything until a
  /// developer has done their part.
  it("adds a screen with no Solution against it", async () => {
    const user = userEvent.setup();
    render(<WorkItemChanges workItemId={9} mode="product" solutions={[]} />);

    await user.type(await screen.findByLabelText("Name"), "Basket");
    await user.type(screen.getByLabelText("Detail"), "shows the basket");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(mocked.addWorkItemChange).toHaveBeenCalledWith({
        workItemId: 9,
        solutionId: null,
        kind: "screen",
        action: "add",
        name: "Basket",
        detail: "shows the basket",
      }),
    );
  });

  /// Product picks screens, not endpoints and tables — offering those here
  /// would be asking Product to make a decision that is not theirs.
  it("does not offer APIs or tables to Product", async () => {
    render(<WorkItemChanges workItemId={9} mode="product" solutions={[]} />);
    await screen.findByLabelText("Name");
    expect(screen.queryByLabelText("Kind of change")).not.toBeInTheDocument();
  });

  it("shows where an assigned screen ended up", async () => {
    mocked.listWorkItemChanges.mockResolvedValue([change({ solutionId: 3 })]);
    render(<WorkItemChanges workItemId={9} mode="product" solutions={[solution()]} />);
    expect(await screen.findByText("→ Shop API")).toBeInTheDocument();
  });
});

describe("WorkItemChanges — the developer's half", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listWorkItemChanges.mockResolvedValue([]);
    mocked.addWorkItemChange.mockResolvedValue(1);
    mocked.assignWorkItemChange.mockResolvedValue(undefined);
    mocked.changeKindsForSolution.mockResolvedValue(["api", "table"]);
  });

  /// The kinds come from the backend, not from a list in the component — two
  /// copies of that rule would drift, and the drift would only show as a
  /// rejected save.
  it("offers only the kinds the chosen Solution's type can carry", async () => {
    const user = userEvent.setup();
    render(
      <WorkItemChanges workItemId={9} mode="developer" solutions={[solution()]} />,
    );

    await user.selectOptions(
      await screen.findByLabelText("Solution this belongs to"),
      "3",
    );

    await waitFor(() => expect(mocked.changeKindsForSolution).toHaveBeenCalledWith(3));
    const kinds = await screen.findByLabelText("Kind of change");
    expect(kinds).toHaveDisplayValue("API");
    expect(screen.queryByRole("option", { name: "Screen" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Database table" })).toBeInTheDocument();
  });

  it("adds an endpoint against a Solution", async () => {
    const user = userEvent.setup();
    render(
      <WorkItemChanges workItemId={9} mode="developer" solutions={[solution()]} />,
    );

    await user.selectOptions(
      await screen.findByLabelText("Solution this belongs to"),
      "3",
    );
    await waitFor(() => expect(mocked.changeKindsForSolution).toHaveBeenCalled());
    await user.type(screen.getByLabelText("Name"), "POST /checkout");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(mocked.addWorkItemChange).toHaveBeenCalledWith(
        expect.objectContaining({ solutionId: 3, kind: "api", name: "POST /checkout" }),
      ),
    );
  });

  /// The handover between the two halves: Product's ask arrives unassigned and
  /// this is where it gets pointed at a repository.
  it("assigns Product's unassigned ask to a Solution", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemChanges.mockResolvedValue([change()]);
    render(
      <WorkItemChanges
        workItemId={9}
        mode="developer"
        solutions={[solution({ id: 5, name: "Shop Web", solutionType: "website" })]}
      />,
    );

    expect(await screen.findByText(/1 of these is still waiting/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Solution for Basket"), "5");

    await waitFor(() => expect(mocked.assignWorkItemChange).toHaveBeenCalledWith(1, 5));
  });

  /// A screen cannot be dropped onto an API Solution, and the backend's refusal
  /// is shown rather than swallowed.
  it("surfaces the backend's refusal when the type does not match", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemChanges.mockResolvedValue([change()]);
    mocked.assignWorkItemChange.mockRejectedValue(
      "'Basket' is a screen, and a api Solution does not carry those",
    );
    render(
      <WorkItemChanges workItemId={9} mode="developer" solutions={[solution()]} />,
    );

    await user.selectOptions(await screen.findByLabelText("Solution for Basket"), "3");

    expect(await screen.findByRole("alert")).toHaveTextContent(/does not carry those/);
  });
});
