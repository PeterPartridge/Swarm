import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkItemBuildPlan from "../../components/WorkItemBuildPlan";
import type { Solution, WorkItem, WorkItemPlan } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listWorkItemPlans: vi.fn(),
    attachSolutionToWorkItem: vi.fn(),
    saveWorkItemPlan: vi.fn(),
    detachWorkItemPlan: vi.fn(),
    generateChangePlan: vi.fn(),
    listAiFeedback: vi.fn(),
    askProductQuestion: vi.fn(),
    resolveAiFeedback: vi.fn(),
    pickImages: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const item: WorkItem = {
  id: 12,
  title: "Add checkout",
  itemType: "feature",
  status: "planned",
  description: "Take payment",
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
};

function solution(id: number, name: string): Solution {
  return {
    id,
    name,
    productId: 7,
    solutionType: "api",
    answers: "{}",
    origin: "created",
    githubUrl: null,
    githubVisibility: null,
    localPath: null,
    testCommand: null,
  };
}

function plan(overrides: Partial<WorkItemPlan> = {}): WorkItemPlan {
  return {
    id: 1,
    workItemId: 12,
    solutionId: 3,
    solutionName: "Shop API",
    changesRequired: "",
    unitTests: "",
    branchName: "",
    cloneFrom: "",
    mockups: "[]",
    apiSchema: "",
    pageSchema: "",
    filesToChange: "",
    ...overrides,
  };
}

const solutions = [solution(3, "Shop API"), solution(4, "Shop Web")];

describe("WorkItemBuildPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listWorkItemPlans.mockResolvedValue([]);
    mocked.listAiFeedback.mockResolvedValue([]);
  });

  it("says nothing is affected yet, and offers the Product's Solutions", async () => {
    const user = userEvent.setup();
    mocked.attachSolutionToWorkItem.mockResolvedValue(1);
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    expect(await screen.findByText(/Nothing affected yet/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Add an affected solution"), "4");

    await waitFor(() =>
      expect(mocked.attachSolutionToWorkItem).toHaveBeenCalledWith(12, 4),
    );
  });

  /// Each affected Solution gets its own changes, tests and branch — a work
  /// item touching two repos needs two of each.
  it("writes the changes, tests and branch for one Solution", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([
      plan({ branchName: "feature/12-add-checkout", cloneFrom: "main" }),
    ]);
    mocked.saveWorkItemPlan.mockResolvedValue();
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    const changes = await screen.findByLabelText("Changes required in Shop API");
    await user.type(changes, "Add POST /checkout");
    await user.tab();

    await waitFor(() =>
      expect(mocked.saveWorkItemPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          changesRequired: "Add POST /checkout",
          // the Develop Strategy's defaults came through on attach
          branchName: "feature/12-add-checkout",
          cloneFrom: "main",
        }),
      ),
    );
  });

  /// The answers are what make "we have asked enough to generate" true, so the
  /// panel says where they go.
  it("asks Product a question and answers it", async () => {
    const user = userEvent.setup();
    mocked.askProductQuestion.mockResolvedValue(5);
    mocked.resolveAiFeedback.mockResolvedValue();
    mocked.listAiFeedback.mockResolvedValue([
      {
        id: 5,
        workItemId: 12,
        kind: "productQuestion",
        message: "What happens when payment fails?",
        whatIsNeeded: "Product needs to answer this",
        resolved: false,
        resolvedNote: "",
      },
    ]);
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    expect(
      await screen.findByText(/Answers become clarifications on this work item/),
    ).toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Question for Product"),
      "What happens when payment fails?",
    );
    await user.click(screen.getByLabelText("Ask Product"));
    await waitFor(() =>
      expect(mocked.askProductQuestion).toHaveBeenCalledWith(
        12,
        "What happens when payment fails?",
      ),
    );

    const waiting = await screen.findByRole("list", { name: "Waiting on an answer" });
    await user.type(
      within(waiting).getByLabelText("Answer: What happens when payment fails?"),
      "Show the error and keep the basket",
    );
    await user.click(
      within(waiting).getByLabelText("Save answer to: What happens when payment fails?"),
    );
    await waitFor(() =>
      expect(mocked.resolveAiFeedback).toHaveBeenCalledWith(
        5,
        "Show the error and keep the basket",
      ),
    );
  });

  it("generates the schemas and shows them per Solution", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([
      plan({ changesRequired: "Add POST /checkout" }),
    ]);
    mocked.generateChangePlan.mockImplementation(async () => {
      mocked.listWorkItemPlans.mockResolvedValue([
        plan({
          changesRequired: "Add POST /checkout",
          apiSchema: "POST /checkout -> 201",
          filesToChange: "src/api/checkout.rs",
        }),
      ]);
      return {
        created: ["Shop API"],
        provider: "Claude",
        model: "m",
        reason: "within budget",
        blocked: null,
      };
    });
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    await user.click(
      await screen.findByLabelText("Generate the code changes for Add checkout"),
    );

    await waitFor(() => expect(mocked.generateChangePlan).toHaveBeenCalledWith(12));
    const schemas = await screen.findByRole("region", { name: "Schemas for Shop API" });
    expect(within(schemas).getByText("POST /checkout -> 201")).toBeInTheDocument();
    expect(within(schemas).getByText("src/api/checkout.rs")).toBeInTheDocument();
    // an empty half is left out rather than shown as a blank block
    expect(within(schemas).queryByText("Page schema")).not.toBeInTheDocument();
  });

  /// Refusing to invent the missing half is the framework working.
  it("treats a refusal as a question, not a failure", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([plan({ changesRequired: "something" })]);
    mocked.generateChangePlan.mockResolvedValue({
      created: [],
      provider: "Claude",
      model: "m",
      reason: "within budget",
      blocked: {
        reason: "No payment provider is named.",
        whatIsNeeded: "Which provider takes the payment?",
        feedbackId: 9,
      },
    });
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    await user.click(
      await screen.findByLabelText("Generate the code changes for Add checkout"),
    );

    expect(await screen.findByText(/Stopped rather than inventing the rest/)).toBeInTheDocument();
    expect(screen.getByText(/Which provider takes the payment\?/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /// Nothing to generate from is worth saying before it is worth paying for.
  it("cannot generate before a Solution is affected", async () => {
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);
    expect(
      await screen.findByLabelText("Generate the code changes for Add checkout"),
    ).toBeDisabled();
  });

  it("attaches UI pictures and names them", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([plan({})]);
    mocked.pickImages.mockResolvedValue(["C:/shots/basket.png"]);
    mocked.saveWorkItemPlan.mockResolvedValue();
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    await user.click(await screen.findByLabelText("Add UI pictures for Shop API"));

    await waitFor(() =>
      expect(mocked.saveWorkItemPlan).toHaveBeenCalledWith(
        expect.objectContaining({ mockups: JSON.stringify(["C:/shots/basket.png"]) }),
      ),
    );
  });
});
