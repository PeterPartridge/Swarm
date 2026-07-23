import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiPanel from "../../components/AiPanel";
import TerminalPanel from "../../components/TerminalPanel";
import type { Solution, WorkItem } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listWorkItems: vi.fn(),
    prepareHandover: vi.fn(),
    openTerminal: vi.fn(),
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    closeTerminal: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const solution = (over: Partial<Solution> = {}): Solution => ({
  id: 3,
  name: "Shop API",
  productId: 1,
  solutionType: "api",
  answers: "{}",
  origin: "created",
  githubUrl: null,
  githubVisibility: null,
  localPath: "C:/repos/shop-api",
  testCommand: null,
  language: null,
  ...over,
});

const workItem: WorkItem = {
  id: 9,
  title: "Add checkout",
  itemType: "feature",
  status: "planned",
  description: "",
  productId: 1,
  parentItemId: null,
  assigneeId: null,
  sprintId: null,
  startDate: null,
  endDate: null,
  deliverableId: null,
  expectedCost: null,
  estimatedProfit: null,
  chargeable: false,
  customerCoverPct: null,
  risk: "",
  solutionId: null,
  developmentDetails: "",
};

describe("AiPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listWorkItems.mockResolvedValue([workItem]);
  });

  /// The two are different shapes of thing, not interchangeable engines, and
  /// the panel has to say so.
  it("describes Ollama as working in the editor", () => {
    render(
      <AiPanel
        solution={solution()}
        productId={1}
        choice="ollama"
        onChoice={() => {}}
        onRunInTerminal={() => {}}
        terminalReady={false}
      />,
    );
    expect(screen.getByText(/never writes to disk/)).toBeInTheDocument();
  });

  it("prepares a brief for Claude Code and offers to run it", async () => {
    const user = userEvent.setup();
    const ran: string[] = [];
    mocked.prepareHandover.mockResolvedValue({
      runId: 5,
      briefPath: ".CoperativeAI/handover/add-checkout.md",
      brief: "# Add checkout",
      command: "claude 'read .CoperativeAI/handover/add-checkout.md'",
    });
    render(
      <AiPanel
        solution={solution()}
        productId={1}
        choice="claudeCode"
        onChoice={() => {}}
        onRunInTerminal={(c) => ran.push(c)}
        terminalReady
      />,
    );

    await user.selectOptions(
      await screen.findByLabelText("Work item to hand over"),
      "9",
    );
    await user.click(screen.getByRole("button", { name: "Prepare brief" }));

    await waitFor(() => expect(mocked.prepareHandover).toHaveBeenCalledWith(9));
    expect(
      await screen.findByText(/Brief written to .*add-checkout\.md/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run in terminal" }));
    expect(ran).toEqual(["claude 'read .CoperativeAI/handover/add-checkout.md'"]);
  });

  /// The standing rule: Claude Code bills against its own subscription, so any
  /// figure shown would be one the app cannot see.
  it("shows no cost for a Claude Code run and says why", async () => {
    const user = userEvent.setup();
    mocked.prepareHandover.mockResolvedValue({
      runId: 5,
      briefPath: "brief.md",
      brief: "# x",
      command: "claude",
    });
    render(
      <AiPanel
        solution={solution()}
        productId={1}
        choice="claudeCode"
        onChoice={() => {}}
        onRunInTerminal={() => {}}
        terminalReady
      />,
    );
    await user.selectOptions(await screen.findByLabelText("Work item to hand over"), "9");
    await user.click(screen.getByRole("button", { name: "Prepare brief" }));

    expect(await screen.findByText(/cannot see/)).toBeInTheDocument();
    expect(screen.queryByText(/£/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  /// Running an agent that writes files must be a deliberate press, and with
  /// no shell open there is nothing to press it into.
  it("will not offer to run with no terminal open", async () => {
    const user = userEvent.setup();
    mocked.prepareHandover.mockResolvedValue({
      runId: 5,
      briefPath: "brief.md",
      brief: "# x",
      command: "claude",
    });
    render(
      <AiPanel
        solution={solution()}
        productId={1}
        choice="claudeCode"
        onChoice={() => {}}
        onRunInTerminal={() => {}}
        terminalReady={false}
      />,
    );
    await user.selectOptions(await screen.findByLabelText("Work item to hand over"), "9");
    await user.click(screen.getByRole("button", { name: "Prepare brief" }));

    expect(await screen.findByRole("button", { name: "Run in terminal" })).toBeDisabled();
    expect(screen.getByText(/Open the terminal below first/)).toBeInTheDocument();
  });
});

describe("TerminalPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /// A Solution with no working copy has nowhere to open a shell, and the panel
  /// says which rather than failing when the button is pressed.
  it("refuses to open with no folder, and says why", () => {
    render(<TerminalPanel solution={solution({ localPath: null })} />);
    expect(screen.getByRole("button", { name: "Open terminal" })).toBeDisabled();
    expect(screen.getByText(/no folder on this machine yet/)).toBeInTheDocument();
  });

  it("names the Solution it will open in", () => {
    render(<TerminalPanel solution={solution()} />);
    expect(screen.getByText(/will open in Shop API/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open terminal" })).toBeEnabled();
  });
});
