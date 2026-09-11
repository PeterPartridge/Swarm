import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DevicePolicyExport from "../../components/ai/DevicePolicyExport";
import * as backend from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    devicePolicyExport: vi.fn(),
    saveDevicePolicyExport: vi.fn(),
    pickFolder: vi.fn(),
  };
});

const mocked = vi.mocked(backend);

const REG = 'Windows Registry Editor Version 5.00\r\n\r\n"AllowWSL1"=dword:00000000';

describe("Device policy export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.devicePolicyExport.mockResolvedValue(REG);
  });

  /** **The claim this panel must never make.** Writing the policy keys here
   *  would make the machine read as managed to this app's own detection — the
   *  app manufacturing the evidence it then reports back — so there is no Apply
   *  button, and its absence is explained rather than left to be noticed. */
  it("never offers to apply the policy, and says why it cannot", async () => {
    render(<DevicePolicyExport />);

    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
    expect(screen.getByText(/This app cannot apply them/)).toBeInTheDocument();
    // The reason, not just the refusal. Matched across the emphasis element,
    // because the sentence is split by markup and a regex that tolerated that
    // by alternation would pass on half of it.
    // getAllBy, because every ancestor of the sentence also contains it.
    expect(
      screen.getAllByText((_, node) =>
        (node?.textContent ?? "").includes("make this machine look managed to the table above"),
      ).length,
    ).toBeGreaterThan(0);
  });

  /** Shown before it is saved: this one goes to somebody's tenant and is
   *  applied to machines other than this one. */
  it("shows the file before there is anything to save", async () => {
    render(<DevicePolicyExport />);
    await userEvent.click(screen.getByRole("button", { name: "Show it" }));

    expect(await screen.findByText(/Windows Registry Editor Version 5.00/)).toBeInTheDocument();
    expect(mocked.saveDevicePolicyExport).not.toHaveBeenCalled();
  });

  /** The form picked is the form saved — a panel that showed one and wrote the
   *  other would hand somebody a file they had not read. */
  it("saves the form that is on screen", async () => {
    mocked.pickFolder.mockResolvedValue("C:\\exports");
    mocked.saveDevicePolicyExport.mockResolvedValue("C:\\exports\\coperativeai-wsl-policy.ps1");
    mocked.devicePolicyExport.mockResolvedValue("# PowerShell");

    render(<DevicePolicyExport />);
    await userEvent.selectOptions(screen.getByLabelText("Form"), "script");
    await waitFor(() => expect(mocked.devicePolicyExport).toHaveBeenCalledWith("script"));

    await userEvent.click(screen.getByRole("button", { name: "Save to a folder…" }));
    await waitFor(() =>
      expect(mocked.saveDevicePolicyExport).toHaveBeenCalledWith("script", "C:\\exports"),
    );
    expect(await screen.findByText(/Saved to C:\\exports/)).toBeInTheDocument();
  });

  /** Cancelling a folder picker is an ordinary thing to do, not a failure. */
  it("writes nothing when the folder picker is cancelled", async () => {
    mocked.pickFolder.mockResolvedValue(null);

    render(<DevicePolicyExport />);
    await userEvent.click(screen.getByRole("button", { name: "Save to a folder…" }));

    await waitFor(() => expect(mocked.pickFolder).toHaveBeenCalled());
    expect(mocked.saveDevicePolicyExport).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /** **The limit that keeps the two mechanisms apart**, said here as well as on
   *  the table row — this is where somebody is most likely to believe they have
   *  just secured what an agent can reach. */
  it("says these settings do not reach inside the distribution", async () => {
    render(<DevicePolicyExport />);

    expect(
      screen.getByText(/None of these settings reach inside the distribution/),
    ).toBeInTheDocument();
    // And names the better route rather than leaving it to be discovered.
    expect(screen.getByText(/Settings catalog/)).toBeInTheDocument();
  });

  /** A refusal is the useful part — it says which form could not be produced. */
  it("shows the refusal rather than an empty panel", async () => {
    mocked.devicePolicyExport.mockRejectedValue("'json' is not a form this app can export");

    render(<DevicePolicyExport />);
    await userEvent.click(screen.getByRole("button", { name: "Show it" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("not a form this app can export");
  });
});
