import { render, screen, waitFor, within } from "@testing-library/react";
import RunPreflight from "../../components/planning/RunPreflight";
import type { Gate } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return { ...original, runGates: vi.fn() };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const gate = (over: Partial<Gate> = {}): Gate => ({
  id: "approved",
  label: "The plan has been approved",
  ok: true,
  detail: "",
  ...over,
});

describe("the pre-flight checks before Execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.runGates.mockResolvedValue([gate()]);
  });

  /// **The way to find out what was missing was to fail.** Three gates — an
  /// approved plan, permission to edit, a repository to branch from — each said
  /// its piece only when Execute was pressed and refused. Read before pressing,
  /// they are a checklist; read after, they are an error message.
  it("lists what has to be true, met and unmet, before anything is pressed", async () => {
    mocked.runGates.mockResolvedValue([
      gate({ id: "plan", label: "This Solution is on the build plan" }),
      gate({
        id: "approved",
        label: "The plan has been approved",
        ok: false,
        detail: "this plan has not been approved yet. Read it and press Approve.",
      }),
    ]);
    render(<RunPreflight workItemId={9} solutions={[{ id: 5, name: "Shop API" }]} />);

    const list = await screen.findByRole("list", { name: "Before Execute: Shop API" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    // Met and unmet are both shown: a list of only the problems does not say
    // what else was checked, and "nothing wrong" then looks like "not checked".
    expect(rows[0]).toHaveTextContent("This Solution is on the build plan");
    expect(rows[1]).toHaveTextContent("The plan has been approved");
    expect(rows[1]).toHaveTextContent(/press Approve/);
  });

  /// A met check says nothing beyond its own name. A detail beside a green row
  /// reads as a warning about something that is fine.
  it("says nothing extra about a check that passes", async () => {
    render(<RunPreflight workItemId={9} solutions={[{ id: 5, name: "Shop API" }]} />);
    const list = await screen.findByRole("list", { name: "Before Execute: Shop API" });
    const row = within(list).getByRole("listitem");
    expect(row).toHaveTextContent("The plan has been approved");
    expect(row.textContent?.trim()).toMatch(/^.{0,60}$/);
  });

  /// One list per Solution, because a run is per Solution: the plan for one may
  /// be approved while another's is not, and a single merged verdict would hide
  /// which one is holding things up.
  it("checks each Solution the work lands in, separately", async () => {
    mocked.runGates.mockImplementation((_item, solutionId) =>
      Promise.resolve([
        gate({ ok: solutionId === 5, detail: solutionId === 5 ? "" : "not approved" }),
      ]),
    );
    render(
      <RunPreflight
        workItemId={9}
        solutions={[
          { id: 5, name: "Shop API" },
          { id: 6, name: "Shop Web" },
        ]}
      />,
    );

    expect(await screen.findByRole("list", { name: "Before Execute: Shop API" })).toBeInTheDocument();
    const web = await screen.findByRole("list", { name: "Before Execute: Shop Web" });
    expect(web).toHaveTextContent("not approved");
  });

  /// **The agent is not one of the gates, and saying so matters.** Preparing a
  /// run makes a checkout and writes a brief, both useful with no agent
  /// anywhere; what needs the agent is the command that runs afterwards. It is
  /// shown here because somebody about to press Execute wants to know, and it
  /// is shown apart because the backend does not refuse for it.
  it("shows the agent's own state beside the gates, marked as a separate thing", async () => {
    render(
      <RunPreflight
        workItemId={9}
        solutions={[{ id: 5, name: "Shop API" }]}
        agentProblem="The agent cannot run on this machine: claude.exe is not valid."
      />,
    );
    const agent = await screen.findByRole("status", { name: "The agent that will run it" });
    expect(agent).toHaveTextContent(/claude.exe is not valid/);
    // Not inside the gate list — it is not a reason Execute refuses.
    const list = screen.getByRole("list", { name: "Before Execute: Shop API" });
    expect(list).not.toHaveTextContent(/claude.exe/);
  });

  /// A probe that could not run is not a failure to report. The panel says
  /// nothing about the agent rather than claiming it is broken.
  it("says nothing about the agent when there is nothing to say", async () => {
    render(<RunPreflight workItemId={9} solutions={[{ id: 5, name: "Shop API" }]} />);
    await screen.findByRole("list", { name: "Before Execute: Shop API" });
    expect(
      screen.queryByRole("status", { name: "The agent that will run it" }),
    ).not.toBeInTheDocument();
  });

  /// Nothing to check yet is not an empty checklist — it is a different state,
  /// and the panel above already says a Solution is missing.
  it("shows nothing at all until a Solution is attached", async () => {
    render(<RunPreflight workItemId={9} solutions={[]} />);
    await waitFor(() => expect(mocked.runGates).not.toHaveBeenCalled());
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  /// A check that cannot be read is reported as that, rather than as a green
  /// row. Silence here would be the panel saying "all clear" on no evidence.
  it("says so when the checks themselves cannot be read", async () => {
    mocked.runGates.mockRejectedValue("the database is locked");
    render(<RunPreflight workItemId={9} solutions={[{ id: 5, name: "Shop API" }]} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/database is locked/);
  });
});
