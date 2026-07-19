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
    githubStatus: vi.fn(),
    generateFrameworkFiles: vi.fn(),
    listModelStatus: vi.fn(),
    installModel: vi.fn(),
    refreshProviderModels: vi.fn(),
    setGithubToken: vi.fn(),
    removeGithubToken: vi.fn(),
    linkSolutionRepo: vi.fn(),
    createSolutionRepo: vi.fn(),
    listArchitectureDocs: vi.fn(),
    listRepoLinks: vi.fn(),
    readSolutionTree: vi.fn(),
    reviewSolutionChanges: vi.fn(),
    setSolutionPath: vi.fn(),
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
  origin: "created",
  githubUrl: null,
  githubVisibility: null,
  localPath: null,
};

describe("DevelopSolutions (Solution creation + AI settings)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listProducts.mockResolvedValue([product]);
    mocked.listSolutions.mockResolvedValue([solution]);
    mocked.listAiProviders.mockResolvedValue([]);
    mocked.getStrategy.mockResolvedValue("{}");
    mocked.listArchitectureDocs.mockResolvedValue([]);
    mocked.listRepoLinks.mockResolvedValue([]);
    mocked.readSolutionTree.mockResolvedValue({ entries: [], truncated: false });
    mocked.listWorkItems.mockResolvedValue([]);
    mocked.listSprints.mockResolvedValue([]);
    mocked.listTeamMembers.mockResolvedValue([]);
    mocked.githubStatus.mockResolvedValue({ connected: false });
    mocked.listModelStatus.mockResolvedValue([]);
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

  it("generates the framework files and reports what it wrote", async () => {
    const user = userEvent.setup();
    mocked.generateFrameworkFiles.mockResolvedValue({
      written: ["shop-api/application-spec.json"],
      unchanged: [],
      conflicts: [],
    });
    render(<DevelopSolutions />);

    await user.click(
      await screen.findByRole("button", { name: "Generate framework files" }),
    );

    await waitFor(() => expect(mocked.generateFrameworkFiles).toHaveBeenCalledWith(1));
    expect(await screen.findByText(/1 written/)).toBeInTheDocument();
  });

  /// The point of the conflict report: a hand-edited brief must be named, and
  /// the user told their edit survived.
  it("names files it left alone and says the edits are safe", async () => {
    const user = userEvent.setup();
    mocked.generateFrameworkFiles.mockResolvedValue({
      written: [],
      unchanged: [],
      conflicts: [".CoperativeAI/pages/checkout.md"],
    });
    render(<DevelopSolutions />);

    await user.click(
      await screen.findByRole("button", { name: "Generate framework files" }),
    );

    expect(await screen.findByText(".CoperativeAI/pages/checkout.md")).toBeInTheDocument();
    expect(screen.getByText(/Your edits are safe/)).toBeInTheDocument();
  });

  /// A model appearing on a provider does not make it usable — the whole point
  /// of the install gate.
  it("shows a newly detected model as not yet installed", async () => {
    mocked.listModelStatus.mockResolvedValue([
      {
        providerId: 2,
        provider: "Ollama (local)",
        model: "ornith:9b",
        state: "detected",
        packPath: "",
        validationReport: "{}",
      },
    ]);
    render(<DevelopSolutions />);

    expect(await screen.findByText("ornith:9b")).toBeInTheDocument();
    expect(screen.getByText(/New — not yet installed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install ornith:9b" })).toBeInTheDocument();
  });

  it("installs a model and reports that it passed", async () => {
    const user = userEvent.setup();
    mocked.listModelStatus.mockResolvedValue([
      {
        providerId: 2,
        provider: "Ollama (local)",
        model: "ornith:9b",
        state: "detected",
        packPath: "",
        validationReport: "{}",
      },
    ]);
    mocked.installModel.mockResolvedValue({
      model: "ornith:9b",
      passed: true,
      probes: [
        { probe: "workItemInterpretation", passed: true, detail: "returned 3 work items" },
        { probe: "declinesVagueWork", passed: true, detail: "declined and asked a question" },
      ],
      suggestedFixes: [],
    });
    render(<DevelopSolutions />);

    await user.click(await screen.findByRole("button", { name: "Install ornith:9b" }));

    await waitFor(() => expect(mocked.installModel).toHaveBeenCalledWith(2, "ornith:9b", 1));
    expect(await screen.findByText(/passed every check/)).toBeInTheDocument();
  });

  /// All-or-nothing: a failed probe leaves the model blocked, and the user is
  /// told which check failed and what to do about it.
  it("names the failed check and keeps a failing model blocked", async () => {
    mocked.listModelStatus.mockResolvedValue([
      {
        providerId: 2,
        provider: "Ollama (local)",
        model: "tiny:1b",
        state: "failed",
        packPath: "packs/tiny_1b",
        validationReport: JSON.stringify({
          model: "tiny:1b",
          passed: false,
          probes: [
            { probe: "workItemInterpretation", passed: true, detail: "returned 3 work items" },
            { probe: "architectureKinds", passed: false, detail: "invented kinds: microservice" },
          ],
          suggestedFixes: ["The model invented architecture kinds. The platform can only file these: api…"],
        }),
      },
    ]);
    render(<DevelopSolutions />);

    expect(await screen.findByText(/Failed validation/)).toBeInTheDocument();
    expect(screen.getByText(/invented kinds: microservice/)).toBeInTheDocument();
    expect(screen.getByText(/can only file these/)).toBeInTheDocument();
    // still offered for installation, never for use
    expect(screen.getByRole("button", { name: "Install tiny:1b" })).toBeInTheDocument();
  });

  /// The other half of the move: Develop shows the rules developers work
  /// under, but cannot edit them. Two editors for one set of rules would
  /// drift, and the drift would be invisible until the AI obeyed the wrong
  /// copy.
  it("shows the developer rules read-only, pointing at Admin", async () => {
    render(<DevelopSolutions />);

    const disallowed = await screen.findByLabelText("Disallowed technologies (enforced)");
    expect(disallowed).toHaveAttribute("readonly");
    expect(screen.getByText(/set in the Admin area/)).toBeInTheDocument();
  });

  it("offers to connect GitHub when no token is stored", async () => {
    render(<DevelopSolutions />);
    expect(await screen.findByRole("region", { name: "GitHub" })).toBeInTheDocument();
    expect(screen.getByLabelText("GitHub token")).toBeInTheDocument();
  });

  it("stores the token and shows the connected login", async () => {
    const user = userEvent.setup();
    mocked.setGithubToken.mockResolvedValue("octocat");
    render(<DevelopSolutions />);

    await user.type(await screen.findByLabelText("GitHub token"), "ghp_secret");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(mocked.setGithubToken).toHaveBeenCalledWith("ghp_secret"),
    );
    expect(await screen.findByText(/Connected as octocat/)).toBeInTheDocument();
    // the token never stays in the form
    expect(screen.queryByLabelText("GitHub token")).not.toBeInTheDocument();
  });

  it("links an existing repository to a Solution by URL", async () => {
    const user = userEvent.setup();
    mocked.linkSolutionRepo.mockResolvedValue(undefined);
    render(<DevelopSolutions />);

    await user.click(
      await screen.findByRole("button", { name: "Link a repo to Shop API" }),
    );
    await user.type(
      screen.getByLabelText("Repository URL"),
      "https://github.com/me/shop-api",
    );
    await user.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() =>
      expect(mocked.linkSolutionRepo).toHaveBeenCalledWith(
        3,
        "https://github.com/me/shop-api",
      ),
    );
  });

  it("cannot create a repo until GitHub is connected", async () => {
    render(<DevelopSolutions />);
    expect(
      await screen.findByRole("button", { name: "Create a repo for Shop API" }),
    ).toBeDisabled();
  });

  it("creates a private repo for a Solution once connected", async () => {
    const user = userEvent.setup();
    mocked.githubStatus.mockResolvedValue({ connected: true });
    mocked.createSolutionRepo.mockResolvedValue("https://github.com/me/shop-api");
    render(<DevelopSolutions />);

    await user.click(
      await screen.findByRole("button", { name: "Create a repo for Shop API" }),
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(mocked.createSolutionRepo).toHaveBeenCalledWith({
        solutionId: 3,
        repoName: "Shop API",
        private: true,
        description: "Repository for Shop API",
      }),
    );
  });

  it("shows the linked repository on a Solution", async () => {
    mocked.listSolutions.mockResolvedValue([
      {
        ...solution,
        origin: "imported",
        githubUrl: "https://github.com/me/shop-api",
        githubVisibility: "private",
      },
    ]);
    render(<DevelopSolutions />);
    expect(
      await screen.findByRole("link", { name: "https://github.com/me/shop-api" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/imported/)).toBeInTheDocument();
  });
});
