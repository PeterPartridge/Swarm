// Runs every check: each `*-lint.mjs` in this folder, one after another.
//
// **Why one command.** Each check used to be named in five places — init's copy
// list, the published files, the `check` script, CI and the starter AGENTS.md —
// so adding one meant five edits, and missing one meant a check that shipped
// but never ran, or ran here and never shipped. Now a check is a file whose
// name ends in `-lint.mjs`: put it here and it runs, everywhere this does.
//
// **All of them, always.** A failure does not stop the rest — the second fault
// is as real as the first, and a run that hides it costs another round trip.
//
// Usage:
//   node tools/check.mjs
//
// Exit code 1 if any check failed.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const checks = readdirSync(here).filter((f) => f.endsWith("-lint.mjs")).sort();

const failed = [];
for (const check of checks) {
  console.log(`\n── ${check} ${"─".repeat(Math.max(0, 60 - check.length))}`);
  const { status } = spawnSync(process.execPath, [path.join(here, check)], { stdio: "inherit" });
  if (status !== 0) failed.push(check);
}

console.log(
  failed.length === 0
    ? `\n${checks.length} check(s) passed`
    : `\n${failed.map((c) => `${c} failed`).join("\n")}\n${failed.length} of ${checks.length} check(s) failed`,
);
process.exit(failed.length === 0 ? 0 : 1);
