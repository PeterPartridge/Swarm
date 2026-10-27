import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PolicySource from "../../components/ai/PolicySource";
import * as backend from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    getAgentPolicySource: vi.fn(),
    setAgentPolicySource: vi.fn(),
    fetchAgentPolicy: vi.fn(),
    runAgentPolicy: vi.fn(),
    getInstalledPolicy: vi.fn(),
    listSolutions: vi.fn(),
    previewPolicyInstall: vi.fn(),
    installPolicyIntoSolution: vi.fn(),
  };
});

const mocked = vi.mocked(backend);

const saved = {
  from: "https://example.com/policies/strict.json",
  folder: "C:\\policies",
  command: "sh apply.sh",
  expectDigest: "",
};

describe("PolicySource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getAgentPolicySource.mockResolvedValue(saved);
    // Nothing run into the boundary is the ordinary starting state.
    mocked.getInstalledPolicy.mockResolvedValue({ from: "", digest: "", mode: "", at: 0 });
  });

  /** **Three presses, not one.** A single button would make the reading
   *  optional, and the reading is the only safeguard there is against a policy
   *  somebody else wrote — it runs as root inside the boundary. */
  it("will not run anything that has not been fetched and shown first", async () => {
    render(<PolicySource />);
    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "Run it" })).toBeDisabled();

    mocked.fetchAgentPolicy.mockResolvedValue({
      path: "C:\\policies\\strict.json",
      bytes: 42,
      text: '{"deny": ["secrets/**"]}',
      truncated: false,
    digest: "a".repeat(64),
    verified: false,
    shape: "script" as const,
    });
    await userEvent.click(screen.getByRole("button", { name: "Fetch it" }));

    // Shown, in full, before anything can run it.
    expect(await screen.findByText('{"deny": ["secrets/**"]}')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run it" })).toBeEnabled();
    expect(mocked.runAgentPolicy).not.toHaveBeenCalled();
  });

  /** Fetching brings it here. It must never also run it. */
  it("fetching does not run anything", async () => {
    mocked.fetchAgentPolicy.mockResolvedValue({
      path: "C:\\policies\\strict.json",
      bytes: 4,
      text: "{}",
      truncated: false,
    digest: "a".repeat(64),
    verified: false,
    shape: "script" as const,
    });

    render(<PolicySource />);
    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Fetch it" }));

    await screen.findByText("{}");
    expect(mocked.runAgentPolicy).toHaveBeenCalledTimes(0);
  });

  /** A refusal is the useful part — it says why nothing could be restricted. */
  it("says why a policy could not be run, rather than looking as though it was", async () => {
    mocked.fetchAgentPolicy.mockResolvedValue({
      path: "p",
      bytes: 2,
      text: "{}",
      truncated: false,
    digest: "a".repeat(64),
    verified: false,
    shape: "script" as const,
    });
    mocked.runAgentPolicy.mockRejectedValue(
      "with agents running on this machine there is no separate user to keep anything from",
    );

    render(<PolicySource />);
    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Fetch it" }));
    await userEvent.click(await screen.findByRole("button", { name: "Run it" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no separate user");
  });

  /** **Saved is not in force**, and the gap is where somebody would assume a
   *  protection they do not have. */
  it("never suggests that saving a source restricts anything", async () => {
    render(<PolicySource />);
    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());

    expect(
      screen.getByText(/only restricts anything once it has been run/),
    ).toBeInTheDocument();
  });

  /** **The limit a person would otherwise find the hard way.** Both mechanisms
   *  work on the working copy and neither touches git's own storage, so a
   *  committed file is still reachable through history. Saying so is the
   *  difference between a useful tool and one that is trusted for the wrong
   *  job. */
  it("says that a committed path is still reachable through history", async () => {
    render(<PolicySource />);
    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());

    expect(
      screen.getByText(/stays in the repository's history/),
    ).toBeInTheDocument();
  });

  /** **A digest on screen is not integrity.** Until something was set to check
   *  it against, a fetch was checked against nothing — and the panel has to say
   *  so, because the digest itself looks like proof either way. */
  it("does not let an unchecked digest read as a verified one", async () => {
    mocked.fetchAgentPolicy.mockResolvedValue({
      path: "p",
      bytes: 2,
      text: "{}",
      truncated: false,
      digest: "b".repeat(64),
      verified: false,
      shape: "script" as const,
    });

    render(<PolicySource />);
    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());
    expect(screen.getByText(/checked against nothing/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Fetch it" }));
    expect(await screen.findByText(/not checked against anything/)).toBeInTheDocument();
  });

  /** Pinning is what turns the digest from an observation into a check, and it
   *  must save in the same press — a digest shown in a box and never stored is
   *  the one state that looks pinned and checks nothing. */
  it("pinning a fetched digest saves it, and the next fetch says it was checked", async () => {
    mocked.fetchAgentPolicy.mockResolvedValue({
      path: "p",
      bytes: 2,
      text: "{}",
      truncated: false,
      digest: "c".repeat(64),
      verified: false,
      shape: "script" as const,
    });
    mocked.setAgentPolicySource.mockResolvedValue(undefined);

    render(<PolicySource />);
    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Fetch it" }));
    await userEvent.click(await screen.findByRole("button", { name: "Pin this digest" }));

    await waitFor(() =>
      expect(mocked.setAgentPolicySource).toHaveBeenCalledWith(
        expect.objectContaining({ expectDigest: "c".repeat(64) }),
      ),
    );
    expect(await screen.findByText(/Every fetch is checked against this/)).toBeInTheDocument();
  });

  /** A policy that is not the one pinned comes back as a refusal, and the
   *  refusal carries both digests — the useful question afterwards is whether
   *  it changed on purpose, which is answered by comparing them. */
  it("shows the refusal when what arrives is not what was pinned", async () => {
    mocked.getAgentPolicySource.mockResolvedValue({ ...saved, expectDigest: "d".repeat(64) });
    mocked.fetchAgentPolicy.mockRejectedValue(
      `is not the policy that was pinned, so nothing was saved.\nexpected ${"d".repeat(64)}\n     got ${"e".repeat(64)}`,
    );

    render(<PolicySource />);
    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Fetch it" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("not the policy that was pinned");
    // And nothing is offered to run, because nothing was saved.
    expect(screen.getByRole("button", { name: "Run it" })).toBeDisabled();
  });

  /** **A branch is a script that can change after somebody approved it**, and
   *  saying so as it is typed beats a refusal that arrives on Save. */
  it("warns as a branch address is typed, and stops once a digest pins it", async () => {
    mocked.getAgentPolicySource.mockResolvedValue({
      ...saved,
      from: "https://raw.githubusercontent.com/o/r/main/policy.json",
      expectDigest: "",
    });

    const { unmount } = render(<PolicySource />);
    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());
    expect(screen.getByText(/is a branch, so this would fetch/)).toBeInTheDocument();
    unmount();

    mocked.getAgentPolicySource.mockResolvedValue({
      ...saved,
      from: "https://raw.githubusercontent.com/o/r/main/policy.json",
      expectDigest: "f".repeat(64),
    });
    render(<PolicySource />);
    await waitFor(() => expect(screen.queryByText(/is a branch, so this would fetch/)).toBeNull());
  });
});

