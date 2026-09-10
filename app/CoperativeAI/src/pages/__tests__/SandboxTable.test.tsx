import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SandboxTable from "../../components/ai/SandboxTable";
import * as backend from "../../lib/backend";
import type { SandboxReport } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return { ...original, sandboxReport: vi.fn() };
});

const mocked = vi.mocked(backend);

/** This machine, as detection really found it: a stock Ubuntu that mounts the
 *  whole Windows drive, and a Docker client whose engine is not running. */
const thisMachine: SandboxReport = {
  chosen: "off",
  modes: [
    {
      id: "off",
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
  it("offers no way to choose a mode that cannot run anything", async () => {
    render(<SandboxTable />);
    await screen.findByRole("table");

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    // The only button is the one that looks again.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent("Check again");
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
