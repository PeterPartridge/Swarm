import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkItemBuildPlan from "../../components/planning/WorkItemBuildPlan";
import type { Solution, WorkItem, WorkItemPlan } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listWorkItemPlans: vi.fn(),
    // The build plan now embeds WorkItemChanges. Leaving these unmocked lets
    // them fall through to the real invoke, which renders an error alert and
    // quietly breaks assertions about what else is on screen.
    listWorkItemChanges: vi.fn(),
    changeKinds: vi.fn(),
    changeKindsForSolution: vi.fn(),
    solutionCatalogue: vi.fn(),
    createSolutionWithStarter: vi.fn(),
    listStarters: vi.fn(),
    // The pair is written on every save now, so every test in here touches it.
    writeWorkItemFiles: vi.fn(),
    updateWorkItem: vi.fn(),
    attachSolutionToWorkItem: vi.fn(),
    saveWorkItemPlan: vi.fn(),
    detachWorkItemPlan: vi.fn(),
    generateChangePlan: vi.fn(),
    listAiFeedback: vi.fn(),
    askProductQuestion: vi.fn(),
    resolveAiFeedback: vi.fn(),
    pickImages: vi.fn(),
    setPlanApproval: vi.fn(),
    startRun: vi.fn(),
    createSolution: vi.fn(),
    listSolutions: vi.fn(),
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
    language: null,
    runCommand: null,
    startFrom: null,
    kindLocations: "{}",
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
    // Unapproved by default, matching a freshly attached plan.
    approvedAt: 0,
    ...overrides,
  };
}

const solutions = [solution(3, "Shop API"), solution(4, "Shop Web")];

