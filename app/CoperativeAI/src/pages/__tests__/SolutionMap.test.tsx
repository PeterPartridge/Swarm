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
    // The map marks the Solutions an agent is inside. Left unmocked this falls
    // through to the real invoke, the component swallows it by design, and the
    // agent half of these tests would never run at all.
    listRuns: vi.fn(),
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
    startFrom: null,
  };
}

describe("SolutionMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocked.listRepoLinks.mockResolvedValue([]);
    mocked.listRuns.mockResolvedValue([]);
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

  /// **The honesty rule, on the map.** The design gave every module an owner, a
  /// size and a coverage figure, and a red/amber/green health light. This app
  /// reads none of those. The inspector shows the three things it does know.
  it("inspects a box with what it knows, and invents no owner or coverage", async () => {
    const user = userEvent.setup();
    mocked.listSolutions.mockResolvedValue([
      { ...sol(12, "Shop API", "api"), localPath: "C:/repos/shop-api", language: "Rust (cargo)" },
    ]);
    render(<SolutionMap productId={7} />);

    await user.click(await screen.findByLabelText("Shop API (api)"));
    const panel = screen.getByRole("complementary", { name: "Selected Solution" });

    expect(panel).toHaveTextContent("C:/repos/shop-api");
    expect(panel).toHaveTextContent("not linked"); // no githubUrl, said plainly
    expect(panel).toHaveTextContent("Rust (cargo)");
    for (const invented of [/owner/i, /coverage/i, /LOC/]) {
      expect(panel.textContent).not.toMatch(invented);
    }
  });

  /// The checks are the map's own review: three things the app can genuinely
  /// see about a Solution, named with the Solutions they are about.
  it("names the Solutions missing a folder, a repository or a connection", async () => {
    render(<SolutionMap productId={7} />);
    await screen.findByLabelText("Shop Web (website)");

    const checks = screen.getByText(/with no working copy on this machine/);
    expect(checks).toHaveTextContent("Shop Web");
    expect(screen.getByText(/joined to nothing/)).toHaveTextContent("Orders DB");
  });

  /// Map and Build are two views of one thing: the map says where the work is,
  /// Build says what it is doing. The inspector carries you across.
  it("links the agent inside a Solution through to Build", async () => {
    const user = userEvent.setup();
    const opened: number[] = [];
    mocked.listRuns.mockResolvedValue([
      {
        id: 3, workItemId: 42, workItemTitle: "Add checkout", solutionId: 12,
        solutionName: "Shop API", state: "prepared", branch: "b", worktreePath: "C:/wt",
        terminalId: "", briefPath: "", filesChanged: 2, planApproved: true,
      },
    ]);
    render(<SolutionMap productId={7} onOpenAgent={(id) => opened.push(id)} />);

    await user.click(await screen.findByLabelText("Shop API (api)"));
    await user.click(screen.getByLabelText("Open Add checkout in Build"));

    expect(opened).toEqual([42]);
  });

  /// A settled run is not an agent standing in the module — it has finished and
  /// gone, and marking the box would say somebody is still working there.
  it("does not mark a Solution whose run has been settled", async () => {
    mocked.listRuns.mockResolvedValue([
      {
        id: 3, workItemId: 42, workItemTitle: "Add checkout", solutionId: 12,
        solutionName: "Shop API", state: "kept", branch: "b", worktreePath: "C:/wt",
        terminalId: "", briefPath: "", filesChanged: 2, planApproved: true,
      },
    ]);
    render(<SolutionMap productId={7} />);
    await screen.findByLabelText("Shop API (api)");

    expect(screen.getByText(/0 with an agent/)).toBeInTheDocument();
  });

  /// Zoom is a view of the map, not a change to it — Tidy puts it back without
  /// touching a single stored coordinate.
  it("zooms, and Tidy returns the view to 100%", async () => {
    const user = userEvent.setup();
    render(<SolutionMap productId={7} />);
    await screen.findByLabelText("Shop Web (website)");

    await user.click(screen.getByLabelText("Zoom in"));
    await user.click(screen.getByLabelText("Zoom in"));
    expect(screen.getByText("120%")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Reset the view"));
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(mocked.saveDiagram).not.toHaveBeenCalled();
  });
});
