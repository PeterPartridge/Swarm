import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlanningBoard from "../../components/PlanningBoard";
import type { Solution, Sprint, TeamMember, WorkItem } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listWorkItems: vi.fn(),
    createWorkItem: vi.fn(),
    updateWorkItemStatus: vi.fn(),
    updateWorkItem: vi.fn(),
    deleteWorkItem: vi.fn(),
    generateUserStories: vi.fn(),
    listAiFeedback: vi.fn(),
    resolveAiFeedback: vi.fn(),
    getPlanningHierarchy: vi.fn(),
    listTeamMembers: vi.fn(),
    listSprints: vi.fn(),
    getWorkItemPolicy: vi.fn(),
    setWorkItemPolicy: vi.fn(),
    listAiProviders: vi.fn(),
    listDeliverables: vi.fn(),
    listSolutions: vi.fn(),
    listWorkItemLinks: vi.fn(),
    linkWorkItems: vi.fn(),
    unlinkWorkItems: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

function item(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: 1,
    title: "Checkout",
    itemType: "feature",
    status: "planned",
    description: null,
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
    ...overrides,
  };
}

function solution(id: number, name: string, productId: number): Solution {
  return {
    id,
    name,
    productId,
    solutionType: "api",
    answers: "{}",
    origin: "created",
    githubUrl: null,
    githubVisibility: null,
    localPath: null,
    testCommand: null,
    language: null,
  };
}

const member: TeamMember = { id: 5, name: "Ada", roleId: null };
const sprint: Sprint = {
  id: 9,
  productId: 7,
  name: "Sprint 1",
  startDate: null,
  endDate: null,
};