describe("WorkItemBuildPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listWorkItemPlans.mockResolvedValue([]);
    mocked.listAiFeedback.mockResolvedValue([]);
    mocked.listWorkItemChanges.mockResolvedValue([]);
    mocked.changeKinds.mockResolvedValue([]);
    mocked.changeKindsForSolution.mockResolvedValue(["screen"]);
    mocked.solutionCatalogue.mockResolvedValue([]);
    mocked.writeWorkItemFiles.mockResolvedValue([]);
    mocked.updateWorkItem.mockResolvedValue(undefined);
  });


  /// The answers are what make "we have asked enough to generate" true, so the
  /// panel says where they go.
  /// **One way to say which Solution, not two.** A "Lands in" picker sat here
  /// setting the work item's `solutionId` while attaching a Solution in "What
  /// this changes" created a plan and set nothing — so the two could disagree,
  /// and the handover gate and AI-written tests read one answer while the runs
  /// and the plan read the other. Attaching is now the only way in.
  it("has no second picker for the Solution the work lands in", async () => {
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);
    await screen.findByLabelText("Submit Add checkout for planning");

    expect(screen.queryByLabelText(`Solution of ${item.title}`)).not.toBeInTheDocument();
    expect(screen.queryByText("Lands in")).not.toBeInTheDocument();
  });

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

    // The questions live on Product's side of the panel now — the tab shows
    // how many are still waiting, so a developer can see it without switching.
    await user.click(
      await screen.findByRole("button", { name: /From Product \(1 unanswered\)/ }),
    );

    await user.type(
      await screen.findByLabelText("Ask Product about Add checkout"),
      "What happens when payment fails?",
    );
    await user.click(screen.getByRole("button", { name: "Ask Product" }));
    await waitFor(() =>
      expect(mocked.askProductQuestion).toHaveBeenCalledWith(
        12,
        "What happens when payment fails?",
      ),
    );

    // It reads as a conversation now, not a list of outstanding items.
    const chat = await screen.findByRole("log", { name: "Questions for Product" });
    await user.type(
      within(chat).getByLabelText("Answer: What happens when payment fails?"),
      "Show the error and keep the basket",
    );
    await user.click(
      within(chat).getByLabelText("Save answer to: What happens when payment fails?"),
    );
    await waitFor(() =>
      expect(mocked.resolveAiFeedback).toHaveBeenCalledWith(
        5,
        "Show the error and keep the basket",
      ),
    );
  });

  /// **A disabled button that says nothing looks exactly like a broken one.**
  /// Both of these need a Solution attached, and pressing them before that
  /// happened produced no plan, no error, and no reason — which is what "I
  /// clicked it and nothing happened" actually was.
  it("says why it cannot plan or execute yet", async () => {
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    const plan = await screen.findByRole("button", { name: `Plan ${item.title}` });
    const execute = screen.getByRole("button", { name: `Execute ${item.title}` });
    expect(plan).toBeDisabled();
    expect(execute).toBeDisabled();
    expect(plan).toHaveAccessibleDescription(/attach a solution/i);
    expect(execute).toHaveAccessibleDescription(/attach a solution/i);
  });

  /// Execute **is** the approval, pressed knowingly — not a bypass of it.
  /// `start_run` refuses an unapproved plan, and generating one clears the
  /// approval, so anything that ran straight after generating would be refused
  /// unless a person said go. This press is that person saying go.
  it("plans, approves and starts in one press", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([plan({ changesRequired: "Add POST /checkout" })]);
    mocked.generateChangePlan.mockResolvedValue({
      created: ["Shop API"],
      provider: "Claude",
      model: "m",
      reason: "within budget",
      blocked: null,
    });
    mocked.setPlanApproval.mockResolvedValue(undefined);
    mocked.startRun.mockResolvedValue({
      runId: 1,
      worktreePath: "/tmp/wt",
      briefPath: "b.md",
      branch: "feature/12",
      command: "claude \"Read b.md and implement it.\"",
      runStart: "",
    });
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    await user.click(await screen.findByRole("button", { name: `Execute ${item.title}` }));

    await waitFor(() => expect(mocked.generateChangePlan).toHaveBeenCalledWith(12));
    await waitFor(() => expect(mocked.setPlanApproval).toHaveBeenCalledWith(12, 3, true));
    await waitFor(() => expect(mocked.startRun).toHaveBeenCalledWith(12, 3));
  });

  /// A decline is the framework working, and it must stop the run rather than
  /// starting an agent on a plan the AI just said it could not write.
  it("does not start anything when the AI declines to plan", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([plan({ changesRequired: "something" })]);
    mocked.generateChangePlan.mockResolvedValue({
      created: [],
      provider: "Claude",
      model: "m",
      reason: "within budget",
      blocked: { reason: "no payment provider named", whatIsNeeded: "which one?", feedbackId: 3 },
    });
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    await user.click(await screen.findByRole("button", { name: `Execute ${item.title}` }));

    await waitFor(() => expect(mocked.generateChangePlan).toHaveBeenCalled());
    expect(mocked.setPlanApproval).not.toHaveBeenCalled();
    expect(mocked.startRun).not.toHaveBeenCalled();
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

    // One wording across every panel now, from `BlockedNote` — this used to
    // read "Stopped rather than inventing the rest" here and something
    // different in each of the other five.
    expect(
      await screen.findByText(/stopped rather than inventing the rest/),
    ).toBeInTheDocument();
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

  /// **What is no longer here.** The ticklist of affected Solutions, the
  /// per-Solution branch and tests, and the pictures all moved into the one
  /// block that is about that Solution — three places asking about one thing
  /// was the problem. They are covered in `WorkItemChanges.test.tsx`.
  it("no longer keeps a second place to say the same things", async () => {
    mocked.listWorkItemPlans.mockResolvedValue([plan({})]);
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    await screen.findByRole("button", { name: "What this changes" });
    expect(screen.queryByText("Solutions affected")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Shop Web is affected")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Changes required in Shop API"),
    ).not.toBeInTheDocument();
  });
});

