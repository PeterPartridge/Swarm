import { render, screen, waitFor } from "@testing-library/react";
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

  it("asks the Project brief questions and opens the workspace on create", async () => {
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
    await user.click(screen.getByRole("button", { name: "Create Product" }));

    await waitFor(() =>
      expect(mocked.createProduct).toHaveBeenCalledWith(
        "New Product",
        JSON.stringify({ purpose: "Sell things" }),
      ),
    );
    // Straight into the workspace: title header + screens menu.
    expect(await screen.findByRole("heading", { name: "New Product" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Planning" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "RoadMap" })).toBeInTheDocument();
  });

  it("opens an existing Product's workspace and can pop it out", async () => {
    const user = userEvent.setup();
    mocked.openScreenWindow.mockResolvedValue();
    render(<ProductPlanning />);

    await user.click(await screen.findByRole("button", { name: "Open Shop App" }));
    expect(await screen.findByRole("heading", { name: "Shop App" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open in its own window" }));
    await waitFor(() =>
      expect(mocked.openScreenWindow).toHaveBeenCalledWith("planning", 1, "Shop App"),
    );
  });
});
