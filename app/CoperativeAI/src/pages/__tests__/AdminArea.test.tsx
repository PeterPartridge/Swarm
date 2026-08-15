import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminArea from "../AdminArea";
import { PermissionProvider } from "../../lib/permissions";
import type { Role, TeamMember } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listTeamMembers: vi.fn(),
    addTeamMember: vi.fn(),
    setMemberRole: vi.fn(),
    removeTeamMember: vi.fn(),
    listRoles: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
    getActivePermissions: vi.fn(),
    listProducts: vi.fn(),
    getDeveloperRules: vi.fn(),
    setDeveloperRules: vi.fn(),
    getProductPolicy: vi.fn(),
    setProductPolicy: vi.fn(),
    listAiProviders: vi.fn(),
    // Moved here with their components when Develop's Settings tab folded into
    // this page — the tests followed the thing they test.
    githubStatus: vi.fn(),
    setGithubToken: vi.fn(),
    removeGithubToken: vi.fn(),
    listModelStatus: vi.fn(),
    installModel: vi.fn(),
    refreshProviderModels: vi.fn(),
    setModelVision: vi.fn(),
    claudeCodeStatus: vi.fn(),
    getProductBudget: vi.fn(),
    sshStatus: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const adminRole: Role = {
  id: 1,
  name: "Admin",
  canProduct: true,
  canDevelop: true,
  canTest: true,
  canAdmin: true,
  seeCost: true,
  seeProfit: true,
  seeChargeable: true,
  canManageBudget: true,
  canMarketing: true,
  canDesign: true,
};
const devRole: Role = {
  id: 3,
  name: "Developer",
  canProduct: false,
  canDevelop: true,
  canTest: true,
  canAdmin: false,
  seeCost: false,
  seeProfit: false,
  seeChargeable: false,
  canManageBudget: false,
  canMarketing: false,
  canDesign: false,
};
const member: TeamMember = { id: 5, name: "Ada", roleId: null };

function renderAdmin() {
  return render(
    <PermissionProvider>
      <AdminArea />
    </PermissionProvider>,
  );
}

/** Admin is sectioned now — AI, Connections, People, Appearance — so a test
 *  that wants people has to go there, the way a person does. AI is the default,
 *  because setting the AI up is what brings most people to this page. */
async function openSection(
  user: ReturnType<typeof userEvent.setup>,
  name: "AI" | "Connections" | "People" | "Appearance",
) {
  await user.click(await screen.findByRole("tab", { name }));
}

