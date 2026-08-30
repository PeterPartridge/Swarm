import { render, screen, waitFor } from "@testing-library/react";
import StandaloneBuildPane from "../StandaloneBuildPane";
import type { Solution, WorkItem } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    getWorkItem: vi.fn(),
    listSolutions: vi.fn(),
    listWorkItems: vi.fn(),
    // The build plan the pulled-out window renders reads all of these; left to
    // fall through to the real invoke each one renders its own error.
    listWorkItemPlans: vi.fn(),
    listAiFeedback: vi.fn(),
    listAiJobs: vi.fn(),
    checkItemAiPermission: vi.fn(),
    listWorkItemChanges: vi.fn(),
    changeKinds: vi.fn(),
    changeKindsForSolution: vi.fn(),
    solutionCatalogue: vi.fn(),
    writeWorkItemFiles: vi.fn(),
    listRoles: vi.fn(),
    currentRole: vi.fn(),
    readSolutionFile: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const item = {
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
} as WorkItem;

const solution = (id: number, productId: number): Solution =>
  ({
    id,
    name: `Solution ${id}`,
    productId,
    solutionType: "api",
    answers: "{}",
    origin: "created",
    githubUrl: null,
    githubVisibility: null,
    localPath: null,
    testCommand: null,
  }) as Solution;

describe("a Build pane pulled into its own window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listWorkItemPlans.mockResolvedValue([]);
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
    mocked.listSolutions.mockResolvedValue([solution(3, 7), solution(4, 9)]);
  });

  /// **One read, not a sweep of the workspace.** It used to walk every
  /// Product's work items looking for this id, because there was no way to ask
  /// for one — a window that knew exactly what it wanted reading everything to
  /// find it.
  it("asks for the one work item it was opened for", async () => {
    mocked.getWorkItem.mockResolvedValue(item);
    render(<StandaloneBuildPane pane="workItem" workItemId={12} />);

    expect(
      await screen.findByRole("region", { name: "Build plan for Add checkout" }),
    ).toBeInTheDocument();
    expect(mocked.getWorkItem).toHaveBeenCalledWith(12);
    expect(mocked.listWorkItems).not.toHaveBeenCalled();
  });

  /// An id in a URL outlives the row it names — a window reopened after the
  /// item was deleted has to say so rather than sit on "Loading…".
  it("says so when the work item has gone", async () => {
    mocked.getWorkItem.mockResolvedValue(null);
    render(<StandaloneBuildPane pane="workItem" workItemId={12} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /not in this workspace any more/i,
    );
  });

  it("opens a file from its Solution", async () => {
    mocked.readSolutionFile.mockResolvedValue("fn main() {}");
    render(<StandaloneBuildPane pane="file" solutionId={3} path="src/main.rs" />);

    await waitFor(() =>
      expect(mocked.readSolutionFile).toHaveBeenCalledWith(3, "src/main.rs"),
    );
  });
});
