import { adoptRunning, type LiveAgent } from "../../lib/agents";
import type { Run, RunningTerminal } from "../../lib/backend";

const run = (over: Partial<Run> = {}): Run =>
  ({
    id: 4,
    workItemId: 12,
    workItemTitle: "Add checkout",
    solutionId: 3,
    solutionName: "Shop API",
    state: "prepared",
    branch: "feature/12",
    worktreePath: "C:/wt/checkout",
    terminalId: "",
    briefPath: "b.md",
    filesChanged: 0,
    planApproved: true,
    ...over,
  }) as Run;

const shell = (over: Partial<RunningTerminal> = {}): RunningTerminal => ({
  id: "t1",
  solutionId: 3,
  shell: "pwsh",
  cwd: "C:/wt/checkout",
  startedAt: 1,
  ...over,
});

const name = (r: Run) => `${r.workItemTitle} → ${r.solutionName}`;

describe("picking up the agents that are still running", () => {
  it("adopts a run whose shell is alive", () => {
    const adopted = adoptRunning([run()], [shell()], [], name);
    expect(adopted).toHaveLength(1);
    expect(adopted[0].title).toBe("Add checkout → Shop API");
    // Nothing is retyped into a shell that is already running.
    expect(adopted[0].command).toBe("");
  });

  /// **The reason this is one function and not two copies.** git reports the
  /// folder one way and the terminal registry another, and a string comparison
  /// would find no match — then start a second agent in a checkout that already
  /// has one.
  it("matches the same folder however it is spelled", () => {
    expect(
      adoptRunning([run({ worktreePath: "C:/wt/checkout/" })], [shell({ cwd: "C:\\WT\\Checkout" })], [], name),
    ).toHaveLength(1);
  });

  it("leaves alone a run with no shell of its own", () => {
    expect(adoptRunning([run()], [shell({ cwd: "C:/wt/elsewhere" })], [], name)).toEqual([]);
    expect(adoptRunning([run()], [shell({ solutionId: 99 })], [], name)).toEqual([]);
  });

  it("ignores a run that was never prepared", () => {
    expect(adoptRunning([run({ worktreePath: "" })], [shell()], [], name)).toEqual([]);
  });

  /// Adding one twice would mount two widgets on one shell — which is the same
  /// mistake as starting two agents, seen from the other end.
  it("does not add one it is already showing", () => {
    const held: LiveAgent[] = [
      { runId: 4, solutionId: 3, worktreePath: "C:/wt/checkout", command: "", title: "held" },
    ];
    expect(adoptRunning([run()], [shell()], held, name)).toEqual(held);
  });

  it("keeps what is held when nothing is live", () => {
    const held: LiveAgent[] = [
      { runId: 9, solutionId: 3, worktreePath: "C:/wt/other", command: "", title: "held" },
    ];
    expect(adoptRunning([run()], [], held, name)).toEqual(held);
  });
});
