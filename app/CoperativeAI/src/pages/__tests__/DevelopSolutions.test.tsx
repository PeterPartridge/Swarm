import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DevelopSolutions from "../DevelopSolutions";
import type { Product, Solution } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listProducts: vi.fn(),
    listSolutions: vi.fn(),
    createSolution: vi.fn(),
    deleteSolution: vi.fn(),
    listAiProviders: vi.fn(),
    getStrategy: vi.fn(),
    listWorkItems: vi.fn(),
    listSprints: vi.fn(),
    listTeamMembers: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const product: Product = { id: 1, name: "Shop App", answers: "{}" };
const solution: Solution = {
  id: 3,
  name: "Shop API",
  productId: 1,
  solutionType: "api",
  answers: "{}",
};

describe("DevelopSolutions (Solution creation + AI settings)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listProducts.mockResolvedValue([product]);
    mocked.listSolutions.mockResolvedValue([solution]);
    mocked.listAiProviders.mockResolvedValue([]);
    mocked.getStrategy.mockResolvedValue("{}");
    mocked.listWorkItems.mockResolvedValue([]);
    mocked.listSprints.mockResolvedValue([]);
    mocked.listTeamMembers.mockResolvedValue([]);
  });

  it("shows the AI Settings section", async () => {
    render(<DevelopSolutions />);
    expect(await screen.findByRole("region", { name: "AI Settings" })).toBeInTheDocument();
  });

  it("shows the Technical Strategy and work views for the selected product", async () => {
    render(<DevelopSolutions />);
    expect(await screen.findByRole("region", { name: "Technical Strategy" })).toBeInTheDocument();
    expect(screen.getByLabelText("Required infrastructure")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Work views" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Board" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sprint" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "List" })).toBeInTheDocument();
  });

  it("no longer manages team members here (moved to Admin)", async () => {
    render(<DevelopSolutions />);
    await screen.findByRole("region", { name: "Create a Solution" });
    expect(screen.queryByLabelText("Member name")).not.toBeInTheDocument();
  });

  it("creates a Solution linked to a Product with the spec questions", async () => {
    const user = userEvent.setup();
    mocked.createSolution.mockResolvedValue(4);
    render(<DevelopSolutions />);

    await user.type(await screen.findByLabelText("Solution name"), "Shop Website");
    await user.selectOptions(screen.getByLabelText("Solution type"), "website");
    await user.type(
      screen.getByLabelText(/purpose of this solution/i),
      "The storefront",
    );
    await user.click(screen.getByRole("button", { name: "Create Solution" }));

    await waitFor(() =>
      expect(mocked.createSolution).toHaveBeenCalledWith({
        name: "Shop Website",
        productId: 1,
        solutionType: "website",
        answers: JSON.stringify({ purpose: "The storefront" }),
      }),
    );
  });

  it("lists existing solutions under their product", async () => {
    render(<DevelopSolutions />);
    expect(await screen.findByText(/Shop API/)).toBeInTheDocument();
    expect(screen.getByText(/\(api\) — Shop App/)).toBeInTheDocument();
  });

  it("asks to create a Product first when none exist", async () => {
    mocked.listProducts.mockResolvedValue([]);
    render(<DevelopSolutions />);
    expect(
      await screen.findByText(/create a Product first/i),
    ).toBeInTheDocument();
  });
});
