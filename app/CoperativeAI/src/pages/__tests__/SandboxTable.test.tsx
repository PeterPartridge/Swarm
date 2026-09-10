import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SandboxTable from "../../components/ai/SandboxTable";
import * as backend from "../../lib/backend";
import type { SandboxReport } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return { ...original, sandboxReport: vi.fn(), setUpSandbox: vi.fn(), setAgentSandbox: vi.fn() };
});

const mocked = vi.mocked(backend);

/** This machine, as detection really found it: a stock Ubuntu that mounts the
 *  whole Windows drive, and a Docker client whose engine is not running. */
const thisMachine: SandboxReport = {
  chosen: "off",
  modes: [
    {
      id: "off",
      canChoose: true,
      chooseDetail: "Always available.",
      canSetUp: false,
      setUpDetail: "There is nothing to set up — this is your machine.",
      label: "This machine — the same permissions you have",
      built: true,
      summary: "Runs here, exactly as it always has.",
      protections: [
        {
          name: "A boundary from this machine's files",
          state: "unavailable",
          detail: "Nothing is bounded — this is your machine, with your permissions.",
        },
      ],
    },
    {
      id: "wsl",
      canChoose: false,
      chooseDetail: "Set it up first: choosing it before there is a boundary would stop the terminal working.",
      canSetUp: true,
      setUpDetail: "5 steps — it downloads a distribution and installs into it.",
      label: "A Linux distribution this app creates and owns",
      built: false,
      summary: "This app has not created its own distribution yet.",
      protections: [
        {
          name: "A boundary from this machine's files",
          state: "unavailable",
          detail: "'coperativeai' still has this machine's drive mounted.",
        },
      ],
    },
    {
      id: "docker",
      canChoose: false,
      chooseDetail: "Not built yet — it would refuse every command.",
      canSetUp: false,
      setUpDetail: "Docker's engine is not running, and an image cannot be built without it.",
      label: "A container of its own for each run",
      built: false,
      summary: "Docker is installed, but its engine is not running.",
      protections: [
        {
          name: "A boundary from this machine's files",
          state: "availableNotBuilt",
          detail: "A container sees only what is mounted into it.",
        },
      ],
    },
  ],
};

describe("SandboxTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.sandboxReport.mockResolvedValue(thisMachine);
  });

  /** **The rule the panel exists for.** A mode that runs nothing must never
   *  read as protection, however ready the machine underneath it is. */
  it("never presents an unbuilt mode as protection in force", async () => {
    render(<SandboxTable />);

    const docker = await screen.findByRole("columnheader", {
      name: /container of its own/,
    });
    expect(docker).toHaveTextContent("not built yet");

    // The one ready cell on this machine still says it is not doing anything.
    expect(
      await screen.findByText("This machine could — not built yet"),
    ).toBeInTheDocument();
    expect(screen.queryByText("In force")).not.toBeInTheDocument();
  });

  /** No tick and no padlock: a symbol is read as reassurance before it is read
   *  at all, and most of these verdicts are not reassuring. */
  it("gives every verdict in words, with the reason beside it", async () => {
    render(<SandboxTable />);

    expect(await screen.findByText(/still has this machine's drive mounted/)).toBeInTheDocument();
    expect(
      screen.getByText("Nothing is bounded — this is your machine, with your permissions."),
    ).toBeInTheDocument();
    expect(screen.getByText("Docker is installed, but its engine is not running.")).toBeInTheDocument();
  });

  /** Choosing a mode that refuses every command would stop the terminal
   *  working. The choice arrives with the first backend that can honour it. */
  it("offers no way to choose a mode that would stop the terminal working", async () => {
    render(<SandboxTable />);
    await screen.findByRole("table");

    // The only mode that can be chosen on this machine is the one that is
    // ready; the rest are offered but disabled, with their reason beside them.
    const choices = screen.getAllByRole("radio");
    expect(choices.filter((c) => !(c as HTMLInputElement).disabled)).toHaveLength(1);
    // Every button here either looks at the machine or builds something.
    // None of them selects a mode, which is the part that would break a
    // terminal.
    for (const button of screen.getAllByRole("button")) {
      expect(button.textContent).toMatch(/Check again|Set this up/);
    }
  });

  /** A disabled button with no reason beside it is a dead end. */
  it("says why a set-up cannot be run, rather than only greying it out", async () => {
    render(<SandboxTable />);

    const docker = await screen.findByRole("columnheader", { name: /container of its own/ });
    expect(within(docker).getByRole("button", { name: "Set this up" })).toBeDisabled();
    expect(docker).toHaveTextContent(
      "Docker's engine is not running, and an image cannot be built without it.",
    );

    const wsl = screen.getByRole("columnheader", { name: /Linux distribution/ });
    expect(within(wsl).getByRole("button", { name: "Set this up" })).toBeEnabled();
  });

  /** **Everything it printed, whole.** A five-minute install reduced to "done"
   *  is one whose failure nobody can act on — the missing package is named in
   *  the output or nowhere. */
  it("keeps what each step printed, and names the step it stopped at", async () => {
    mocked.setUpSandbox.mockResolvedValue({
      mode: "wsl",
      succeeded: false,
      summary: "Stopped at 'Install what the agent needs', and nothing after it was attempted.",
      steps: [
        { name: "Create the distribution", succeeded: true, output: "" },
        {
          name: "Install what the agent needs",
          succeeded: false,
          output: "E: Unable to locate package nodejs",
        },
      ],
    });

    render(<SandboxTable />);
    const wsl = await screen.findByRole("columnheader", { name: /Linux distribution/ });
    await userEvent.click(within(wsl).getByRole("button", { name: "Set this up" }));

    expect(await screen.findByText(/Stopped at 'Install what the agent needs'/)).toBeInTheDocument();
    expect(screen.getByText("E: Unable to locate package nodejs")).toBeInTheDocument();
  });

  /** The point of setting up is whether the verdicts changed, so the table is
   *  read again rather than left showing what was true before. */
  it("looks at the machine again once a set-up finishes", async () => {
    mocked.setUpSandbox.mockResolvedValue({
      mode: "wsl",
      succeeded: true,
      summary: "'coperativeai' is set up.",
      steps: [{ name: "Create the distribution", succeeded: true, output: "" }],
    });

    render(<SandboxTable />);
    const wsl = await screen.findByRole("columnheader", { name: /Linux distribution/ });
    expect(mocked.sandboxReport).toHaveBeenCalledTimes(1);

    await userEvent.click(within(wsl).getByRole("button", { name: "Set this up" }));
    await waitFor(() => expect(mocked.sandboxReport).toHaveBeenCalledTimes(2));
  });

  it("asks the machine once on opening, and again only when asked", async () => {
    render(<SandboxTable />);
    await screen.findByRole("table");
    expect(mocked.sandboxReport).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(mocked.sandboxReport).toHaveBeenCalledTimes(2));
  });

  it("says why it could not look, rather than showing an empty table", async () => {
    mocked.sandboxReport.mockRejectedValue("wsl.exe would not start");
    render(<SandboxTable />);

    expect(await screen.findByRole("alert")).toHaveTextContent("wsl.exe would not start");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
