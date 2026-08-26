import { render, screen, waitFor, within } from "@testing-library/react";
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
    createSolutionWithStarter: vi.fn(),
    listStarters: vi.fn(),
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
    setModelVision: vi.fn(),
    setGithubToken: vi.fn(),
    removeGithubToken: vi.fn(),
    linkSolutionRepo: vi.fn(),
    createSolutionRepo: vi.fn(),
    listArchitectureDocs: vi.fn(),
    listRepoLinks: vi.fn(),
    readSolutionTree: vi.fn(),
    reviewSolutionChanges: vi.fn(),
    setSolutionPath: vi.fn(),
    // Rules is the opening tab, and it reads both of these. Left unmocked they
    // fall through to the real invoke, each panel renders an error alert, and
    // every assertion below still passes — the trap this repo keeps hitting.
    listAiJobs: vi.fn(),
    getDeveloperRules: vi.fn(),
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
  testCommand: null,
  language: null,
  runCommand: null,
  startFrom: null,
  kindLocations: "{}",
};

/** The area is tabbed now: Planning is the default; everything else lives
 *  behind its section button. */
async function openSection(
  user: ReturnType<typeof userEvent.setup>,
  name: "Rules" | "Work" | "Build" | "Map",
) {
  await user.click(await screen.findByRole("button", { name }));
}

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
    mocked.listAiJobs.mockResolvedValue([]);
    mocked.getDeveloperRules.mockResolvedValue(null);
    mocked.listStarters.mockResolvedValue([
      {
        id: "rust",
        label: "Rust (cargo)",
        command: "cargo init --name {name}",
        needs: "the Rust toolchain (rustup)",
      },
    ]);
  });

  /// The area is tabbed: one section at a time, Planning first. Ten sections
  /// in one scrolling column had stopped being a page.
  it("shows one section at a time, opening on Planning", async () => {
    const user = userEvent.setup();
    render(<DevelopSolutions />);

    expect(await screen.findByRole("region", { name: "Technical Strategy" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Create a Solution" })).not.toBeInTheDocument();

    await openSection(user, "Map");
    expect(await screen.findByRole("region", { name: "Create a Solution" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Technical Strategy" })).not.toBeInTheDocument();
  });

  /// Settings are Admin's now, all of them. Develop having its own Settings tab
  /// meant two places to look for one, and knowing which before you could look.
  it("no longer carries a Settings tab", async () => {
    render(<DevelopSolutions />);
    await screen.findByRole("region", { name: "Technical Strategy" });

    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "AI Settings" })).not.toBeInTheDocument();
  });

  /// **The honesty rule, in Rules.** The design opened with a scoreboard — 68%
  /// of agent PRs merged first try, an 11-minute median, "4/4 rules enforced" —
  /// and a count beside every rule. The app records none of it. What it does
  /// know is which of the seven rules is actually checked, and it says so.
  it("marks the one rule that is checked, and claims no counts for the rest", async () => {
    render(<DevelopSolutions />);
    await screen.findByRole("region", { name: "Technical Strategy" });

    const rules = screen.getByRole("region", { name: "Developer Rules" });
    // Exactly one enforced badge, against disallowed technologies.
    expect(within(rules).getAllByText("Enforced")).toHaveLength(1);
    expect(within(rules).getAllByText("In the prompt")).toHaveLength(6);
    expect(rules).toHaveTextContent(/does not count how often any\s+rule fired/);
    // Nothing that looks like the design's per-rule tallies.
    expect(rules.textContent).not.toMatch(/\d+ checks/);
    expect(rules.textContent).not.toMatch(/\d+ blocks/);
  });

  /// "Where agents stopped" is read from the job queue, because that is the
  /// record the app actually keeps — not a rule-violation tally it does not.
  it("lists the agents that stopped, with the reason each gave", async () => {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    mocked.listAiJobs.mockResolvedValue([
      {
        id: 1, workItemId: 9, workItemTitle: "Add checkout", purpose: "changePlan",
        state: "blocked", message: "No acceptance criteria on the item.",
        submittedAt: hourAgo, startedAt: null, finishedAt: hourAgo,
      },
      {
        id: 2, workItemId: 10, workItemTitle: "Add refunds", purpose: "changePlan",
        state: "done", message: "fine", submittedAt: hourAgo,
        startedAt: null, finishedAt: null,
      },
    ]);
    render(<DevelopSolutions />);

    const panel = await screen.findByRole("complementary", { name: "Where agents stopped" });
    // Awaited on the content, not the panel: the panel renders its empty state
    // first and the jobs land a tick later.
    expect(await within(panel).findByText("Add checkout")).toBeInTheDocument();
    expect(panel).toHaveTextContent("No acceptance criteria on the item.");
    // A job that finished is not something that stopped.
    expect(panel).not.toHaveTextContent("Add refunds");
  });

  /// The design said "this week". Listing every stopped job ever made the panel
  /// a history rather than a state of play, so a week leads and the older ones
  /// are counted rather than silently dropped.
  it("windows the stopped jobs to a week, and says what is older", async () => {
    const user = userEvent.setup();
    const longAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
    mocked.listAiJobs.mockResolvedValue([
      {
        id: 1, workItemId: 9, workItemTitle: "Add checkout", purpose: "changePlan",
        state: "blocked", message: "No acceptance criteria.",
        submittedAt: longAgo, startedAt: null, finishedAt: longAgo,
      },
    ]);
    render(<DevelopSolutions />);

    const panel = await screen.findByRole("complementary", { name: "Where agents stopped" });
    expect(await within(panel).findByText(/1 older job stopped/)).toBeInTheDocument();
    expect(panel).not.toHaveTextContent("Add checkout");

    await user.click(within(panel).getByRole("button", { name: "All" }));
    expect(await within(panel).findByText("Add checkout")).toBeInTheDocument();
  });

  it("shows the Technical Strategy on Planning and the views on Work", async () => {
    const user = userEvent.setup();
    render(<DevelopSolutions />);
    expect(await screen.findByRole("region", { name: "Technical Strategy" })).toBeInTheDocument();
    expect(screen.getByLabelText("Required infrastructure")).toBeInTheDocument();

    await openSection(user, "Work");
    expect(await screen.findByRole("region", { name: "Work views" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Board" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sprint" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "List" })).toBeInTheDocument();
  });

  /// The editor is the first entry of the Build tab, reached by
  /// opening a Solution — so the two tabs stay one flow.
  it("opens a Solution from the Workspace tab into the merged panel", async () => {
    const user = userEvent.setup();
    mocked.listSolutions.mockResolvedValue([{ ...solution, localPath: "C:/repos/shop-api" }]);
    render(<DevelopSolutions />);

    // Nothing open yet: the Code tab offers the way forward itself rather than
    // sending someone to another tab to press a button.
    await openSection(user, "Build");
    expect(await screen.findByLabelText("Solution to open")).toBeInTheDocument();

    await openSection(user, "Map");
    await user.click(await screen.findByLabelText("Open Shop API in the code editor"));

    // …and it lands on the Code tab with that Solution's explorer.
    expect(await screen.findByRole("list", { name: "Files in Shop API" })).toBeInTheDocument();
  });

  it("no longer manages team members here (moved to Admin)", async () => {
    const user = userEvent.setup();
    render(<DevelopSolutions />);
    await openSection(user, "Map");
    await screen.findByRole("region", { name: "Create a Solution" });
    expect(screen.queryByLabelText("Member name")).not.toBeInTheDocument();
  });

  it("creates a Solution linked to a Product with the spec questions", async () => {
    const user = userEvent.setup();
    mocked.createSolutionWithStarter.mockResolvedValue({ solutionId: 4, started: null });
    render(<DevelopSolutions />);
    await openSection(user, "Map");

    await user.type(await screen.findByLabelText("Solution name"), "Shop Website");
    await user.selectOptions(screen.getByLabelText("Solution type"), "website");
    await user.type(
      screen.getByLabelText(/purpose of this solution/i),
      "The storefront",
    );
    await user.click(screen.getByRole("button", { name: "Create Solution" }));

    await waitFor(() =>
      expect(mocked.createSolutionWithStarter).toHaveBeenCalledWith({
        name: "Shop Website",
        productId: 1,
        solutionType: "website",
        // The language question is answered by the starter picker, so it is
        // always present — empty when nobody chose one.
        answers: JSON.stringify({ purpose: "The storefront", language: "" }),
        starterId: null,
        command: null,
        parentDir: null,
        languageName: null,
      }),
    );
  });

  /// The language dropdown. Picking one fills in that toolchain's own command
  /// and shows it — the button press is the confirmation, so nothing runs that
  /// could not be read first.
  it("offers a starter language and shows the command before it runs", async () => {
    const user = userEvent.setup();
    mocked.createSolutionWithStarter.mockResolvedValue({
      solutionId: 4,
      started: {
        command: "cargo init --name shop-core",
        directory: "C:/repos/shop-core",
        succeeded: true,
        output: "Created binary (application) package",
      },
    });
    render(<DevelopSolutions />);
    await openSection(user, "Map");

    await user.type(await screen.findByLabelText("Solution name"), "Shop Core");
    await user.selectOptions(await screen.findByLabelText("Starter language"), "rust");

    // the command is filled in from the starter and is editable
    expect(await screen.findByLabelText("Starter command")).toHaveValue(
      "cargo init --name {name}",
    );
    expect(screen.getByText(/Rust toolchain/)).toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Folder to create the project in"),
      "C:/repos",
    );
    await user.click(
      screen.getByRole("button", { name: "Create Solution and start it" }),
    );

    await waitFor(() =>
      expect(mocked.createSolutionWithStarter).toHaveBeenCalledWith(
        expect.objectContaining({
          starterId: "rust",
          command: "cargo init --name {name}",
          parentDir: "C:/repos",
        }),
      ),
    );
    expect(await screen.findByText(/Started in C:\/repos\/shop-core/)).toBeInTheDocument();
  });

  /// The language question *is* the starter picker — asking it twice, once as
  /// prose and once as a dropdown, invites two different answers, and the one
  /// the generator uses would not be the one anybody read.
  it("answers the language question with the starter picker", async () => {
    const user = userEvent.setup();
    render(<DevelopSolutions />);
    await openSection(user, "Map");

    const picker = await screen.findByLabelText("Starter language");
    expect(picker.tagName).toBe("SELECT");
    // and there is no separate free-text box asking the same thing
    expect(screen.queryByRole("textbox", { name: /language/i })).not.toBeInTheDocument();

    await user.selectOptions(picker, "rust");
    expect(await screen.findByLabelText("Starter command")).toHaveValue(
      "cargo init --name {name}",
    );
  });

  /// "Something else" carries neither a name nor a command of its own, so both
  /// are asked for — a Solution recorded as started in "custom" tells nobody
  /// anything a year later.
  it("asks for a name as well as a command when the language is something else", async () => {
    const user = userEvent.setup();
    mocked.listStarters.mockResolvedValue([
      {
        id: "custom",
        label: "Something else — I'll type the command",
        command: "",
        needs: "whatever the command needs",
      },
    ]);
    mocked.createSolutionWithStarter.mockResolvedValue({ solutionId: 4, started: null });
    render(<DevelopSolutions />);
    await openSection(user, "Map");

    await user.type(await screen.findByLabelText("Solution name"), "Shop Core");
    await user.selectOptions(await screen.findByLabelText("Starter language"), "custom");

    await user.type(await screen.findByLabelText("Language name"), "Elixir");
    await user.type(screen.getByLabelText("Starter command"), "mix new .");
    await user.type(screen.getByLabelText("Folder to create the project in"), "C:/repos");
    await user.click(
      screen.getByRole("button", { name: "Create Solution and start it" }),
    );

    await waitFor(() =>
      expect(mocked.createSolutionWithStarter).toHaveBeenCalledWith(
        expect.objectContaining({
          starterId: "custom",
          command: "mix new .",
          // recorded as the language someone named, not as "custom"
          languageName: "Elixir",
          answers: JSON.stringify({ language: "Elixir" }),
        }),
      ),
    );
  });

  /// A generator that failed leaves the Solution behind and says so in the
  /// toolchain's own words — which are the only thing that names the missing
  /// toolchain.
  it("keeps the Solution and reports the words when a starter fails", async () => {
    const user = userEvent.setup();
    mocked.createSolutionWithStarter.mockResolvedValue({
      solutionId: 4,
      started: {
        command: "cargo init --name shop-core",
        directory: "C:/repos/shop-core",
        succeeded: false,
        output: "'cargo' is not recognized as an internal or external command",
      },
    });
    render(<DevelopSolutions />);
    await openSection(user, "Map");

    await user.type(await screen.findByLabelText("Solution name"), "Shop Core");
    await user.selectOptions(await screen.findByLabelText("Starter language"), "rust");
    await user.type(screen.getByLabelText("Folder to create the project in"), "C:/repos");
    await user.click(screen.getByRole("button", { name: "Create Solution and start it" }));

    expect(await screen.findByText(/The Solution was still created/)).toBeInTheDocument();
    expect(screen.getByText(/is not recognized/)).toBeInTheDocument();
  });

  it("lists existing solutions under their product", async () => {
    const user = userEvent.setup();
    render(<DevelopSolutions />);
    await openSection(user, "Map");
    // Scoped to the list: Solution names also appear in the architecture
    // panel that now shares this tab, and an unscoped match finds both.
    const list = await screen.findByRole("region", { name: "Create a Solution" });
    expect(within(list).getByText(/Shop API/)).toBeInTheDocument();
    expect(within(list).getByText(/\(api\) — Shop App/)).toBeInTheDocument();
  });

  it("asks to create a Product first when none exist", async () => {
    const user = userEvent.setup();
    mocked.listProducts.mockResolvedValue([]);
    render(<DevelopSolutions />);
    await openSection(user, "Map");
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
    await openSection(user, "Map");

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
    await openSection(user, "Map");

    await user.click(
      await screen.findByRole("button", { name: "Generate framework files" }),
    );

    expect(await screen.findByText(".CoperativeAI/pages/checkout.md")).toBeInTheDocument();
    expect(screen.getByText(/Your edits are safe/)).toBeInTheDocument();
  });





  /// The other half of the move: Develop shows the rules developers work
  /// under, but cannot edit them. Two editors for one set of rules would
  /// drift, and the drift would be invisible until the AI obeyed the wrong
  /// copy.
  /// **This is where the rules are edited now.** They used to be set in Admin
  /// and shown read-only here, which put them a screen away from the strategy
  /// they qualify and from the enforcement panel that reports on them — so the
  /// people writing them were the ones sent elsewhere.
  it("edits the developer rules here, not in Admin", async () => {
    render(<DevelopSolutions />);

    const disallowed = await screen.findByLabelText("Disallowed technologies (enforced)");
    expect(disallowed).not.toHaveAttribute("readonly");
    // And nothing sends anybody to Admin for them any more.
    expect(screen.queryByText(/set in the Admin area/)).not.toBeInTheDocument();
  });



  it("links an existing repository to a Solution by URL", async () => {
    const user = userEvent.setup();
    mocked.linkSolutionRepo.mockResolvedValue(undefined);
    render(<DevelopSolutions />);
    await openSection(user, "Map");

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
    const user = userEvent.setup();
    render(<DevelopSolutions />);
    await openSection(user, "Map");
    expect(
      await screen.findByRole("button", { name: "Create a repo for Shop API" }),
    ).toBeDisabled();
  });

  it("creates a private repo for a Solution once connected", async () => {
    const user = userEvent.setup();
    mocked.githubStatus.mockResolvedValue({ connected: true });
    mocked.createSolutionRepo.mockResolvedValue("https://github.com/me/shop-api");
    render(<DevelopSolutions />);
    await openSection(user, "Map");

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
    const user = userEvent.setup();
    mocked.listSolutions.mockResolvedValue([
      {
        ...solution,
        origin: "imported",
        githubUrl: "https://github.com/me/shop-api",
        githubVisibility: "private",
      },
    ]);
    render(<DevelopSolutions />);
    await openSection(user, "Map");
    expect(
      await screen.findByRole("link", { name: "https://github.com/me/shop-api" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/imported/)).toBeInTheDocument();
  });
});
