import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SolutionMap from "../../components/diagram/SolutionMap";
import type { RepoLink, Solution } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listSolutions: vi.fn(),
    listRepoLinks: vi.fn(),
    createSolution: vi.fn(),
    linkSolutions: vi.fn(),
    unlinkSolutions: vi.fn(),
    saveDiagram: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

function sol(id: number, name: string, solutionType = "api", productId = 7): Solution {
  return {
    id,
    name,
    productId,
    solutionType,
    answers: "{}",
    origin: "created",
    githubUrl: null,
    githubVisibility: null,
    localPath: null,
    testCommand: null,
    language: null,
    runCommand: null,
  };
}

describe("SolutionMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocked.listRepoLinks.mockResolvedValue([]);
    mocked.listSolutions.mockResolvedValue([
      sol(11, "Shop Web", "website"),
      sol(12, "Shop API", "api"),
      sol(13, "Orders DB", "database"),
    ]);
  });

  /// Each Solution is a box, and its type is on the box so the shapes can be
  /// told apart.
  it("draws a box per Solution carrying its type", async () => {
    render(<SolutionMap productId={7} />);
    expect(await screen.findByLabelText("Shop Web (website)")).toBeInTheDocument();
    expect(screen.getByLabelText("Shop API (api)")).toBeInTheDocument();
    expect(screen.getByLabelText("Orders DB (database)")).toBeInTheDocument();
  });

  /// A new Solution is added from the map itself and appears as a box.
  it("adds a new Solution to the map", async () => {
    const user = userEvent.setup();
    mocked.createSolution.mockResolvedValue(99);
    render(<SolutionMap productId={7} />);
    await screen.findByLabelText("Shop Web (website)");

    await user.type(screen.getByLabelText("New Solution name"), "Payments");
    await user.selectOptions(screen.getByLabelText("New Solution type"), "application");
    await user.click(screen.getByLabelText("Add Solution to the map"));

    await waitFor(() =>
      expect(mocked.createSolution).toHaveBeenCalledWith({
        name: "Payments",
        productId: 7,
        solutionType: "application",
        answers: "{}",
      }),
    );
  });

  /// Connect mode joins two boxes with a dependency — the cross-repo link, drawn
  /// rather than typed into a form.
  it("links two Solutions in connect mode", async () => {
    const user = userEvent.setup();
    mocked.linkSolutions.mockResolvedValue(1);
    render(<SolutionMap productId={7} />);
    await screen.findByLabelText("Shop Web (website)");

    await user.click(screen.getByRole("radio", { name: "Connect" }));
    await user.click(screen.getByLabelText("Shop Web (website)"));
    await user.click(screen.getByLabelText("Shop API (api)"));

    await waitFor(() =>
      expect(mocked.linkSolutions).toHaveBeenCalledWith(11, 12, "callsApi", ""),
    );
  });

  /// Save writes the arrangement out as a diagram: a node per Solution and an
  /// edge per dependency.
  it("saves the map as a diagram", async () => {
    const user = userEvent.setup();
    const link: RepoLink = {
      id: 20,
      fromSolutionId: 11,
      toSolutionId: 12,
      kind: "callsApi",
      notes: "",
    };
    mocked.listRepoLinks.mockResolvedValue([link]);
    mocked.saveDiagram.mockResolvedValue("C:/p/.CoperativeAI/diagrams/architecture-map.drawio");
    render(<SolutionMap productId={7} />);
    await screen.findByLabelText("Shop Web (website)");

    await user.click(screen.getByLabelText("Save the map as a diagram"));

    await waitFor(() => expect(mocked.saveDiagram).toHaveBeenCalledTimes(1));
    const [productId, name, nodes, edges] = mocked.saveDiagram.mock.calls[0];
    expect(productId).toBe(7);
    expect(name).toBe("architecture-map");
    expect(nodes).toHaveLength(3);
    // The arrangement travels: every box is saved with its coordinates, not left
    // to snap back to a grid.
    for (const n of nodes) {
      expect(typeof n.x).toBe("number");
      expect(typeof n.y).toBe("number");
    }
    expect(edges).toEqual([{ from: "11", to: "12", label: "calls the API of" }]);
  });

  /// A dependency shown on the map can be removed from the list beneath it.
  it("removes a dependency", async () => {
    const user = userEvent.setup();
    mocked.listRepoLinks.mockResolvedValue([
      { id: 20, fromSolutionId: 11, toSolutionId: 12, kind: "callsApi", notes: "" },
    ]);
    mocked.unlinkSolutions.mockResolvedValue(undefined);
    render(<SolutionMap productId={7} />);

    const list = await screen.findByRole("list", { name: "Dependencies" });
    await user.click(
      within(list).getByLabelText("Remove dependency Shop Web to Shop API"),
    );

    await waitFor(() => expect(mocked.unlinkSolutions).toHaveBeenCalledWith(20));
  });
});
