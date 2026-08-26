import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkItemChanges from "../../components/code/WorkItemChanges";
import type { Solution, WorkItemChange, WorkItemPlan } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listWorkItemChanges: vi.fn(),
    listWorkItemPlans: vi.fn(),
    addWorkItemChange: vi.fn(),
    addWorkItemChanges: vi.fn(),
    setWorkItemChangeDetail: vi.fn(),
    assignWorkItemChange: vi.fn(),
    attachSolutionToWorkItem: vi.fn(),
    detachWorkItemPlan: vi.fn(),
    saveWorkItemPlan: vi.fn(),
    setPlanApproval: vi.fn(),
    pickImages: vi.fn(),
    deleteWorkItemChange: vi.fn(),
    changeKinds: vi.fn(),
    changeKindsForSolution: vi.fn(),
    suggestChangeNames: vi.fn(),
    setChangeMockup: vi.fn(),
    listSolutions: vi.fn(),
    listStarters: vi.fn(),
    createSolutionWithStarter: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

/// The vocabulary the backend serves, cut down to what these tests exercise.
/// It is fetched rather than declared in the component, so it has to be here
/// too — a component that owned its own copy is the drift this replaced.
const VOCABULARY: backend.ChangeKindInfo[] = [
  { id: "screen", label: "Screen", heading: "Screens", group: "ui", groupLabel: "UI", example: "Basket" },
  { id: "component", label: "Component", heading: "Components", group: "ui", groupLabel: "UI", example: "PriceTag" },
  { id: "api", label: "Endpoint", heading: "Endpoints", group: "logic", groupLabel: "Logic", example: "POST /checkout" },
  { id: "service", label: "Service", heading: "Services", group: "logic", groupLabel: "Logic", example: "BasketService" },
  { id: "requestModel", label: "Incoming model", heading: "Incoming models", group: "models", groupLabel: "Models", example: "CheckoutRequest" },
  { id: "table", label: "Database table", heading: "Database tables", group: "models", groupLabel: "Models", example: "orders" },
];

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
  runCommand: null,
  startFrom: null,
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
  mockupPath: null,
  ...over,
});

describe("WorkItemChanges — Product's half", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listWorkItemChanges.mockResolvedValue([]);
    mocked.addWorkItemChange.mockResolvedValue(1);
    mocked.changeKinds.mockResolvedValue(VOCABULARY);
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
    expect(screen.queryByLabelText("Solution 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Endpoints")).not.toBeInTheDocument();
  });

  it("shows where an assigned screen ended up", async () => {
    mocked.listWorkItemChanges.mockResolvedValue([change({ solutionId: 3 })]);
    render(<WorkItemChanges workItemId={9} mode="product" solutions={[solution()]} />);
    expect(await screen.findByText("→ Shop API")).toBeInTheDocument();
  });
});


const plan = (over: Partial<WorkItemPlan> = {}): WorkItemPlan => ({
  id: 21,
  workItemId: 9,
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
  approvedAt: 0,
  ...over,
});

