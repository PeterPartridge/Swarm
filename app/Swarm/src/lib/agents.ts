import { sameFolder } from "./paths";
import type { Run, RunningTerminal } from "./backend";

/** One agent on screen: the checkout it works in and what is running there. */
export interface LiveAgent {
  runId: number;
  solutionId: number;
  worktreePath: string;
  /** Empty for an adopted shell — nothing is retyped into one that is already
   *  running, so there is no command to put back with it. */
  command: string;
  title: string;
}

/** Adds the runs whose shells are still alive to the ones already on screen.
 *
 *  **Two panels ask this same question, so they ask it in one place.** The runs
 *  panel wants every live agent in a Product; a work item's build plan wants the
 *  ones on that item. Both were doing the matching themselves, in twenty near
 *  identical lines — and the cost of those two copies drifting is not a wrong
 *  number on a screen, it is a *second agent started in a checkout that already
 *  has one*, which is exactly what worktrees exist to prevent.
 *
 *  Pure: given the runs, what the terminal registry says is alive, and what is
 *  already held, it returns the list to hold. Nothing here starts anything. */
export function adoptRunning(
  runs: Run[],
  live: RunningTerminal[],
  held: LiveAgent[],
  title: (run: Run) => string,
): LiveAgent[] {
  const next = [...held];
  for (const run of runs) {
    // No checkout means nothing was ever prepared; already held means this
    // panel is showing it, and adding it twice would mount two widgets on one
    // shell.
    if (!run.worktreePath) continue;
    if (next.some((a) => a.runId === run.id)) continue;
    const shell = live.find(
      (l) => l.solutionId === run.solutionId && sameFolder(l.cwd, run.worktreePath),
    );
    if (!shell) continue;
    next.push({
      runId: run.id,
      solutionId: run.solutionId,
      worktreePath: run.worktreePath,
      command: "",
      title: title(run),
    });
  }
  return next;
}
