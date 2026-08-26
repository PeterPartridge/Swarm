import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeveloperPlanning from "../../components/planning/DeveloperPlanning";
import type { ArchitectureDoc, Solution } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listArchitectureDocs: vi.fn(),
    listSolutions: vi.fn(),
    generateArchitectureDoc: vi.fn(),
    deleteArchitectureDoc: vi.fn(),
    // The embedded SolutionMap loads and can act on these; mocked so it mounts
    // cleanly rather than falling through to the real invoke.
    listRepoLinks: vi.fn(),
    linkSolutions: vi.fn(),
    unlinkSolutions: vi.fn(),
    createSolution: vi.fn(),
    saveDiagram: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

function sol(id: number, name: string, productId = 7): Solution {
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
    runCommand: null,
    startFrom: null,
    kindLocations: "{}",
  };
}

const doc: ArchitectureDoc = {
  id: 1,
  productId: 7,
  solutionId: null,
  kind: "systemInteraction",
  name: "How it fits",
  content: "flowchart TD\n  Web --> Api",
  format: "mermaid",
};

describe("DeveloperPlanning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listArchitectureDocs.mockResolvedValue([]);
    mocked.listRepoLinks.mockResolvedValue([]);
    mocked.listSolutions.mockResolvedValue([sol(11, "Web"), sol(12, "API")]);
  });

  /// The combined view leads with the map: each Solution is a box on it.
  it("shows the Solutions as boxes on the architecture map", async () => {
    render(<DeveloperPlanning productId={7} />);
    const map = await screen.findByRole("region", { name: "Architecture map" });
    expect(within(map).getByLabelText("Web (api)")).toBeInTheDocument();
    expect(within(map).getByLabelText("API (api)")).toBeInTheDocument();
  });

  it("generates a document for the whole Product by default", async () => {
    const user = userEvent.setup();
    mocked.generateArchitectureDoc.mockResolvedValue({
      created: ["How it fits", "The web app calls the API."],
      provider: "Claude",
      model: "m",
      reason: "within budget",
      blocked: null,
    });
    render(<DeveloperPlanning productId={7} />);

    await user.type(await screen.findByLabelText("Architecture brief"), "Draw the shape");
    await user.click(screen.getByLabelText("Generate architecture document"));

    await waitFor(() =>
      expect(mocked.generateArchitectureDoc).toHaveBeenCalledWith({
        productId: 7,
        solutionId: null,
        kind: "systemInteraction",
        format: "mermaid",
        brief: "Draw the shape",
      }),
    );
    // The explanation travels with the diagram, for a reader who cannot parse
    // Mermaid in their head.
    expect(await screen.findByText(/The web app calls the API/)).toBeInTheDocument();
  });

  /// A diagram that does not render is worse than none, so the store refuses it
  /// and the user is told the AI produced something unusable.
  it("reports when the AI drew something that will not render", async () => {
    const user = userEvent.setup();
    mocked.generateArchitectureDoc.mockRejectedValue(
      "the AI drew something that will not render, so it was not saved: this does not start like a Mermaid diagram",
    );
    render(<DeveloperPlanning productId={7} />);

    await user.click(await screen.findByLabelText("Generate architecture document"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("will not render");
    expect(alert).toHaveTextContent("not saved");
  });

  it("shows a stored document with its scope", async () => {
    mocked.listArchitectureDocs.mockResolvedValue([
      doc,
      { ...doc, id: 2, name: "Orders API", kind: "apiContract", solutionId: 12 },
    ]);
    render(<DeveloperPlanning productId={7} />);

    const docs = await screen.findByRole("region", { name: "Architecture documents" });
    expect(within(docs).getByText("whole Product")).toBeInTheDocument();
    expect(within(docs).getByText("How it fits")).toBeInTheDocument();

    const row = within(docs).getByText("Orders API").closest("li") as HTMLElement;
    expect(within(row).getByText("API")).toBeInTheDocument();
    expect(within(row).getByText("API contract")).toBeInTheDocument();
  });
});