describe("what the boundary has had run into it", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getAgentPolicySource.mockResolvedValue(saved);
  });

  /** **What was run, never what is in force.** Nothing watches the distribution
   *  afterwards and root inside it can undo anything the script did, so present
   *  tense would be a claim this app cannot support. */
  it("says a script ran and when, without claiming it is still in force", async () => {
    mocked.getInstalledPolicy.mockResolvedValue({
      from: "https://example.com/lockdown.sh",
      digest: "a".repeat(64),
      mode: "wsl",
      at: Date.UTC(2026, 2, 4, 9, 30),
    });

    render(<PolicySource />);

    expect(await screen.findByText(/Last run into the distribution/)).toBeInTheDocument();
    expect(screen.getByText(/says a script ran, not that what it did is still in place/))
      .toBeInTheDocument();
    // And the record's own fragility is said, not left to be discovered.
    expect(screen.getByText(/setting the sandbox up again clears this record/)).toBeInTheDocument();
  });

  /** **The two mechanisms are never blurred.** A Solution's own policy file is
   *  enforced on every run whether or not a script was ever installed, and a
   *  panel that went quiet here would invite reading "no script" as "nothing
   *  protects anything". */
  it("distinguishes no script run from a Solution's own policy file", async () => {
    mocked.getInstalledPolicy.mockResolvedValue({ from: "", digest: "", mode: "", at: 0 });

    render(<PolicySource />);

    expect(await screen.findByText(/No policy script has been run into the boundary/))
      .toBeInTheDocument();
    expect(screen.getByText(/that is a different mechanism from this one/)).toBeInTheDocument();
  });

  /** Not knowing what was installed is not the source panel failing, and must
   *  not present as though the whole card were broken. */
  it("still shows the source when what was installed cannot be read", async () => {
    mocked.getInstalledPolicy.mockRejectedValue("no answer");

    render(<PolicySource />);

    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Fetch it" })).toBeInTheDocument();
  });

  /** Read back from the backend rather than assumed, so what is shown is what
   *  was actually written down. */
  it("re-reads what was installed after running one", async () => {
    mocked.getInstalledPolicy.mockResolvedValue({ from: "", digest: "", mode: "", at: 0 });
    mocked.fetchAgentPolicy.mockResolvedValue({
      path: "p",
      bytes: 2,
      text: "{}",
      truncated: false,
      digest: "b".repeat(64),
      verified: false,
      shape: "script" as const,
    });
    mocked.runAgentPolicy.mockResolvedValue("done");

    render(<PolicySource />);
    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Fetch it" }));

    mocked.getInstalledPolicy.mockResolvedValue({
      from: "https://example.com/lockdown.sh",
      digest: "b".repeat(64),
      mode: "wsl",
      at: Date.UTC(2026, 2, 4),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Run it" }));

    expect(await screen.findByText(/Last run into the distribution/)).toBeInTheDocument();
    expect(mocked.getInstalledPolicy).toHaveBeenCalledTimes(2);
  });
});

