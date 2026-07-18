import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductStrategy from "../../components/ProductStrategy";
import { PermissionProvider } from "../../lib/permissions";
import type { Deliverable, ProductPolicy, WorkItem } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    getStrategy: vi.fn(),
    saveStrategy: vi.fn(),
    listDeliverables: vi.fn(),
    getActivePermissions: vi.fn(),
    createDeliverable: vi.fn(),
    deleteDeliverable: vi.fn(),
    listWorkItems: vi.fn(),
    generateDeliverableWork: vi.fn(),
    getProductPolicy: vi.fn(),
    setProductPolicy: vi.fn(),
    listAiProviders: vi.fn(),
    getProductBudget: vi.fn(),
    setProductBudget: vi.fn(),
    getSpendSummary: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const deliverable: Deliverable = {
  id: 7,
  productId: 1,
  name: "MVP",
  description: "the first release",
};

const generatedItem: WorkItem = {
  id: 30,
  title: "Checkout flow",
  itemType: "feature",
  status: "planned",
  description: "Users can pay",
  productId: 1,
  parentItemId: null,
  assigneeId: null,
  sprintId: null,
  startDate: null,
  endDate: null,
  deliverableId: 7,
  expectedCost: null,
  estimatedProfit: null,
  chargeable: false,
  customerCoverPct: null,
};

const openPolicy: ProductPolicy = {
  productId: 1,
  allowRead: true,
  allowGenerate: true,
  providerId: 2,
  effortTier: "medium",
};

