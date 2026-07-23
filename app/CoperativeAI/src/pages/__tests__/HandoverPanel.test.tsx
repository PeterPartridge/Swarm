import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HandoverPanel from "../../components/HandoverPanel";
import type { WorkItem } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return { ...original, prepareHandover: vi.fn() };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const item: WorkItem = {
  id: 1,
  title: "Add checkout",
  itemType: "feature",
  status: "planned",
  description: "Take payment",
  productId: 7,
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
  solutionId: 11,
  developmentDetails: "",
};

const handover = {
  runId: 5,
  briefPath: ".coperativeai/briefs/add-checkout.md",
  brief: "# Add checkout\n\n_feature in Shop_",
  command: 'claude "Read .coperativeai/briefs/add-checkout.md and implement it."',
};

describe("HandoverPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.prepareHandover.mockResolvedValue(handover);
  });

  it("writes the brief and shows where it went", async () => {
    const user = userEvent.setup();
    render(<HandoverPanel item={item} />);

    await user.click(screen.getByLabelText("Prepare Add checkout for an agent"));

    await waitFor(() => expect(mocked.prepareHandover).toHaveBeenCalledWith(1));
    // By role: the path appears in the status line and again inside the
    // command, so plain text matching is ambiguous here.
    expect(await screen.findByRole("status")).toHaveTextContent(
      ".coperativeai/briefs/add-checkout.md",
    );
    expect(screen.getByText(/claude "Read/)).toBeInTheDocument();
  });

  /// The honesty this whole design turns on: the app is not running the agent
  /// and cannot see what the run costs, so it must not imply otherwise.
  it("says plainly that it does not run the agent and cannot see the cost", async () => {
    const user = userEvent.setup();
    render(<HandoverPanel item={item} />);

    await user.click(screen.getByLabelText("Prepare Add checkout for an agent"));

    const note = await screen.findByText(/can't see what the run costs/);
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent(/bills separately/);
  });

  it("shows the assembled brief on request", async () => {
    const user = userEvent.setup();
    render(<HandoverPanel item={item} />);

    await user.click(screen.getByLabelText("Prepare Add checkout for an agent"));
    await user.click(await screen.findByLabelText("Show the brief for Add checkout"));

    expect(screen.getByLabelText("Brief for Add checkout")).toHaveTextContent("# Add checkout");
  });

  it("surfaces a work item with nowhere to land", async () => {
    const user = userEvent.setup();
    mocked.prepareHandover.mockRejectedValue(
      "'Add checkout' is not linked to a Solution, so there is nowhere to hand it over to.",
    );
    render(<HandoverPanel item={item} />);

    await user.click(screen.getByLabelText("Prepare Add checkout for an agent"));

    expect(await screen.findByRole("alert")).toHaveTextContent("nowhere to hand it over to");
  });
});