describe("a fetched policy goes into a Solution", () => {
  const policy = {
    path: "C:\\policies\\shared.json",
    bytes: 30,
    text: '{"deny": ["secrets", ".env"]}',
    truncated: false,
    digest: "a".repeat(64),
    verified: true,
    shape: "policy" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getAgentPolicySource.mockResolvedValue(saved);
    mocked.getInstalledPolicy.mockResolvedValue({ from: "", digest: "", mode: "", at: 0 });
    mocked.fetchAgentPolicy.mockResolvedValue(policy);
    mocked.listSolutions.mockResolvedValue([
      { id: 4, name: "Checkout" },
      { id: 7, name: "Billing" },
    ] as never);
  });

  /** **The button that cannot act is gone, not present and failing.** Running a
   *  deny list as a shell script would do nothing useful and might do something
   *  harmful. */
  it("does not offer to run a policy as a script", async () => {
    render(<PolicySource />);
    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Fetch it" }));

    await screen.findByText(/This is a policy/);
    expect(screen.getByRole("button", { name: "Run it" })).toBeDisabled();
    // And it names the route a script never had.
    expect(screen.getByText(/it works under Docker too/)).toBeInTheDocument();
  });

  /** **Applies nothing until it has been shown.** The removals are rules
   *  somebody believed were being enforced, and one going without a decision is
   *  the failure worth a second press. */
  it("will not install until what would change has been shown", async () => {
    mocked.previewPolicyInstall.mockResolvedValue({
      added: [".env"],
      removed: ["config/keys.json"],
      kept: ["secrets"],
      hadOne: true,
    });

    render(<PolicySource />);
    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Fetch it" }));

    const install = await screen.findByRole("button", { name: "Install it" });
    expect(install).toBeDisabled();
    expect(mocked.installPolicyIntoSolution).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "What would change?" }));

    // The removal is stated, not buried among the additions.
    expect(await screen.findByText(/Would stop enforcing: config\/keys\.json/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install it" })).toBeEnabled();
  });

  /** The Solution chosen is the Solution written to. */
  it("installs into the chosen Solution, and says so", async () => {
    mocked.previewPolicyInstall.mockResolvedValue({
      added: [".env"],
      removed: [],
      kept: [],
      hadOne: false,
    });
    mocked.installPolicyIntoSolution.mockResolvedValue({
      added: [".env"],
      removed: [],
      kept: [],
      hadOne: false,
    });

    render(<PolicySource />);
    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Fetch it" }));

    await userEvent.selectOptions(await screen.findByLabelText("Install into"), "7");
    await userEvent.click(screen.getByRole("button", { name: "What would change?" }));
    await waitFor(() => expect(mocked.previewPolicyInstall).toHaveBeenCalledWith(7, policy));

    await userEvent.click(await screen.findByRole("button", { name: "Install it" }));
    await waitFor(() =>
      expect(mocked.installPolicyIntoSolution).toHaveBeenCalledWith(7, policy),
    );
    expect(await screen.findByText(/Written into Billing/)).toBeInTheDocument();
    expect(screen.getByText(/That Solution has no policy today/)).toBeInTheDocument();
  });

  /** A plan belongs to the Solution it was computed for — leaving it on screen
   *  after the picker moves would describe a change to somewhere else. */
  it("forgets the plan when a different Solution is chosen", async () => {
    mocked.previewPolicyInstall.mockResolvedValue({
      added: [],
      removed: ["config/keys.json"],
      kept: [],
      hadOne: true,
    });

    render(<PolicySource />);
    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Fetch it" }));
    await userEvent.click(await screen.findByRole("button", { name: "What would change?" }));
    await screen.findByText(/Would stop enforcing/);

    await userEvent.selectOptions(screen.getByLabelText("Install into"), "7");

    expect(screen.queryByText(/Would stop enforcing/)).toBeNull();
    expect(screen.getByRole("button", { name: "Install it" })).toBeDisabled();
  });

  /** A script still gets the script route, and no Solution picker. */
  it("offers the script route for a script", async () => {
    mocked.fetchAgentPolicy.mockResolvedValue({ ...policy, shape: "script", text: "chmod 000 x" });

    render(<PolicySource />);
    await waitFor(() => expect(mocked.getAgentPolicySource).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Fetch it" }));

    expect(await screen.findByText("chmod 000 x")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run it" })).toBeEnabled();
    expect(screen.queryByLabelText("Install into")).toBeNull();
    expect(mocked.listSolutions).not.toHaveBeenCalled();
  });
});