describe("AdminArea", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listTeamMembers.mockResolvedValue([member]);
    mocked.listRoles.mockResolvedValue([adminRole, devRole]);
    mocked.listProducts.mockResolvedValue([
      { id: 1, name: "Shop App", answers: "{}" },
    ]);
    mocked.getDeveloperRules.mockResolvedValue(null);
    mocked.getProductPolicy.mockResolvedValue(null);
    mocked.listAiProviders.mockResolvedValue([]);
    mocked.githubStatus.mockResolvedValue({ connected: false });
    mocked.listModelStatus.mockResolvedValue([]);
    mocked.getProductBudget.mockResolvedValue(null);
    mocked.claudeCodeStatus.mockResolvedValue({
      installed: false,
      version: "",
      path: "",
      problem: "not installed",
      signedIn: false,
      authMethod: "",
    });
    mocked.getActivePermissions.mockResolvedValue({
      memberId: null,
      role: null,
      canProduct: true,
      canDevelop: true,
      canTest: true,
      canAdmin: true,
      seeCost: true,
      seeProfit: true,
      seeChargeable: true,
      canManageBudget: true,
      canMarketing: true,
      canDesign: true,
    });
  });

  it("lists members and roles", async () => {
    const user = userEvent.setup();
    renderAdmin();
    await openSection(user, "People");
    expect(await screen.findByText(/Ada/)).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "Role Admin" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "Role Developer" })).toBeInTheDocument();
  });

  it("assigns a role to a member", async () => {
    const user = userEvent.setup();
    mocked.setMemberRole.mockResolvedValue();
    renderAdmin();
    await openSection(user, "People");
    await user.selectOptions(await screen.findByLabelText("Role of Ada"), "3");
    await waitFor(() => expect(mocked.setMemberRole).toHaveBeenCalledWith(5, 3));
  });

  it("toggles a role's field visibility", async () => {
    const user = userEvent.setup();
    mocked.updateRole.mockResolvedValue();
    renderAdmin();
    await openSection(user, "People");
    await user.click(await screen.findByLabelText("Developer see Cost"));
    await waitFor(() =>
      expect(mocked.updateRole).toHaveBeenCalledWith(
        expect.objectContaining({ id: 3, seeCost: true }),
      ),
    );
  });

  it("adds a new role", async () => {
    const user = userEvent.setup();
    mocked.createRole.mockResolvedValue(9);
    renderAdmin();
    await openSection(user, "People");
    await user.type(await screen.findByLabelText("Role name"), "Designer");
    await user.click(screen.getByRole("button", { name: "Add role" }));
    await waitFor(() => expect(mocked.createRole).toHaveBeenCalledWith("Designer"));
  });

  it("won't offer to delete the Admin role", async () => {
    const user = userEvent.setup();
    renderAdmin();
    await openSection(user, "People");
    await screen.findByRole("row", { name: "Role Admin" });
    expect(
      screen.queryByRole("button", { name: "Delete role Admin" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete role Developer" }),
    ).toBeInTheDocument();
  });

  /// Every policy moved here from the area it governs: those who set what
  /// developers and the AI may do are not the same people it constrains. The
  /// AI planning policy and the developer rules both live in this one section.
  it("owns the policies, editable, per Product", async () => {
    renderAdmin();

    // AI is the section this page opens on, so the policies are already there.
    expect(await screen.findByLabelText("Policy product")).toBeInTheDocument();

    // the AI planning policy, moved out of the Product Strategy screen
    expect(await screen.findByRole("region", { name: "Product AI policy" })).toBeInTheDocument();
    expect(screen.getByLabelText("Allow AI to read this Product")).not.toBeChecked();

    // **The Developer Rules are no longer here.** They moved to Develop →
    // Rules, beside the strategy they qualify and the enforcement panel that
    // reports on them, so one place owns them and two copies cannot drift.
    // What stays is the policy deciding whether the AI may read this Product at
    // all — a different question, and genuinely an Admin one.
    expect(
      screen.queryByLabelText("Disallowed technologies (enforced)"),
    ).not.toBeInTheDocument();
  });

  it("saves the AI planning policy from Admin", async () => {
    const user = userEvent.setup();
    mocked.setProductPolicy.mockResolvedValue(undefined);
    renderAdmin();

    await user.click(await screen.findByLabelText("Allow AI to generate work items"));
    await waitFor(() =>
      expect(mocked.setProductPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 1, allowGenerate: true }),
      ),
    );
  });

  it("says so rather than showing an empty picker when there are no Products", async () => {
    mocked.listProducts.mockResolvedValue([]);
    renderAdmin();

    expect(
      await screen.findByText(/per-Product AI policies appear once there is one/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Policy product")).not.toBeInTheDocument();
  });

  /// **The merge.** Settings used to be in two places, so finding one meant
  /// knowing which first. Everything that was behind Develop → Settings is on
  /// this page now, in the section it belongs to.
  it("holds the AI settings that used to live in Develop", async () => {
    renderAdmin();

    // AI providers and the Ollama model list, both formerly in Develop.
    expect(await screen.findByRole("region", { name: "AI Settings" })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Claude setup" }),
    ).toBeInTheDocument();
  });

  it("holds the GitHub and SSH connections that used to live in Develop", async () => {
    const user = userEvent.setup();
    renderAdmin();
    await openSection(user, "Connections");

    expect(await screen.findByRole("region", { name: "GitHub" })).toBeInTheDocument();
    // …and they are not competing for space with the AI section.
    expect(screen.queryByRole("region", { name: "AI Settings" })).not.toBeInTheDocument();
  });

  /// One section at a time is the point: the page was a single scroll of every
  /// setting in the app, which is worse the more it holds.
  it("shows one section at a time", async () => {
    const user = userEvent.setup();
    renderAdmin();

    expect(await screen.findByRole("region", { name: "AI Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Team members" })).not.toBeInTheDocument();

    await openSection(user, "People");
    expect(await screen.findByRole("region", { name: "Team members" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "AI Settings" })).not.toBeInTheDocument();
  });

  /// "What can the platform actually use?" is the question this panel is opened
  /// with, and it used to be answerable only by reading every row.
  it("counts the installed models apart from the ones still waiting", async () => {
    const user = userEvent.setup();
    mocked.listModelStatus.mockResolvedValue([
      {
        providerId: 1, provider: "Ollama", model: "ornith:9b", state: "detected",
        packPath: "", validationReport: "", supportsVision: false,
      },
      {
        providerId: 1, provider: "Ollama", model: "wren:7b", state: "installed",
        packPath: "", validationReport: "", supportsVision: false,
      },
      {
        providerId: 1, provider: "Ollama", model: "finch:3b", state: "failed",
        packPath: "", validationReport: "", supportsVision: false,
      },
    ]);
    render(<AdminArea />);

    const models = await screen.findByRole("region", { name: "Models" });
    // Asserted on the panel rather than per-element: each tally is a count in a
    // <strong> beside its label, so the words and the number are two nodes.
    expect(await within(models).findByText("wren:7b")).toBeInTheDocument();
    expect(models).toHaveTextContent("1 installed and usable");
    expect(models).toHaveTextContent("1 awaiting install");
    expect(models).toHaveTextContent("1 failed validation");

    // Everything is listed by default, so the Install buttons stay reachable…
    expect(within(models).getByText("ornith:9b")).toBeInTheDocument();
    // …and the filter narrows to the ones the platform will actually use.
    await user.click(within(models).getByRole("button", { name: "Show installed only" }));
    expect(within(models).getByText("wren:7b")).toBeInTheDocument();
    expect(within(models).queryByText("ornith:9b")).not.toBeInTheDocument();
    expect(within(models).queryByText("finch:3b")).not.toBeInTheDocument();
  });

  /// A model appearing on a provider does not make it usable — the whole point
  /// of the install gate.
  it("shows a newly detected model as not yet installed", async () => {
    const user = userEvent.setup();
    mocked.listModelStatus.mockResolvedValue([
      {
        providerId: 2,
        provider: "Ollama (local)",
        model: "ornith:9b",
        state: "detected",
        packPath: "",
        validationReport: "{}",
        supportsVision: false,
      },
    ]);
    renderAdmin();
    await openSection(user, "AI");

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
        supportsVision: false,
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
    renderAdmin();
    await openSection(user, "AI");

    await user.click(await screen.findByRole("button", { name: "Install ornith:9b" }));

    await waitFor(() => expect(mocked.installModel).toHaveBeenCalledWith(2, "ornith:9b", 1));
    expect(await screen.findByText(/passed every check/)).toBeInTheDocument();
  });

  /// All-or-nothing: a failed probe leaves the model blocked, and the user is
  /// told which check failed and what to do about it.
  it("names the failed check and keeps a failing model blocked", async () => {
    const user = userEvent.setup();
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
        supportsVision: false,
      },
    ]);
    renderAdmin();
    await openSection(user, "AI");

    expect(await screen.findByText(/Failed validation/)).toBeInTheDocument();
    expect(screen.getByText(/invented kinds: microservice/)).toBeInTheDocument();
    expect(screen.getByText(/can only file these/)).toBeInTheDocument();
    // still offered for installation, never for use
    expect(screen.getByRole("button", { name: "Install tiny:1b" })).toBeInTheDocument();
  });

  /// Whether a model can see is a person's answer, not a guess: the platform
  /// cannot establish it without spending a call, and being wrong costs money
  /// either way. So it starts off, and turning it on is a deliberate act.
  it("lets someone record that a model can see pictures", async () => {
    const user = userEvent.setup();
    mocked.listModelStatus.mockResolvedValue([
      {
        providerId: 2,
        provider: "Ollama (local)",
        model: "seer:7b",
        state: "installed",
        packPath: "packs/seer_7b",
        validationReport: "{}",
        supportsVision: false,
      },
    ]);
    mocked.setModelVision.mockResolvedValue(undefined);
    renderAdmin();
    await openSection(user, "AI");

    const toggle = await screen.findByLabelText(/can see pictures/);
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    await waitFor(() =>
      expect(mocked.setModelVision).toHaveBeenCalledWith(2, "seer:7b", true),
    );
    expect(await screen.findByText(/will be shown UI mockups/)).toBeInTheDocument();
  });

  it("offers to connect GitHub when no token is stored", async () => {
    const user = userEvent.setup();
    renderAdmin();
    await openSection(user, "Connections");
    expect(await screen.findByRole("region", { name: "GitHub" })).toBeInTheDocument();
    expect(screen.getByLabelText("GitHub token")).toBeInTheDocument();
  });

  it("stores the token and shows the connected login", async () => {
    const user = userEvent.setup();
    mocked.setGithubToken.mockResolvedValue("octocat");
    renderAdmin();
    await openSection(user, "Connections");

    await user.type(await screen.findByLabelText("GitHub token"), "ghp_secret");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(mocked.setGithubToken).toHaveBeenCalledWith("ghp_secret"),
    );
    expect(await screen.findByText(/Connected as octocat/)).toBeInTheDocument();
    // the token never stays in the form
    expect(screen.queryByLabelText("GitHub token")).not.toBeInTheDocument();
  });

});
