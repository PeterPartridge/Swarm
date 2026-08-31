import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkItemBuildPlan, {
  whatIsMissing,
} from "../../components/planning/WorkItemBuildPlan";
import { isPlanned } from "../../lib/plan";
import { notifyWorkChanged } from "../../lib/workSignal";
import { clearFailure, useLastFailure } from "../../lib/failures";

/** Reads the shared failure channel the ship rail shows, so a test can assert
 *  what reached it without rendering the Build view around this panel. */
function Probe() {
  const failure = useLastFailure();
  return (
    <span data-testid="probe">
      {failure ? `${failure.what}: ${failure.message}` : ""}
    </span>
  );
}
import type { Solution, WorkItem, WorkItemPlan } from "../../lib/backend";

// Stubbed: it opens a real PTY, and what these tests are about is whether
// Execute opens one at all and with what.
vi.mock("../../components/code/RunTerminal", () => ({
  default: ({ command, title }: { command: string; title: string }) => (
    <div>
      terminal for {title}: {command}
    </div>
  ),
}));

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    // The lifecycle panel hangs off every work item now. Unmocked these fall
    // through to the real invoke and each renders its own error alert.
    lifecycleGates: vi.fn(),
    listLifecycleSteps: vi.fn(),
    listWorkItemSteps: vi.fn(),
    setWorkItemStep: vi.fn(),
    logEvent: vi.fn(),
    listWorkItemPlans: vi.fn(),
    // The build plan now embeds WorkItemChanges. Leaving these unmocked lets
    // them fall through to the real invoke, which renders an error alert and
    // quietly breaks assertions about what else is on screen.
    // The Solution git panel sits in every change block now. Unmocked it falls
    // through to the real invoke and adds a second role="alert" to the page.
    solutionGitState: vi.fn(),
    githubStatus: vi.fn(),
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
    listAiJobs: vi.fn(),
    checkItemAiPermission: vi.fn(),
    askProductQuestion: vi.fn(),
    resolveAiFeedback: vi.fn(),
    pickImages: vi.fn(),
    setPlanApproval: vi.fn(),
    startRun: vi.fn(),
    createSolution: vi.fn(),
    listSolutions: vi.fn(),
    initSolutionRepo: vi.fn(),
    linkSolutionRepo: vi.fn(),
    createSolutionRepo: vi.fn(),
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
    mocked.logEvent.mockResolvedValue(undefined);
    mocked.lifecycleGates.mockResolvedValue([]);
    mocked.listLifecycleSteps.mockResolvedValue([]);
    mocked.listWorkItemSteps.mockResolvedValue([]);
    mocked.setWorkItemStep.mockResolvedValue(undefined);
    mocked.listWorkItemPlans.mockResolvedValue([]);
    mocked.listAiFeedback.mockResolvedValue([]);
    mocked.listAiJobs.mockResolvedValue([]);
    // Permitted by default in these tests: the deny-by-default rule has its own
    // assertions, and leaving it null here would block every other one.
    mocked.checkItemAiPermission.mockResolvedValue({
      allowed: true,
      reason: "",
      hasProvider: true,
    });
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
    await screen.findByLabelText("Plan Add checkout");

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
  it("presses, and says why it will not run yet", async () => {
    const user = userEvent.setup();
    render(
      <>
        <WorkItemBuildPlan item={item} solutions={solutions} />
        <Probe />
      </>,
    );

    const execute = await screen.findByRole("button", { name: `Execute ${item.title}` });
    // **A disabled button eats the click.** These greyed out when something was
    // missing, and a press then produced no plan, no error and no reason —
    // which is what "I clicked it and nothing happened" has meant every time it
    // has been reported. They press now, and refuse out loud.
    expect(execute).toBeEnabled();
    expect(execute).toHaveAccessibleDescription(/no Solution is attached/i);

    await user.click(execute);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no Solution is attached/i,
    );
    // And it reaches the rail, like every other refusal.
    expect(screen.getByTestId("probe")).toHaveTextContent(/no Solution is attached/i);
    expect(mocked.generateChangePlan).not.toHaveBeenCalled();
  });

  /// **Every reason, not just the first.** Discovering the next blocker each
  /// time you fix one is how a form makes somebody give up; listed together,
  /// they are fixed in a single pass.
  it("lists everything missing, not only the first thing", () => {
    const bare = { ...item, description: null };
    const allowed = { allowed: true, reason: "", hasProvider: true };

    // **Deny-by-default, said before the press.** The backend refuses an item
    // nobody has permitted, which is the rule working — but learning that from
    // a failed job in the queue is the long way round.
    // **The refusal is the backend's own words**, asked of the same walk the
    // gate uses — so the button and the backend cannot disagree about what is
    // permitted, which is how a screen ends up blocking work the backend would
    // have allowed.
    expect(
      whatIsMissing(item, [plan({ changesRequired: "x" })], {
        allowed: false,
        reason: "Nobody has said the AI may read this work.",
        hasProvider: false,
      }).join(" "),
    ).toMatch(/Nobody has said/i);

    // Permitted, but with nothing to send to.
    expect(
      whatIsMissing(item, [plan({ changesRequired: "x" })], {
        ...allowed,
        hasProvider: false,
      }).join(" "),
    ).toMatch(/no provider is named/i);

    expect(whatIsMissing(bare, [], allowed)).toHaveLength(2);
    expect(whatIsMissing(bare, [], allowed).join(" ")).toMatch(/described/i);
    expect(whatIsMissing(bare, [], allowed).join(" ")).toMatch(/no Solution/i);

    // A Solution attached, but nobody has said what changes in it.
    expect(whatIsMissing(item, [plan({})], allowed)).toEqual([
      expect.stringMatching(/nothing is written about what has to change/i),
    ]);

    // Described, attached, and written about: ready.
    expect(whatIsMissing(item, [plan({ changesRequired: "Add POST /checkout" })], allowed)).toEqual([]);
  });

  /// **The panel used to look identical before, during and after planning.**
  /// Planning is queued and runs elsewhere, so pressing Plan and seeing nothing
  /// change was indistinguishable from pressing a dead button — which is what
  /// it was reported as.
  it("says when planning is queued, running, and how it ended", async () => {
    const queued = {
      id: 1,
      workItemId: 12,
      workItemTitle: "Add checkout",
      purpose: "changePlan",
      state: "queued" as const,
      message: "",
      submittedAt: 10,
      startedAt: null,
      finishedAt: null,
    };
    mocked.listWorkItemPlans.mockResolvedValue([plan({ changesRequired: "x" })]);

    // Three fresh mounts rather than rerenders: in the app the panel re-reads
    // because the backend emits `ai-job-changed`, and a rerender with the same
    // props would not re-fetch — testing that would prove nothing about how the
    // state actually arrives.
    mocked.listAiJobs.mockResolvedValue([queued]);
    const first = render(<WorkItemBuildPlan item={item} solutions={solutions} />);
    expect(await screen.findByText(/Queued for planning/)).toBeInTheDocument();
    // Not plannable twice: a second submission while one runs plans the same
    // item again and pays for it again.
    // Not plannable twice — but said, not swallowed: pressing while one is in
    // flight answers with the job that is already there.
    await userEvent.click(screen.getByRole("button", { name: `Execute ${item.title}` }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already a queued job/i);
    first.unmount();

    mocked.listAiJobs.mockResolvedValue([{ ...queued, state: "running" as const }]);
    const second = render(<WorkItemBuildPlan item={item} solutions={solutions} />);
    expect(await screen.findByText(/Planning now/)).toBeInTheDocument();
    second.unmount();

    // A failure says why, where the person is, rather than only in the queue.
    mocked.listAiJobs.mockResolvedValue([
      { ...queued, state: "failed" as const, message: "no AI policy on this item" },
    ]);
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);
    // Reported as the last attempt, not as the current state: Plan is available
    // again the moment it ends.
    expect(
      await screen.findByText(/last planning attempt failed: no AI policy/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Plan ${item.title}` })).toBeEnabled();
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
      await screen.findByLabelText("Execute Add checkout"),
    );

    await waitFor(() => expect(mocked.generateChangePlan).toHaveBeenCalledWith(12));

    // The plan is read on its own tab — the thing being approved gets a place
    // of its own rather than three <pre> blocks under the boxes people type in.
    await user.click(screen.getByRole("button", { name: "AI planning" }));
    const schemas = await screen.findByRole("region", {
      name: "AI plan for Shop API",
    });
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
      await screen.findByLabelText("Execute Add checkout"),
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
  it("will not generate before a Solution is affected", async () => {
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);
    await userEvent.click(await screen.findByLabelText("Execute Add checkout"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /No Solution is attached/i,
    );
    expect(mocked.generateChangePlan).not.toHaveBeenCalled();
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
    mocked.logEvent.mockResolvedValue(undefined);
    mocked.lifecycleGates.mockResolvedValue([]);
    mocked.listLifecycleSteps.mockResolvedValue([]);
    mocked.listWorkItemSteps.mockResolvedValue([]);
    mocked.setWorkItemStep.mockResolvedValue(undefined);
    mocked.listAiFeedback.mockResolvedValue([]);
    mocked.listAiJobs.mockResolvedValue([]);
    // Permitted by default in these tests: the deny-by-default rule has its own
    // assertions, and leaving it null here would block every other one.
    mocked.checkItemAiPermission.mockResolvedValue({
      allowed: true,
      reason: "",
      hasProvider: true,
    });
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

describe("once there is a plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.logEvent.mockResolvedValue(undefined);
    mocked.lifecycleGates.mockResolvedValue([]);
    mocked.listLifecycleSteps.mockResolvedValue([]);
    mocked.listWorkItemSteps.mockResolvedValue([]);
    mocked.setWorkItemStep.mockResolvedValue(undefined);
    // The failure channel is module state — one test's failure would otherwise
    // still be showing in the next.
    clearFailure();
    mocked.listAiFeedback.mockResolvedValue([]);
    mocked.listAiJobs.mockResolvedValue([]);
    mocked.checkItemAiPermission.mockResolvedValue({
      allowed: true,
      reason: "",
      hasProvider: true,
    });
    mocked.listWorkItemChanges.mockResolvedValue([]);
    mocked.changeKinds.mockResolvedValue([]);
    mocked.changeKindsForSolution.mockResolvedValue([]);
    mocked.solutionCatalogue.mockResolvedValue([]);
    mocked.writeWorkItemFiles.mockResolvedValue([]);
    mocked.updateWorkItem.mockResolvedValue(undefined);
    mocked.setPlanApproval.mockResolvedValue(undefined);
    mocked.startRun.mockResolvedValue({
      runId: 1,
      worktreePath: "/tmp/wt",
      briefPath: "b.md",
      branch: "feature/12",
      command: "claude \"Read b.md and implement it.\"",
      runStart: "",
    });
  });

  const planned = plan({
    changesRequired: "Add POST /checkout",
    filesToChange: "src/api/checkout.rs (the endpoint)",
  });

  it("knows a plan when every Solution has one", () => {
    expect(isPlanned([])).toBe(false);
    expect(isPlanned([plan({ changesRequired: "x" })])).toBe(false);
    expect(isPlanned([planned])).toBe(true);
    // One Solution planned and one not is not a planned work item: executing
    // would start an agent on the unplanned half with nothing to build from.
    expect(isPlanned([planned, plan({ id: 2, solutionId: 4 })])).toBe(false);
  });

  /// Planning again is what the AI planning tab is for. Leaving Plan beside
  /// Execute after it has succeeded offers to pay for the same thing twice.
  it("offers only Execute", async () => {
    mocked.listWorkItemPlans.mockResolvedValue([planned]);
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    expect(
      await screen.findByRole("button", { name: `Execute ${item.title}` }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: `Plan ${item.title}` }),
    ).not.toBeInTheDocument();
  });

  /// **The plan on screen is the plan that runs.** Regenerating first would
  /// throw away what somebody just read — and possibly edited — and charge for
  /// the privilege.
  it("runs the plan that is there rather than making it again", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([planned]);
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    await user.click(await screen.findByLabelText(`Execute ${item.title}`));

    await waitFor(() => expect(mocked.startRun).toHaveBeenCalledWith(12, 3));
    expect(mocked.setPlanApproval).toHaveBeenCalledWith(12, 3, true);
    expect(mocked.generateChangePlan).not.toHaveBeenCalled();
  });

  /// **"Execute is not working" — and it was, right up to the last step.** It
  /// approved the plan, made the worktree and wrote the brief, then threw the
  /// result away: `start_run` *prepares* a checkout and hands back the command,
  /// and the caller is what runs it. The Runs panel had always done that; this
  /// press had not, so no agent was ever started and the screen showed nothing
  /// — while the notice claimed one was working.
  it("starts the agent in the checkout, not just the checkout", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([planned]);
    mocked.startRun.mockResolvedValue({
      runId: 4,
      worktreePath: "C:/wt/checkout",
      briefPath: ".coperativeai/briefs/add-checkout.md",
      branch: "feature/12-add-checkout",
      command: 'claude "Read .coperativeai/briefs/add-checkout.md and implement it."',
      runStart: "",
    });
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    await user.click(await screen.findByLabelText(`Execute ${item.title}`));

    const terminal = await screen.findByText(/terminal for/);
    expect(terminal).toHaveTextContent(/Shop API/);
    expect(terminal).toHaveTextContent(/claude "Read/);
  });

  /// **One work item, two repositories, and only one of them broken.** The loop
  /// stopped at the first refusal, so a Solution that started fine was never
  /// mentioned and the ones after it were never tried — and the press read as a
  /// total failure when it was a partial one. Every Solution is attempted now,
  /// and the message says both halves.
  it("starts what it can and names the Solution that refused", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([
      planned,
      plan({ id: 2, solutionId: 4, solutionName: "Shop Web", filesToChange: "a.ts (x)" }),
    ]);
    mocked.startRun.mockImplementation(async (_item: number, solutionId: number) => {
      if (solutionId === 4) {
        throw "'Shop Web' has no folder on this machine, so there is nothing to make a worktree from";
      }
      return {
        runId: 1,
        worktreePath: "/tmp/wt",
        briefPath: "b.md",
        branch: "feature/12",
        command: "claude",
        runStart: "",
      };
    });
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    await user.click(await screen.findByLabelText(`Execute ${item.title}`));

    // The one that worked is not lost in the one that did not.
    await waitFor(() => expect(mocked.startRun).toHaveBeenCalledTimes(2));
    const failure = await screen.findByRole("alert");
    expect(failure).toHaveTextContent(/Shop Web/);
    expect(failure).toHaveTextContent(/no folder on this machine/);
    expect(screen.getByRole("status")).toHaveTextContent(/Shop API/);
  });


  /// **"I pressed Execute and nothing happened."** The message was there and
  /// then it was not: `refresh` cleared the panel's one error state, and it runs
  /// on every work-changed signal — a job finishing anywhere in the Product, a
  /// save in the changes block below, this panel's own reload after the press. A
  /// failure that erases itself within a second is indistinguishable from a
  /// button that does nothing.
  it("keeps what went wrong on screen when something else reloads the panel", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([planned]);
    mocked.startRun.mockRejectedValue(
      "'Shop API' is not a git repository, so there is no branch to cut a checkout from.",
    );
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    const button = await screen.findByLabelText(`Execute ${item.title}`);
    expect(button).toBeEnabled();
    await user.click(button);
    expect(mocked.startRun).toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/not a git repository/);

    // Anything at all re-reads the panel — this is the queue announcing a job.
    notifyWorkChanged();
    await waitFor(() =>
      expect(mocked.listWorkItemPlans.mock.calls.length).toBeGreaterThan(1),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/not a git repository/);
  });

});

/// **Where the "not a git repository" error is answered.** Everything the panel
/// offers — plan, execute, a branch cut from `main` — assumes the Solution's
/// folder is a repository, and until now the only way to find out it was not
/// was to press Execute and read a red box with no way forward in it.
describe("the Git tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.logEvent.mockResolvedValue(undefined);
    mocked.lifecycleGates.mockResolvedValue([]);
    mocked.listLifecycleSteps.mockResolvedValue([]);
    mocked.listWorkItemSteps.mockResolvedValue([]);
    mocked.setWorkItemStep.mockResolvedValue(undefined);
    mocked.listAiFeedback.mockResolvedValue([]);
    mocked.listAiJobs.mockResolvedValue([]);
    mocked.checkItemAiPermission.mockResolvedValue({
      allowed: true,
      reason: "",
      hasProvider: true,
    });
    mocked.listWorkItemChanges.mockResolvedValue([]);
    mocked.changeKinds.mockResolvedValue([]);
    mocked.changeKindsForSolution.mockResolvedValue([]);
    mocked.solutionCatalogue.mockResolvedValue([]);
    mocked.writeWorkItemFiles.mockResolvedValue([]);
    mocked.updateWorkItem.mockResolvedValue(undefined);
    mocked.listWorkItemPlans.mockResolvedValue([plan()]);
    mocked.githubStatus.mockResolvedValue({ connected: true });
    mocked.solutionGitState.mockResolvedValue({
      localPath: "C:/repo/shop-api",
      isRepo: false,
      hasCommit: false,
      branch: "",
      githubUrl: null,
      githubVisibility: null,
    });
    mocked.initSolutionRepo.mockResolvedValue("it is a git repository now");
  });

  it("shows each attached Solution's repository, and offers to create one", async () => {
    const user = userEvent.setup();
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    await user.click(await screen.findByRole("button", { name: "Git" }));

    const panel = await screen.findByRole("region", { name: "Repository for Shop API" });
    expect(panel).toHaveTextContent(/not a git repository/i);
    await user.click(
      within(panel).getByRole("button", { name: "Make Shop API a git repository" }),
    );
    await waitFor(() => expect(mocked.initSolutionRepo).toHaveBeenCalledWith(3));
  });

  it("says there is nothing to set up until a Solution is attached", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([]);
    render(<WorkItemBuildPlan item={item} solutions={solutions} />);

    await user.click(await screen.findByRole("button", { name: "Git" }));
    expect(
      await screen.findByText(/No Solution is attached/i),
    ).toBeInTheDocument();
  });
});


  /// **A decline is the AI error.** It came back as a result rather than an
  /// exception, so it went to the notice inside this panel and nowhere else —
  /// the one kind of failure that is entirely the AI's, missing from the box
  /// built for showing failures.
  it("puts the AI's refusal on the rail as well as in the panel", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([plan({ changesRequired: "x" })]);
    mocked.generateChangePlan.mockResolvedValue({
      created: [],
      provider: "Claude",
      model: "m",
      reason: "within budget",
      blocked: {
        reason: "Two Solutions claim the same endpoint",
        whatIsNeeded: "say which one owns it",
        feedbackId: 3,
      },
    });
    render(
      <>
        <WorkItemBuildPlan item={item} solutions={solutions} />
        <Probe />
      </>,
    );

    await user.click(await screen.findByLabelText(`Execute ${item.title}`));

    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent(
        /Two Solutions claim the same endpoint/,
      ),
    );
    expect(screen.getByTestId("probe")).toHaveTextContent(/say which one owns it/);
  });

  /// **Planning runs in the queue, so its failure is nobody's press.** Nothing
  /// caught it, so nothing reported it, and the rail stayed empty while the job
  /// that was meant to produce the plan had failed.
  it("puts a queued job's failure on the rail when it comes back", async () => {
    mocked.listWorkItemPlans.mockResolvedValue([plan({ changesRequired: "x" })]);
    mocked.listAiJobs.mockResolvedValue([]);
    render(
      <>
        <WorkItemBuildPlan item={item} solutions={solutions} />
        <Probe />
      </>,
    );
    await screen.findByLabelText(`Plan ${item.title}`);

    // The queue announces the job it just finished.
    mocked.listAiJobs.mockResolvedValue([
      {
        id: 8,
        workItemId: 12,
        workItemTitle: "Add checkout",
        purpose: "changePlan",
        state: "failed",
        message: "the AI provider has no models configured",
        submittedAt: 1,
        startedAt: null,
        finishedAt: 2,
      },
    ]);
    notifyWorkChanged();

    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent(/no models configured/),
    );
  });