/** The address rule itself, apart from the panel that shows it. This is the
 *  hint, never the enforcement — `sandbox_policy.rs` is what refuses to store
 *  one — but the two are meant to agree, so they are checked on the same
 *  addresses. */
describe("movingGithubRef", () => {
  it("tells a branch from a commit", () => {
    const commit = "a".repeat(40);
    expect(backend.movingGithubRef("https://github.com/o/r/blob/main/policy.json")).toBe("main");
    expect(backend.movingGithubRef("https://raw.githubusercontent.com/o/r/main/p.json")).toBe(
      "main",
    );
    expect(backend.movingGithubRef("https://github.com/o/r/raw/release-2/deep/p.json")).toBe(
      "release-2",
    );
    expect(
      backend.movingGithubRef("https://raw.githubusercontent.com/o/r/refs/heads/main/p.json"),
    ).toBe("main");

    expect(backend.movingGithubRef(`https://github.com/o/r/blob/${commit}/p.json`)).toBeNull();
    expect(
      backend.movingGithubRef(`https://raw.githubusercontent.com/o/r/${commit}/p.json`),
    ).toBeNull();
  });

  it("does not judge addresses that are not GitHub's", () => {
    expect(backend.movingGithubRef("https://example.com/main/policy.json")).toBeNull();
    expect(backend.movingGithubRef("C:\\work\\policy.json")).toBeNull();
    expect(backend.movingGithubRef("")).toBeNull();
  });
});