describe("WorkItemChanges — the developer's half", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listWorkItemChanges.mockResolvedValue([]);
    mocked.listWorkItemPlans.mockResolvedValue([plan()]);
    mocked.addWorkItemChange.mockResolvedValue(1);
    mocked.addWorkItemChanges.mockResolvedValue([]);
    mocked.setWorkItemChangeDetail.mockResolvedValue(undefined);
    mocked.assignWorkItemChange.mockResolvedValue(undefined);
    mocked.attachSolutionToWorkItem.mockResolvedValue(1);
    mocked.detachWorkItemPlan.mockResolvedValue(undefined);
    mocked.saveWorkItemPlan.mockResolvedValue(undefined);
    mocked.setPlanApproval.mockResolvedValue(undefined);
    mocked.changeKinds.mockResolvedValue(VOCABULARY);
    mocked.changeKindsForSolution.mockResolvedValue([
      "api",
      "service",
      "requestModel",
      "table",
    ]);
    mocked.suggestChangeNames.mockResolvedValue([]);
  });

  /// The kinds come from the backend, not from a list in the component — two
  /// copies of that rule would drift, and the drift would only show as a
  /// rejected save. And they are grouped, because "UI, logic and models" is
  /// not three words: what those families contain depends on what is built.
  it("offers only the kinds the Solution's type can carry, in families", async () => {
    render(<WorkItemChanges workItemId={9} mode="developer" solutions={[solution()]} />);

    expect(
      await screen.findByLabelText("Endpoint changes in Shop API"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Incoming model changes in Shop API")).toBeInTheDocument();
    expect(screen.getByLabelText("Database table changes in Shop API")).toBeInTheDocument();
    // an API has no screens, so neither the kind nor its family appears
    expect(screen.queryByLabelText("Screen changes in Shop API")).not.toBeInTheDocument();
    expect(screen.queryByText("UI")).not.toBeInTheDocument();
    expect(screen.getByText("Logic")).toBeInTheDocument();
    expect(screen.getByText("Models")).toBeInTheDocument();
  });

  /// **The ticklist that only existed to make another section appear.** A
  /// Solution is affected because somebody said what changes in it, so picking
  /// it here attaches it — there is no second list to keep in step.
  it("attaches a Solution by picking it, with no separate ticklist", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([]);
    render(
      <WorkItemChanges
        workItemId={9}
        mode="developer"
        solutions={[solution(), solution({ id: 5, name: "Shop Web", solutionType: "website" })]}
      />,
    );

    await user.selectOptions(
      await screen.findByLabelText("Add a Solution to this work item"),
      "5",
    );

    await waitFor(() => expect(mocked.attachSolutionToWorkItem).toHaveBeenCalledWith(9, 5));
    expect(screen.queryByText("Solutions affected")).not.toBeInTheDocument();
  });

  /// Everything about one Solution in one block: what changes, what has to
  /// happen, what proves it, and where it lands. It used to be three sections.
  it("keeps the branch, the tests and the sentence in the Solution's block", async () => {
    const user = userEvent.setup();
    render(<WorkItemChanges workItemId={9} mode="developer" solutions={[solution()]} />);

    await user.type(
      await screen.findByLabelText("Branch name for Shop API"),
      "feature/9-checkout",
    );
    await user.tab();
    await waitFor(() =>
      expect(mocked.saveWorkItemPlan).toHaveBeenCalledWith(
        expect.objectContaining({ id: 21, branchName: "feature/9-checkout" }),
      ),
    );

    await user.type(screen.getByLabelText("Unit tests for Shop API"), "It charges once");
    await user.tab();
    await waitFor(() =>
      expect(mocked.saveWorkItemPlan).toHaveBeenCalledWith(
        expect.objectContaining({ unitTests: "It charges once" }),
      ),
    );
  });

  /// **One box, three destinations.** The plan's own note, the detail against
  /// each thing just named, and a new dated set on the work item.
  it("writes the one sentence to the plan and up to the work item", async () => {
    const user = userEvent.setup();
    const notes: string[] = [];
    mocked.listWorkItemChanges.mockResolvedValue([
      change({ id: 4, kind: "api", name: "POST /checkout", solutionId: 3 }),
    ]);
    render(
      <WorkItemChanges
        workItemId={9}
        mode="developer"
        solutions={[solution()]}
        onNote={(n) => notes.push(n)}
      />,
    );

    await user.type(
      await screen.findByLabelText("What needs to change in Shop API"),
      "Must be idempotent",
    );
    await user.tab();

    await waitFor(() =>
      expect(mocked.saveWorkItemPlan).toHaveBeenCalledWith(
        expect.objectContaining({ changesRequired: "Must be idempotent" }),
      ),
    );
    expect(notes[0]).toContain("Shop API");
    expect(notes[0]).toContain("Must be idempotent");
  });

  /// **The dropdown that asked a question the app could answer.** A name the
  /// Solution already has is being changed; anything else is new. Asking meant
  /// a wrong answer was one mis-click away.
  it("works out new from existing rather than asking", async () => {
    const user = userEvent.setup();
    mocked.suggestChangeNames.mockResolvedValue([
      { name: "POST /checkout", foundIn: "recorded" },
    ]);
    mocked.addWorkItemChanges.mockResolvedValue([
      { kind: "api", name: "POST /checkout", id: 11, refused: null },
      { kind: "api", name: "POST /refund", id: 12, refused: null },
    ]);
    render(<WorkItemChanges workItemId={9} mode="developer" solutions={[solution()]} />);

    await user.click(await screen.findByLabelText("Endpoint changes in Shop API"));
    expect(screen.queryByLabelText("New or existing in Shop API")).not.toBeInTheDocument();

    await user.type(
      await screen.findByLabelText("Endpoints in Shop API"),
      "POST /checkout\nPOST /refund",
    );
    await user.tab();

    await waitFor(() =>
      expect(mocked.addWorkItemChanges).toHaveBeenCalledWith(9, [
        // it already exists, so this is a change to it
        { solutionId: 3, kind: "api", action: "change", name: "POST /checkout", detail: "" },
        // nothing knows this one, so it is new
        { solutionId: 3, kind: "api", action: "add", name: "POST /refund", detail: "" },
      ]),
    );
  });

  /// A name read off the disk is a guess at what the team calls that file, and
  /// a guess presented as a fact is how a plan names a file, not a feature.
  it("says where each suggestion came from", async () => {
    const user = userEvent.setup();
    mocked.suggestChangeNames.mockResolvedValue([
      { name: "POST /checkout", foundIn: "recorded" },
      { name: "refund", foundIn: "src/handlers" },
    ]);
    render(<WorkItemChanges workItemId={9} mode="developer" solutions={[solution()]} />);

    await user.click(await screen.findByLabelText("Endpoint changes in Shop API"));

    expect(await screen.findByText("recorded")).toBeInTheDocument();
    expect(screen.getByText("src/handlers")).toBeInTheDocument();
  });

  /// Nothing said in the rules about where a kind lives means nothing is
  /// scanned — and that is said, rather than looking like a broken search.
  it("points at the Develop rules when it has nothing to suggest", async () => {
    const user = userEvent.setup();
    render(<WorkItemChanges workItemId={9} mode="developer" solutions={[solution()]} />);

    await user.click(await screen.findByLabelText("Endpoint changes in Shop API"));

    expect(
      await screen.findByText(/Say where endpoints live in the Develop rules/),
    ).toBeInTheDocument();
  });

  /// Pictures come out when the block is about something somebody looks at,
  /// and not on a block of endpoints and tables where "add a picture" is a
  /// question with no answer.
  it("offers UI pictures once a screen or component is ticked", async () => {
    const user = userEvent.setup();
    mocked.changeKindsForSolution.mockResolvedValue(["screen", "component", "service"]);
    mocked.listWorkItemPlans.mockResolvedValue([
      plan({ solutionId: 5, solutionName: "Shop Web" }),
    ]);
    render(
      <WorkItemChanges
        workItemId={9}
        mode="developer"
        solutions={[solution({ id: 5, name: "Shop Web", solutionType: "website" })]}
      />,
    );

    await screen.findByLabelText("Service changes in Shop Web");
    expect(screen.queryByLabelText("Add UI pictures for Shop Web")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Screen changes in Shop Web"));
    expect(
      await screen.findByLabelText("Add UI pictures for Shop Web"),
    ).toBeInTheDocument();
  });

  /// Which picture is which screen, in the block that says the screen changes
  /// — the pairing used to happen in a section nowhere near it.
  it("pairs a picture with the screen it shows, in the same block", async () => {
    const user = userEvent.setup();
    mocked.changeKindsForSolution.mockResolvedValue(["screen"]);
    mocked.listWorkItemChanges.mockResolvedValue([
      change({ id: 4, kind: "screen", name: "Basket", solutionId: 5 }),
    ]);
    mocked.listWorkItemPlans.mockResolvedValue([
      plan({
        solutionId: 5,
        solutionName: "Shop Web",
        mockups: JSON.stringify(["C:/shots/basket.png"]),
      }),
    ]);
    mocked.setChangeMockup.mockResolvedValue(undefined);
    render(
      <WorkItemChanges
        workItemId={9}
        mode="developer"
        solutions={[solution({ id: 5, name: "Shop Web", solutionType: "website" })]}
      />,
    );

    // shown by file name, not by the folder it happens to live in
    const picker = await screen.findByLabelText("Mockup for Basket");
    expect(screen.getByRole("option", { name: "basket.png" })).toBeInTheDocument();

    await user.selectOptions(picker, "C:/shots/basket.png");
    await waitFor(() =>
      expect(mocked.setChangeMockup).toHaveBeenCalledWith(4, "C:/shots/basket.png"),
    );
  });

  /// Approval is a statement about the text you have just read, so it lives
  /// with it rather than beside a Start button on another screen.
  it("approves the plan from the Solution's own block", async () => {
    const user = userEvent.setup();
    render(<WorkItemChanges workItemId={9} mode="developer" solutions={[solution()]} />);

    await user.click(await screen.findByLabelText("Approve the plan for Shop API"));
    await waitFor(() => expect(mocked.setPlanApproval).toHaveBeenCalledWith(9, 3, true));
  });

  /// A duplicate among eight is the ordinary case: the other seven still land,
  /// and the one that did not is named rather than swallowed.
  it("names what the backend refused without losing the rest", async () => {
    const user = userEvent.setup();
    mocked.addWorkItemChanges.mockResolvedValue([
      {
        kind: "api",
        name: "POST /checkout",
        id: null,
        refused: "'POST /checkout' is already on this work item for that Solution",
      },
      { kind: "api", name: "POST /refund", id: 12, refused: null },
    ]);
    render(<WorkItemChanges workItemId={9} mode="developer" solutions={[solution()]} />);

    await user.click(await screen.findByLabelText("Endpoint changes in Shop API"));
    await user.type(
      await screen.findByLabelText("Endpoints in Shop API"),
      "POST /checkout\nPOST /refund",
    );
    await user.tab();

    const refused = await screen.findByLabelText("Not recorded");
    expect(refused).toHaveTextContent(/POST \/checkout: .*already on this work item/);
    expect(refused).not.toHaveTextContent("POST /refund");
  });

  /// A developer who reaches "which Solution does this land in?" and finds the
  /// answer is "one nobody has made yet" should not have to leave the work
  /// item. It is an answer, so it sits in the list of answers.
  it("offers making a Solution from inside the dropdown", async () => {
    const user = userEvent.setup();
    mocked.listWorkItemPlans.mockResolvedValue([]);
    mocked.listStarters.mockResolvedValue([]);
    render(
      <WorkItemChanges
        workItemId={9}
        mode="developer"
        productId={1}
        solutions={[solution()]}
      />,
    );

    await user.selectOptions(
      await screen.findByLabelText("Add a Solution to this work item"),
      "__new__",
    );

    expect(await screen.findByRole("form", { name: "New Solution" })).toBeInTheDocument();
    // every type the backend knows, and a language — the cut-down version this
    // replaced offered "service" and "library", which the backend rejects
    for (const type of ["website", "api", "database", "application"]) {
      expect(screen.getByRole("option", { name: type })).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Starter language")).toBeInTheDocument();
  });

  /// Without the Product there is nothing a new Solution could belong to, so
  /// the offer is not made rather than made and then refused.
  it("does not offer to make one when the Product was not passed down", async () => {
    render(<WorkItemChanges workItemId={9} mode="developer" solutions={[solution()]} />);
    await screen.findByLabelText("Add a Solution to this work item");
    expect(
      screen.queryByRole("option", { name: "＋ New Solution…" }),
    ).not.toBeInTheDocument();
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
    render(<WorkItemChanges workItemId={9} mode="developer" solutions={[solution()]} />);

    await user.selectOptions(await screen.findByLabelText("Solution for Basket"), "3");

    expect(await screen.findByRole("alert")).toHaveTextContent(/does not carry those/);
  });

  /// The row labels come from the fetched vocabulary, so a kind this build has
  /// never heard of still shows what it is rather than a blank.
  it("labels a kind it does not recognise as itself", async () => {
    mocked.listWorkItemChanges.mockResolvedValue([
      change({ id: 7, kind: "hologram", name: "Deck", solutionId: 3 }),
    ]);
    render(<WorkItemChanges workItemId={9} mode="developer" solutions={[solution()]} />);
    expect(await screen.findByText("hologram")).toBeInTheDocument();
  });
});
