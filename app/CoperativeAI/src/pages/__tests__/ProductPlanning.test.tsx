import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductPlanning from "../ProductPlanning";
import type { Product } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listProducts: vi.fn(),
    createProduct: vi.fn(),
    getProduct: vi.fn(),
    deleteProduct: vi.fn(),
    getPlanningHierarchy: vi.fn(),
    getRoadmapMode: vi.fn(),
    setPlanningHierarchy: vi.fn(),
    setRoadmapMode: vi.fn(),
    listWorkItems: vi.fn(),
    listTeamMembers: vi.fn(),
    listSprints: vi.fn(),
    openScreenWindow: vi.fn(),
    getProductScaffold: vi.fn(),
    getWorkItemPolicy: vi.fn(),
    listAiProviders: vi.fn(),
    pickFolder: vi.fn(),
    listDeliverables: vi.fn(),
    getStrategy: vi.fn(),
    getProductPolicy: vi.fn(),
    getProductBudget: vi.fn(),
    getSpendSummary: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const product: Product = { id: 1, name: "Shop App", answers: "{}" };

describe("ProductPlanning (Product home)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listProducts.mockResolvedValue([product]);
    mocked.getPlanningHierarchy.mockResolvedValue([
      "epic",
      "feature",
      "userStory",
      "task",
    ]);
    mocked.getRoadmapMode.mockResolvedValue("sprints");
    mocked.listWorkItems.mockResolvedValue([]);
    mocked.listTeamMembers.mockResolvedValue([]);
    mocked.listSprints.mockResolvedValue([]);
    mocked.getProductScaffold.mockResolvedValue(null);
    mocked.getWorkItemPolicy.mockResolvedValue(null);
    mocked.listAiProviders.mockResolvedValue([]);
    mocked.listDeliverables.mockResolvedValue([]);
    mocked.getStrategy.mockResolvedValue("{}");
    mocked.getProductPolicy.mockResolvedValue(null);
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

  it("shows Products as cards plus the Add a Product card", async () => {
    render(<ProductPlanning />);
    expect(await screen.findByRole("article", { name: "Shop App" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a Product" })).toBeInTheDocument();
  });

  it("shows the How Products are planned settings", async () => {
    render(<ProductPlanning />);
    expect(await screen.findByLabelText("How Products are planned")).toBeInTheDocument();
    expect(screen.getByLabelText("RoadMap style")).toBeInTheDocument();
  });

  it("scaffolds behind the scenes and opens the workspace on create", async () => {
    const user = userEvent.setup();
    mocked.createProduct.mockResolvedValue(2);
    render(<ProductPlanning />);

    await user.click(await screen.findByRole("button", { name: "Add a Product" }));
    expect(screen.getByLabelText(/purpose of this product/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/problem does it solve/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Product name"), "New Product");
    await user.type(
      screen.getByLabelText(/purpose of this product/i),
      "Sell things",
    );
    mocked.pickFolder.mockResolvedValue("C:/somewhere");
    await user.click(
      screen.getByRole("button", { name: /Choose folder/i }),
    );
    await waitFor(() => expect(screen.getByText("C:/somewhere")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Create Product" }));

    await waitFor(() =>
      expect(mocked.createProduct).toHaveBeenCalledWith(
        "New Product",
        JSON.stringify({ purpose: "Sell things" }),
        "C:/somewhere",
      ),
    );
    // Straight into the workspace: Planning showing, the rest a tab away.
    expect(await screen.findByRole("heading", { name: "New Product" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Planning" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "RoadMap" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();
  });

  it("opens an existing Product's workspace; dragging a panel handle pops it out", async () => {
    const user = userEvent.setup();
    mocked.openScreenWindow.mockResolvedValue();
    render(<ProductPlanning />);

    await user.click(await screen.findByRole("button", { name: "Open Shop App" }));
    expect(await screen.findByRole("heading", { name: "Shop App" })).toBeInTheDocument();

    // Open the RoadMap tab, then drag its handle to tear it into its own window.
    await user.click(screen.getByRole("button", { name: "RoadMap" }));
    const handle = await screen.findByRole("button", { name: "Drag to pop out RoadMap" });
    fireEvent.dragStart(handle);
    fireEvent.dragEnd(handle);

    await waitFor(() =>
      expect(mocked.openScreenWindow).toHaveBeenCalledWith("roadmap", 1, "Shop App"),
    );
  });

  it("clicking a panel handle does not pop out (only a real drag does)", async () => {
    const user = userEvent.setup();
    mocked.openScreenWindow.mockResolvedValue();
    render(<ProductPlanning />);
    await user.click(await screen.findByRole("button", { name: "Open Shop App" }));

    const handle = await screen.findByRole("button", { name: "Drag to pop out Planning" });
    await user.click(handle);
    expect(mocked.openScreenWindow).not.toHaveBeenCalled();
  });

  it("shows the scaffold location on the Overview panel", async () => {
    const user = userEvent.setup();
    mocked.getProductScaffold.mockResolvedValue("C:/somewhere/Shop-App");
    render(<ProductPlanning />);

    await user.click(await screen.findByRole("button", { name: "Open Shop App" }));
    // Overview is a tab now, so open it before looking for its content.
    await user.click(await screen.findByRole("button", { name: "Overview" }));
    expect(await screen.findByText("C:/somewhere/Shop-App")).toBeInTheDocument();
  });
});
