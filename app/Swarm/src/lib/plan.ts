import type { WorkItemPlan } from "./backend";

/** Reading the AI's plan — the same way wherever it is shown.
 *
 *  These started inside the AI planning tab, which was the only place that drew
 *  a plan. The agent briefing draws one too now, and a briefing that parsed the
 *  file list its own way would sooner or later disagree with the tab about what
 *  the plan says. Pure functions, no React, so anything can read a plan without
 *  pulling a panel in behind it. */

/** One file the AI expects this work to touch, and why. */
export interface PlannedFile {
  path: string;
  /** What the model said about it — prose, often a sentence or two. */
  note: string;
}

/** Reads the model's file list into rows.
 *
 *  **The model writes one long line.** `src/main.rs (console entry point:
 *  prints the prompt, reads stdin); src/greeting.rs (pure function …)` — which
 *  in a single `<pre>` is a wall of text nobody reads, and the reason the
 *  planning tab exists at all. The split is at paren depth zero because the
 *  notes are prose and prose has semicolons in it; splitting on every one of
 *  them turns a three-file plan into eight nonsense rows.
 *
 *  Newlines separate too, because a model asked for a list sometimes writes
 *  one. */
export function parseFiles(text: string): PlannedFile[] {
  const entries: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === ";" || ch === "\n") && depth === 0) {
      entries.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  entries.push(current);

  return entries
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const open = entry.indexOf("(");
      if (open === -1) return { path: entry, note: "" };
      const note = entry.slice(open + 1).replace(/\)\s*$/, "");
      return { path: entry.slice(0, open).trim(), note: note.trim() };
    });
}

/** Rows back to the one string the plan is stored as.
 *
 *  Round-trips with `parseFiles`, which is what makes editing one row safe:
 *  everything not touched is written back exactly as it was read. */
export function formatFiles(files: PlannedFile[]): string {
  return files
    .filter((f) => f.path.trim() !== "")
    .map((f) =>
      f.note.trim() === "" ? f.path.trim() : `${f.path.trim()} (${f.note.trim()})`,
    )
    .join("; ");
}

/** Whether the AI has planned every Solution a work item touches.
 *
 *  **Every, not any.** One Solution planned and another not is not a planned
 *  work item: executing would start an agent on the unplanned half with nothing
 *  to build from. Written as "has the AI produced anything for it", because a
 *  Solution with no API and no UI legitimately has empty schemas, and a plan is
 *  a plan whichever of the three it filled in. */
export function isPlanned(plans: WorkItemPlan[]): boolean {
  return (
    plans.length > 0 &&
    plans.every(
      (p) =>
        p.filesToChange.trim() !== "" ||
        p.apiSchema.trim() !== "" ||
        p.pageSchema.trim() !== "",
    )
  );
}