describe("PlanningBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listWorkItems.mockResolvedValue([item({})]);
    mocked.getPlanningHierarchy.mockResolvedValue([
      "epic",
      "feature",
      "userStory",
      "task",
    ]);
    mocked.listTeamMembers.mockResolvedValue([member]);
    mocked.listSprints.mockResolvedValue([sprint]);
    mocked.listDeliverables.mockResolvedValue([]);
    mocked.listSolutions.mockResolvedValue([]);
    mocked.listWorkItemLinks.mockResolvedValue([]);
    mocked.getWorkItemPolicy.mockResolvedValue(null);
    mocked.listAiFeedback.mockResolvedValue([]);
    mocked.listAiProviders.mockResolvedValue([
      {
        id: 3,
        name: "Claude",
        apiBaseUrl: "https://api.anthropic.com",
        models: ["claude-opus-4-8"],
        keyStored: true,
        kind: "anthropic",
        metered: true,
      },
    ]);
  });

  it("restricts sub-item types to levels deeper than the parent (plus bug/test)", async () => {
    const user = userEvent.setup();
    render(<PlanningBoard productId={7} />);

    await user.click(
      await screen.findByRole("button", { name: "Add sub-item to Checkout" }),
    );
    const typeSelect = screen.getByLabelText("Sub-item type");
    const options = within(typeSelect)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["userStory", "task", "bug", "test"]);
  });

  it("creates a sub-item under its parent", async () => {
    const user = userEvent.setup();
    mocked.createWorkItem.mockResolvedValue(2);
    render(<PlanningBoard productId={7} />);

    await user.click(
      await screen.findByRole("button", { name: "Add sub-item to Checkout" }),
    );
    await user.type(screen.getByLabelText("Sub-item title"), "As a shopper...");
    await user.selectOptions(screen.getByLabelText("Sub-item type"), "userStory");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(mocked.createWorkItem).toHaveBeenCalledWith({
        title: "As a shopper...",
        itemType: "userStory",
        productId: 7,
        parentItemId: 1,
      }),
    );
  });

  it("assigns a team member and schedules into a sprint", async () => {
    const user = userEvent.setup();
    mocked.updateWorkItem.mockResolvedValue();
    render(<PlanningBoard productId={7} />);

    await user.selectOptions(
      await screen.findByLabelText("Assignee of Checkout"),
      "5",
    );
    await waitFor(() =>
      expect(mocked.updateWorkItem).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, assigneeId: 5, sprintId: null }),
      ),
    );

    await user.selectOptions(screen.getByLabelText("Sprint of Checkout"), "9");
    await waitFor(() =>
      expect(mocked.updateWorkItem).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1, sprintId: 9 }),
      ),
    );
  });

  it("shows cost/profit/chargeable fields and saves an edit (full-access default)", async () => {
    const user = userEvent.setup();
    mocked.updateWorkItem.mockResolvedValue();
    render(<PlanningBoard productId={7} />);

    // No permission provider in this test → full access → fields visible.
    const cost = await screen.findByLabelText("Expected cost of Checkout");
    await user.type(cost, "1200");
    await user.tab(); // commit on blur
    await waitFor(() =>
      expect(mocked.updateWorkItem).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1, expectedCost: 1200 }),
      ),
    );

    await user.click(screen.getByLabelText("Chargeable: Checkout"));
    await waitFor(() =>
      expect(mocked.updateWorkItem).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1, chargeable: true }),
      ),
    );
  });

  it("assigning a work item to a deliverable saves it", async () => {
    const user = userEvent.setup();
    mocked.updateWorkItem.mockResolvedValue();
    mocked.listDeliverables.mockResolvedValue([
      { id: 4, productId: 7, name: "MVP", description: "", dependsOnDeliverableId: null },
    ]);
    render(<PlanningBoard productId={7} />);

    await user.selectOptions(
      await screen.findByLabelText("Deliverable of Checkout"),
      "4",
    );
    await waitFor(() =>
      expect(mocked.updateWorkItem).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1, deliverableId: 4 }),
      ),
    );
  });

  /// Risk is free text: whatever the planner typed comes back unchanged.
  it("saves a risk in the planner's own words", async () => {
    const user = userEvent.setup();
    mocked.updateWorkItem.mockResolvedValue();
    render(<PlanningBoard productId={7} />);

    const risk = await screen.findByLabelText("Risk of Checkout");
    await user.type(risk, "the payments vendor may not sign off in time");
    await user.tab();
    await waitFor(() =>
      expect(mocked.updateWorkItem).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 1,
          risk: "the payments vendor may not sign off in time",
        }),
      ),
    );
  });

  /// A Product with no Solutions has nowhere for code to land, so the choice
  /// is not offered at all rather than offered empty.
  it("hides the Solution choice when the Product has none", async () => {
    render(<PlanningBoard productId={7} />);
    await screen.findByText("Checkout");
    expect(screen.queryByLabelText("Solution of Checkout")).not.toBeInTheDocument();
  });

  /// Work can only land in its own Product's Solution — the backend refuses
  /// anything else, so the board must not offer it. "No Solution" stays a real
  /// answer: plenty of work is not code.
  it("offers this Product's Solutions only", async () => {
    const user = userEvent.setup();
    mocked.updateWorkItem.mockResolvedValue();
    mocked.listSolutions.mockResolvedValue([
      solution(11, "API", 7),
      solution(12, "Someone else's", 99),
    ]);
    render(<PlanningBoard productId={7} />);

    const select = await screen.findByLabelText("Solution of Checkout");
    expect(within(select).getByRole("option", { name: "API" })).toBeInTheDocument();
    expect(
      within(select).queryByRole("option", { name: "Someone else's" }),
    ).not.toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "No Solution" })).toBeInTheDocument();

    await user.selectOptions(select, "11");
    await waitFor(() =>
      expect(mocked.updateWorkItem).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1, solutionId: 11 }),
      ),
    );
  });

  it("links one work item to another", async () => {
    const user = userEvent.setup();
    mocked.linkWorkItems.mockResolvedValue(1);
    mocked.listWorkItems.mockResolvedValue([
      item({}),
      item({ id: 2, title: "Call endpoint" }),
    ]);
    render(<PlanningBoard productId={7} />);

    await user.click(await screen.findByLabelText("Add dependency to Checkout"));
    await user.selectOptions(screen.getByLabelText("Dependency target for Checkout"), "2");
    await user.click(screen.getByLabelText("Save dependency for Checkout"));

    await waitFor(() =>
      expect(mocked.linkWorkItems).toHaveBeenCalledWith(1, 2, "blocks"),
    );
  });

  /// The case worth spotting: two items in different Solutions, and so in
  /// different repositories. Cross-repo is derived from the Solutions, never
  /// stored, so the board must say it rather than leave it to be worked out.
  it("names the other repository when a dependency crosses one", async () => {
    mocked.listSolutions.mockResolvedValue([
      solution(11, "API", 7),
      solution(12, "Web", 7),
    ]);
    mocked.listWorkItems.mockResolvedValue([
      item({ id: 1, title: "Add endpoint", solutionId: 11 }),
      item({ id: 2, title: "Call endpoint", solutionId: 12 }),
    ]);
    mocked.listWorkItemLinks.mockResolvedValue([
      { id: 30, fromWorkItemId: 1, toWorkItemId: 2, kind: "blocks" },
    ]);
    render(<PlanningBoard productId={7} />);

    const deps = await screen.findByRole("region", {
      name: "Dependencies of Add endpoint",
    });
    expect(within(deps).getByText(/blocks Call endpoint \(in Web\)/)).toBeInTheDocument();

    // and the same link, seen from the other end
    const incoming = screen.getByRole("region", {
      name: "Dependencies of Call endpoint",
    });
    expect(
      within(incoming).getByText(/Add endpoint blocks this \(in API\)/),
    ).toBeInTheDocument();
  });

  /// Work with no Solution is not cross-repo — most work is not code at all.
  it("does not claim a repository crossing when either item has no Solution", async () => {
    mocked.listSolutions.mockResolvedValue([solution(11, "API", 7)]);
    mocked.listWorkItems.mockResolvedValue([
      item({ id: 1, title: "Add endpoint", solutionId: 11 }),
      item({ id: 2, title: "Write the copy", solutionId: null }),
    ]);
    mocked.listWorkItemLinks.mockResolvedValue([
      { id: 30, fromWorkItemId: 1, toWorkItemId: 2, kind: "relatesTo" },
    ]);
    render(<PlanningBoard productId={7} />);

    const deps = await screen.findByRole("region", {
      name: "Dependencies of Add endpoint",
    });
    expect(within(deps).getByText("relates to Write the copy")).toBeInTheDocument();
  });

  /// The backend refuses a blocking loop; the board must show why rather than
  /// silently doing nothing.
  it("surfaces a refused blocking loop", async () => {
    const user = userEvent.setup();
    mocked.listWorkItems.mockResolvedValue([
      item({}),
      item({ id: 2, title: "Call endpoint" }),
    ]);
    mocked.linkWorkItems.mockRejectedValue(
      "that would make a blocking loop — neither item could start",
    );
    render(<PlanningBoard productId={7} />);

    await user.click(await screen.findByLabelText("Add dependency to Checkout"));
    await user.selectOptions(screen.getByLabelText("Dependency target for Checkout"), "2");
    await user.click(screen.getByLabelText("Save dependency for Checkout"));

    expect(await screen.findByText(/blocking loop/)).toBeInTheDocument();
  });

  it("removes a dependency it owns, but not one pointing at it", async () => {
    const user = userEvent.setup();
    mocked.unlinkWorkItems.mockResolvedValue();
    mocked.listWorkItems.mockResolvedValue([
      item({}),
      item({ id: 2, title: "Call endpoint" }),
    ]);
    mocked.listWorkItemLinks.mockResolvedValue([
      { id: 30, fromWorkItemId: 1, toWorkItemId: 2, kind: "blocks" },
    ]);
    render(<PlanningBoard productId={7} />);

    await user.click(
      await screen.findByLabelText("Remove dependency on Call endpoint from Checkout"),
    );
    await waitFor(() => expect(mocked.unlinkWorkItems).toHaveBeenCalledWith(30));

    // The other item shows the link but owns no button for it.
    const incoming = screen.getByRole("region", {
      name: "Dependencies of Call endpoint",
    });
    expect(
      within(incoming).queryByLabelText(/^Remove dependency/),
    ).not.toBeInTheDocument();
  });

  it("shows the AI story button on features when the hierarchy includes user stories", async () => {
    render(<PlanningBoard productId={7} />);
    expect(
      await screen.findByRole("button", {
        name: "AI: create user stories for Checkout",
      }),
    ).toBeInTheDocument();
  });

  it("hides the AI story button when the planning method has no user stories", async () => {
    mocked.getPlanningHierarchy.mockResolvedValue(["feature", "task"]);
    render(<PlanningBoard productId={7} />);
    await screen.findByRole("article", { name: "Checkout" });
    expect(
      screen.queryByRole("button", { name: /AI: create user stories/ }),
    ).not.toBeInTheDocument();
  });

  it("surfaces the policy-gate message from the AI story hook", async () => {
    const user = userEvent.setup();
    mocked.generateUserStories.mockRejectedValue(
      "'Checkout' has no AI policy, so AI can't touch it (deny-by-default).",
    );
    render(<PlanningBoard productId={7} />);

    await user.click(
      await screen.findByRole("button", {
        name: "AI: create user stories for Checkout",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("deny-by-default");
  });

  /// The README's answer to AI burning tokens on work it does not understand:
  /// declining is a good outcome and must not read as an error.
  it("treats an AI refusal as a question to answer, not a failure", async () => {
    const user = userEvent.setup();
    mocked.generateUserStories.mockResolvedValue({
      created: [],
      provider: "Claude",
      model: "claude-haiku-4-5",
      reason: "within budget (5% used)",
      blocked: {
        reason: "No payment provider is named.",
        whatIsNeeded: "Which payment provider should checkout use?",
        feedbackId: 9,
      },
    });
    render(<PlanningBoard productId={7} />);

    await user.click(
      await screen.findByRole("button", {
        name: "AI: create user stories for Checkout",
      }),
    );

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("stopped rather than guessing");
    expect(status).toHaveTextContent("No payment provider is named.");
    expect(status).not.toHaveTextContent(/error|failed/i);
  });

  it("shows an open AI question on the card and sends the answer back", async () => {
    const user = userEvent.setup();
    mocked.listAiFeedback.mockResolvedValue([
      {
        id: 9,
        workItemId: 1,
        kind: "needsInformation",
        message: "No payment provider is named.",
        whatIsNeeded: "Which payment provider should checkout use?",
        resolved: false,
        resolvedNote: "",
      },
    ]);
    mocked.resolveAiFeedback.mockResolvedValue(undefined);
    render(<PlanningBoard productId={7} />);

    await user.type(
      await screen.findByLabelText("Answer AI question 9"),
      "Use Stripe.",
    );
    await user.click(screen.getByRole("button", { name: "Save answer to AI question 9" }));

    await waitFor(() =>
      expect(mocked.resolveAiFeedback).toHaveBeenCalledWith(9, "Use Stripe."),
    );
  });

  it("reports how many stories the AI created and refreshes the board", async () => {
    const user = userEvent.setup();
    mocked.generateUserStories.mockResolvedValue({
      created: [
        "As a shopper, I want one-step pay",
        "As a shopper, I want saved cards",
      ],
      provider: "Claude",
      model: "claude-haiku-4-5",
      reason: "within budget (10% used)",
      blocked: null,
    });
    render(<PlanningBoard productId={7} />);

    await user.click(
      await screen.findByRole("button", {
        name: "AI: create user stories for Checkout",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      'AI created 2 user stories under "Checkout"',
    );
    expect(mocked.listWorkItems.mock.calls.length).toBeGreaterThan(1);
  });

  it("opens the AI policy editor and saves changes (deny-by-default start)", async () => {
    const user = userEvent.setup();
    mocked.setWorkItemPolicy.mockResolvedValue();
    render(<PlanningBoard productId={7} />);

    await user.click(
      await screen.findByRole("button", { name: "AI policy for Checkout" }),
    );
    const readToggle = await screen.findByLabelText("AI may read this item");
    expect(readToggle).not.toBeChecked(); // deny-by-default

    await user.click(readToggle);
    await waitFor(() =>
      expect(mocked.setWorkItemPolicy).toHaveBeenCalledWith({
        workItemId: 1,
        allowRead: true,
        allowEdit: false,
        allowGenerateTests: false,
        providerId: null,
        effortTier: "low",
      }),
    );

    await user.selectOptions(screen.getByLabelText("Provider for Checkout"), "3");
    await waitFor(() =>
      expect(mocked.setWorkItemPolicy).toHaveBeenLastCalledWith(
        expect.objectContaining({ providerId: 3 }),
      ),
    );
  });
});