describe("WorkItemBuildPlan approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listAiFeedback.mockResolvedValue([]);
    mocked.listWorkItemChanges.mockResolvedValue([]);
    mocked.changeKinds.mockResolvedValue([]);
    mocked.changeKindsForSolution.mockResolvedValue([]);
    mocked.solutionCatalogue.mockResolvedValue([]);
    mocked.writeWorkItemFiles.mockResolvedValue([]);
    mocked.updateWorkItem.mockResolvedValue(undefined);
  });

  /// Approving is what lets a run start, so an unapproved plan has to say that
  /// where the plan is read — not leave it to be discovered on a failed press.
  it("says an unapproved plan will not start a run", async () => {
    mocked.listWorkItemPlans.mockResolvedValue([plan({ approvedAt: 0 })]);
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    expect(await screen.findByText("Not approved")).toBeInTheDocument();
    expect(
      screen.getByText(/will not start until the plan is approved/),
    ).toBeInTheDocument();
  });

  /// Approval is per (work item, Solution) — one work item can touch three
  /// repositories and you may be ready to build in only one of them.
  it("approves that one Solution's plan", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([plan({ approvedAt: 0 })]);
    mocked.setPlanApproval.mockResolvedValue();
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    await user.click(await screen.findByLabelText("Approve the plan for Shop API"));

    await waitFor(() =>
      expect(mocked.setPlanApproval).toHaveBeenCalledWith(12, 3, true),
    );
  });

  /// Changing your mind before an agent starts has to be possible, so the same
  /// control goes both ways.
  it("withdraws approval again", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([plan({ approvedAt: 1_700_000_000_000 })]);
    mocked.setPlanApproval.mockResolvedValue();
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    expect(await screen.findByText("Approved")).toBeInTheDocument();
    // The warning is gone once it is approved.
    expect(
      screen.queryByText(/will not start until the plan is approved/),
    ).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Withdraw approval for Shop API"));
    await waitFor(() =>
      expect(mocked.setPlanApproval).toHaveBeenCalledWith(12, 3, false),
    );
  });

  /// **The wiring an optional prop hid.** `productId` is optional on
  /// WorkItemChanges, so leaving it off typechecked cleanly and shipped a
  /// feature that did nothing: the panel showed a Solution dropdown and no way
  /// to make one, which is the dead end it was built to remove. Asserting the
  /// form rather than the prop is what makes that impossible to miss again.
  it("offers to make a Solution, because the Product is passed down", async () => {
    const user = userEvent.setup();
    mocked.createSolutionWithStarter.mockResolvedValue({
      solutionId: 12,
      started: null,
    });
    mocked.listStarters.mockResolvedValue([]);
    mocked.listSolutions.mockResolvedValue([]);
    render(<WorkItemBuildPlan item={item} solutions={[]} />);

    // Making one is an answer to "which Solution?", so it is in that dropdown
    // rather than a button beside it that read as unrelated.
    await user.selectOptions(
      await screen.findByLabelText("Add a Solution to this work item"),
      "__new__",
    );
    await user.type(screen.getByLabelText("Solution name"), "Orders API");
    await user.click(screen.getByRole("button", { name: "Create Solution" }));

    // The Product comes from the work item, which is the wire that was missing.
    await waitFor(() =>
      expect(mocked.createSolutionWithStarter).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Orders API", productId: 7 }),
      ),
    );
  });

  /// The pair used to be written by pressing a button, which meant the files
  /// on disk were whatever the last person to remember had produced. An agent
  /// handed a brief three edits out of date builds the wrong thing.
  it("rewrites the .md and .json on every save, with no button to press", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([plan({})]);
    mocked.saveWorkItemPlan.mockResolvedValue();
    mocked.writeWorkItemFiles.mockResolvedValue([
      ".CoperativeAI/work-items/12-add-checkout.md",
      ".CoperativeAI/work-items/12-add-checkout.json",
    ]);
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    expect(
      screen.queryByLabelText("Write the files for Add checkout"),
    ).not.toBeInTheDocument();

    await user.type(
      await screen.findByLabelText("What needs to change in Shop API"),
      "Add the endpoint",
    );
    await user.tab();

    await waitFor(() => expect(mocked.writeWorkItemFiles).toHaveBeenCalledWith(12));
    expect(
      await screen.findByText(/Written on the last save: .*12-add-checkout\.json/),
    ).toBeInTheDocument();
  });

  /// The pair cannot be written before the Product has a folder. Saying
  /// nothing would leave somebody believing a file exists — and the record
  /// itself did save, so this is not an error on the field they just left.
  it("says so when the files could not be written, without failing the save", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([plan({})]);
    mocked.saveWorkItemPlan.mockResolvedValue();
    mocked.writeWorkItemFiles.mockRejectedValue(
      "'Shop App' has no folder yet — generate its framework files first",
    );
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    await user.type(
      await screen.findByLabelText("What needs to change in Shop API"),
      "Add the endpoint",
    );
    await user.tab();

    expect(await screen.findByText(/Not written — .*has no folder yet/)).toBeInTheDocument();
    expect(mocked.saveWorkItemPlan).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