describe("ProductStrategy — generating the work for a Deliverable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getStrategy.mockResolvedValue("{}");
    mocked.listDeliverables.mockResolvedValue([deliverable]);
    mocked.listWorkItems.mockResolvedValue([]);
    mocked.getProductPolicy.mockResolvedValue(openPolicy);
    mocked.listAiProviders.mockResolvedValue([]);
    mocked.getProductBudget.mockResolvedValue(null);
    mocked.getSpendSummary.mockResolvedValue({
      spentMicropence: 0,
      spentTokens: 0,
      calls: 0,
      aiBudgetMicropence: 0,
      tokenLimit: 0,
      usedPct: 0,
      state: "none",
      activeProvider: null,
      reason: "No AI budget is set for this Product.",
      periodStart: 0,
    });
  });

  it("offers a Generate button on each deliverable", async () => {
    render(<ProductStrategy productId={1} />);
    expect(
      await screen.findByRole("button", { name: "Generate work for MVP" }),
    ).toBeInTheDocument();
  });

  it("generates work and shows the new items under the deliverable", async () => {
    const user = userEvent.setup();
    mocked.generateDeliverableWork.mockImplementation(async () => {
      mocked.listWorkItems.mockResolvedValue([generatedItem]);
      return {
        created: ["Checkout flow"],
        provider: "Claude",
        model: "claude-haiku-4-5",
        reason: "within budget (10% used)",
        blocked: null,
      };
    });
    render(<ProductStrategy productId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Generate work for MVP" }),
    );

    await waitFor(() =>
      expect(mocked.generateDeliverableWork).toHaveBeenCalledWith(7),
    );
    expect(await screen.findByText(/Added 1 item to MVP/)).toBeInTheDocument();
    expect(screen.getByText("Feature: Checkout flow")).toBeInTheDocument();
  });

  /// A budget handover swaps in a local model and the output changes character.
  /// The user must be told which provider ran, not left to guess why the
  /// results got worse.
  it("names the provider that ran the generation, so a handover is not silent", async () => {
    const user = userEvent.setup();
    mocked.generateDeliverableWork.mockResolvedValue({
      created: ["Checkout flow"],
      provider: "Ollama (local)",
      model: "llama3",
      reason: "past 90% of the AI budget — handed over to Ollama (local)",
      blocked: null,
    });
    render(<ProductStrategy productId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Generate work for MVP" }),
    );

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Ollama (local)");
    expect(status).toHaveTextContent("handed over");
  });

  it("reports an AI refusal as a question, not an error", async () => {
    const user = userEvent.setup();
    mocked.generateDeliverableWork.mockResolvedValue({
      created: [],
      provider: "Claude",
      model: "claude-haiku-4-5",
      reason: "within budget (5% used)",
      blocked: {
        reason: "MVP does not say what it includes.",
        whatIsNeeded: "Which features must ship in the MVP?",
        feedbackId: 0,
      },
    });
    render(<ProductStrategy productId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Generate work for MVP" }),
    );

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("stopped rather than guessing");
    expect(status).toHaveTextContent("Which features must ship in the MVP?");
    // it must not surface as an error alert
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces a policy denial instead of failing silently", async () => {
    const user = userEvent.setup();
    mocked.generateDeliverableWork.mockRejectedValue(
      "'MVP''s Product has no AI policy, so AI can't plan it (deny-by-default).",
    );
    render(<ProductStrategy productId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Generate work for MVP" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/deny-by-default/);
  });

  it("shows the Product AI policy, off by default", async () => {
    mocked.getProductPolicy.mockResolvedValue(null);
    render(<ProductStrategy productId={1} />);

    expect(
      await screen.findByRole("region", { name: "Product AI policy" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Allow AI to read this Product")).not.toBeChecked();
    expect(screen.getByLabelText("Allow AI to generate work items")).not.toBeChecked();
  });

  it("says no budget is set until one is, rather than showing a bar at zero", async () => {
    render(<ProductStrategy productId={1} />);
    expect(await screen.findByRole("region", { name: "AI budget" })).toBeInTheDocument();
    expect(screen.getByText(/No budget set/)).toBeInTheDocument();
    expect(screen.queryByLabelText("AI spend")).not.toBeInTheDocument();
  });

  it("shows spend against the budget with the router's own decision", async () => {
    mocked.getSpendSummary.mockResolvedValue({
      spentMicropence: 4_490_000_000,
      spentTokens: 1_234_567,
      calls: 12,
      aiBudgetMicropence: 5_000_000_000,
      tokenLimit: 0,
      usedPct: 90,
      state: "handover",
      activeProvider: "Ollama",
      reason: "past 90% of the AI budget — handed over to Ollama",
    periodStart: 0,
    });
    render(<ProductStrategy productId={1} />);

    expect(await screen.findByLabelText("AI spend")).toBeInTheDocument();
    expect(screen.getByText(/£44\.90 of £50\.00/)).toBeInTheDocument();
    expect(screen.getByText(/1,234,567 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/Next call: Ollama/)).toBeInTheDocument();
  });

  it("saves a budget in pounds, converted to the exact internal unit", async () => {
    const user = userEvent.setup();
    mocked.setProductBudget.mockResolvedValue(undefined);
    render(<ProductStrategy productId={1} />);

    const aiBudget = await screen.findByLabelText("AI budget in pounds");
    await user.clear(aiBudget);
    await user.type(aiBudget, "50.00");
    await user.click(screen.getByRole("button", { name: "Save budget" }));

    await waitFor(() =>
      expect(mocked.setProductBudget).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 1,
          // £50 → 5,000,000,000 micropence, with no floating-point drift
          aiBudgetMicropence: 5_000_000_000,
          handoverPct: 90,
        }),
      ),
    );
  });

  /// Seeing spend and setting the budget are different powers: a role without
  /// canManageBudget must still see what has been spent, but get no controls.
  it("shows spend but hides the controls from a role that cannot manage budgets", async () => {
    mocked.getActivePermissions.mockResolvedValue({
      memberId: 5,
      role: null,
      canProduct: true,
      canDevelop: true,
      canTest: true,
      canAdmin: false,
      seeCost: true,
      seeProfit: true,
      seeChargeable: true,
      canManageBudget: false,
    });
    mocked.getSpendSummary.mockResolvedValue({
      spentMicropence: 1_000_000_000,
      spentTokens: 500,
      calls: 2,
      aiBudgetMicropence: 5_000_000_000,
      tokenLimit: 0,
      usedPct: 20,
      state: "ok",
      activeProvider: "Claude",
      reason: "within budget (20% used)",
      periodStart: 0,
    });

    render(
      <PermissionProvider>
        <ProductStrategy productId={1} />
      </PermissionProvider>,
    );

    expect(await screen.findByLabelText("AI spend")).toBeInTheDocument();
    expect(screen.getByText(/£10\.00 of £50\.00/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByLabelText("AI budget in pounds")).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/can see AI spend but not change the budget/)).toBeInTheDocument();
  });

  it("saves the Product AI policy when a switch is turned on", async () => {
    const user = userEvent.setup();
    mocked.getProductPolicy.mockResolvedValue(null);
    mocked.setProductPolicy.mockResolvedValue(undefined);
    render(<ProductStrategy productId={1} />);

    await user.click(await screen.findByLabelText("Allow AI to generate work items"));

    await waitFor(() =>
      expect(mocked.setProductPolicy).toHaveBeenCalledWith({
        productId: 1,
        allowRead: false,
        allowGenerate: true,
        providerId: null,
        effortTier: "low",
      }),
    );
  });
});
