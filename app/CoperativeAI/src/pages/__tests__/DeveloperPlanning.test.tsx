import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeveloperPlanning from "../../components/DeveloperPlanning";
import type { ArchitectureDoc, RepoLink, Solution } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listArchitectureDocs: vi.fn(),
    listRepoLinks: vi.fn(),
    listSolutions: vi.fn(),
    linkSolutions: vi.fn(),
    unlinkSolutions: vi.fn(),
    solutionsReachedBy: vi.fn(),
    generateArchitectureDoc: vi.fn(),
    deleteArchitectureDoc: vi.fn(),
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

const link: RepoLink = {
  id: 20,
  fromSolutionId: 11,
  toSolutionId: 12,
  kind: "callsApi",
  notes: "for the basket",
};

describe("DeveloperPlanning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listArchitectureDocs.mockResolvedValue([]);
    mocked.listRepoLinks.mockResolvedValue([]);
    mocked.listSolutions.mockResolvedValue([sol(11, "Web"), sol(12, "API")]);
  });

  it("shows a dependency in plain words, with its note", async () => {
    mocked.listRepoLinks.mockResolvedValue([link]);
    render(<DeveloperPlanning productId={7} />);

    const map = await screen.findByRole("region", {
      name: "How the Solutions depend on each other",
    });
    expect(within(map).getByText(/Web calls the API of API/)).toBeInTheDocument();
    expect(within(map).getByText(/for the basket/)).toBeInTheDocument();
  });

  /// A dependency needs two things to sit between.
  it("says so rather than offering an empty form when there is one Solution", async () => {
    mocked.listSolutions.mockResolvedValue([sol(11, "Web")]);
    render(<DeveloperPlanning productId={7} />);

    expect(await screen.findByText(/A dependency needs two Solutions/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Add Solution dependency")).not.toBeInTheDocument();
  });

  it("only offers this Product's Solutions", async () => {
    mocked.listSolutions.mockResolvedValue([
      sol(11, "Web"),
      sol(12, "API"),
      sol(99, "Someone else's", 42),
    ]);
    render(<DeveloperPlanning productId={7} />);

    const from = await screen.findByLabelText("Dependency from");
    expect(within(from).getByRole("option", { name: "Web" })).toBeInTheDocument();
    expect(
      within(from).queryByRole("option", { name: "Someone else's" }),
    ).not.toBeInTheDocument();
  });

  it("records a dependency with its kind and note", async () => {
    const user = userEvent.setup();
    mocked.linkSolutions.mockResolvedValue(1);
    render(<DeveloperPlanning productId={7} />);

    await user.selectOptions(await screen.findByLabelText("Dependency from"), "11");
    await user.selectOptions(screen.getByLabelText("Dependency kind"), "buildsOn");
    await user.selectOptions(screen.getByLabelText("Dependency to"), "12");
    await user.type(screen.getByLabelText("Dependency notes"), "shared types");
    await user.click(screen.getByLabelText("Add Solution dependency"));

    await waitFor(() =>
      expect(mocked.linkSolutions).toHaveBeenCalledWith(11, 12, "buildsOn", "shared types"),
    );
  });

  /// Only `buildsOn` orders anything; the backend refuses a cycle of it and the
  /// reason has to reach the user rather than the click doing nothing.
  it("surfaces a refused build cycle", async () => {
    const user = userEvent.setup();
    mocked.linkSolutions.mockRejectedValue(
      "that would make a build cycle — neither Solution could be built first",
    );
    render(<DeveloperPlanning productId={7} />);

    await user.selectOptions(await screen.findByLabelText("Dependency from"), "11");
    await user.selectOptions(screen.getByLabelText("Dependency to"), "12");
    await user.click(screen.getByLabelText("Add Solution dependency"));

    expect(await screen.findByText(/build cycle/)).toBeInTheDocument();
  });

  /// The question the map exists to answer.
  it("answers what a change would reach, and says so when it reaches nothing", async () => {
    const user = userEvent.setup();
    mocked.solutionsReachedBy.mockResolvedValue([12]);
    render(<DeveloperPlanning productId={7} />);

    await user.click(await screen.findByLabelText("What does changing Web reach"));
    expect(await screen.findByText(/Changing Web reaches: API/)).toBeInTheDocument();

    mocked.solutionsReachedBy.mockResolvedValue([]);
    await user.click(screen.getByLabelText("What does changing API reach"));
    expect(await screen.findByText(/reaches nothing else recorded here/)).toBeInTheDocument();
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
    expect(within(docs).getAllByText(/flowchart TD/)).toHaveLength(2);

    // Scoped to the row: "API" is also a Solution name in the selects above.
    const row = within(docs).getByText("Orders API").closest("li") as HTMLElement;
    expect(within(row).getByText("API")).toBeInTheDocument();
    expect(within(row).getByText("API contract")).toBeInTheDocument();
  });
});
