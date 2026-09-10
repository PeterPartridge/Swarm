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
  };
});

const mocked = vi.mocked(backend);

const saved = {
  from: "https://example.com/policies/strict.json",
  folder: "C:\\policies",
  command: "sh apply.sh",
};

describe("PolicySource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getAgentPolicySource.mockResolvedValue(saved);
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
});
