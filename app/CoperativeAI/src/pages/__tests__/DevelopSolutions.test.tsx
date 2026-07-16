import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DevelopSolutions from "../DevelopSolutions";
import type { Product, Solution, TeamMember } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listTeamMembers: vi.fn(),
    addTeamMember: vi.fn(),
    removeTeamMember: vi.fn(),
    listProducts: vi.fn(),
    listSolutions: vi.fn(),
    createSolution: vi.fn(),
    deleteSolution: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const product: Product = { id: 1, name: "Shop App", answers: "{}" };
const member: TeamMember = { id: 5, name: "Ada", role: "Developer" };
const solution: Solution = {
  id: 3,
  name: "Shop API",
  productId: 1,
  solutionType: "api",
  answers: "{}",
};

describe("DevelopSolutions (Developer Area + Solution creation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listTeamMembers.mockResolvedValue([member]);
    mocked.listProducts.mockResolvedValue([product]);
    mocked.listSolutions.mockResolvedValue([solution]);
  });

  it("lists team members and adds a new one with a role", async () => {
    const user = userEvent.setup();
    mocked.addTeamMember.mockResolvedValue(6);
    render(<DevelopSolutions />);

    expect(await screen.findByText(/Ada — Developer/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Member name"), "Grace");
    await user.selectOptions(screen.getByLabelText("Member role"), "QA");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    await waitFor(() =>
      expect(mocked.addTeamMember).toHaveBeenCalledWith("Grace", "QA"),
    );
  });

  it("removing a member calls the backend (items become unassigned there)", async () => {
    const user = userEvent.setup();
    mocked.removeTeamMember.mockResolvedValue();
    render(<DevelopSolutions />);

    await user.click(await screen.findByRole("button", { name: "Remove Ada" }));
    await waitFor(() => expect(mocked.removeTeamMember).toHaveBeenCalledWith(5));
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
