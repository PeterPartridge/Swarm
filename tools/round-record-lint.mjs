// Checks that a round record exists and answers all three of its headings.
//
// **The one rule an agent cannot be trusted to keep, by its own account.** Every
// other check here reads a document the AI wrote *while* it was working. This
// one reads the document it writes *afterwards*, which is a different kind of
// promise: adherence to administrative rules degrades exactly when a task got
// long and complicated — which is exactly when the debt is worth having. Asked
// directly, an agent will say it may quietly drop this one. So nothing here
// relies on it remembering.
//
// **What it cannot do, stated first because it is the important half.** It
// cannot check that a record is *true*. A step the agent did not notice it
// skipped will not appear, and no reader of the file can tell. This turns a
// silent omission into a loud one; whether what is written is accurate stays a
// person's job, and pretending otherwise would make a passing run mean more
// than it does.
//
// Usage:
//   node tools/round-record-lint.mjs                 # every record in the repository
//   node tools/round-record-lint.mjs <path…>         # just these
//   node tools/round-record-lint.mjs --since <ref>   # ...and a change to solution code brought one
//
// Exit code 1 on an error. Warnings are printed and do not fail the run.

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const repo = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);

const SKIP = new Set(["node_modules", "target", ".git", "dist", "_forms", ".github"]);

/** The headings AGENTS.md asks every agent to append under, in the order it
 *  asks for them. Matched on the opening words only: the brief writes two of
 *  them with a parenthetical after the heading, and an agent that copies the
 *  parenthetical is obeying, not drifting. */
const HEADINGS = ["What I did", "What I could not do", "Debt I left behind"];

/** Paths whose change means a round happened.
 *
 *  **`app/` because that is where the solutions live** — the Project Digest's
 *  Solutions & repos line puts CoperativeAI at `app/CoperativeAI` and the
 *  database under it. Framework material (`tools/`, `.claude/`, `template/`)
 *  is deliberately not here: a typo fixed in a README is not a round, and a
 *  gate that fires on everything is a gate people learn to route around. One
 *  line to widen when that stops being true. */
const SOLUTIONS = ["app/"];

/** An answer that is only a shrug. Legitimate once in a while — which is why
 *  these warn rather than fail. */
const SHRUG = /^(none|n\/a|na|nothing|nil|-)\.?$/i;

/** Reads a document with its line endings normalised.
 *
 *  A CRLF checkout once made a sibling check pass everything it read, because
 *  `$` does not match before a carriage return. Dealt with once, here, rather
 *  than in every pattern. */
async function read(file) {
  return (await fs.readFile(file, "utf8")).replace(/\r\n/g, "\n");
}

/** Every ROUND-RECORD.md under a directory. */
async function records(dir, out = []) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name) && !e.name.startsWith(".")) await records(path.join(dir, e.name), out);
    } else if (e.name.toLowerCase() === "round-record.md") {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

/** The `### ` sections of a record, as heading and body. */
function sections(text) {
  const out = [];
  for (const m of text.matchAll(/^###[ \t]+(.+?)[ \t]*$([\s\S]*?)(?=^###[ \t]|(?![\s\S]))/gm)) {
    out.push({ heading: m[1], body: m[2].trim() });
  }
  return out;
}

const asks = (heading, want) => heading.toLowerCase().startsWith(want.toLowerCase());

/** Checks one record's shape. */
async function lint(file) {
  const errors = [];
  const warnings = [];
  const found = sections(await read(file));

  for (const want of HEADINGS) {
    const match = found.find((s) => asks(s.heading, want));
    if (!match) {
      errors.push(`no "### ${want}" heading — the record answers fewer questions than it was asked`);
    } else if (match.body === "") {
      errors.push(`"### ${match.heading}" has nothing under it — an empty answer is the skip this checks for`);
    } else if (SHRUG.test(match.body)) {
      warnings.push(`"### ${match.heading}" says only "${match.body}" — true sometimes, worth a second look`);
    }
  }

  for (const s of found) {
    if (!HEADINGS.some((h) => asks(s.heading, h))) {
      warnings.push(`"### ${s.heading}" is not one of the three — the app files it under "also said"`);
    }
  }

  return { errors, warnings, sections: found.length };
}

/** Did a change to solution code arrive without a record?
 *
 *  **Only what git can establish.** No repository, no base ref, or a git that
 *  will not answer means this says so and checks nothing, rather than guessing
 *  that a round happened. */
function brought(since, cwd) {
  let changed;
  try {
    changed = execFileSync("git", ["diff", "--name-only", since, "HEAD"], { cwd, encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return { skipped: `git could not diff against ${since} — nothing checked` };
  }

  const code = changed.filter((f) => SOLUTIONS.some((dir) => f.startsWith(dir)));
  if (code.length === 0) return { note: "no solution code changed — no round to record" };
  if (changed.some((f) => path.basename(f).toLowerCase() === "round-record.md")) {
    return { note: `${code.length} file(s) of solution code changed, and a record changed with them` };
  }
  return {
    error:
      `${code.length} file(s) under ${SOLUTIONS.join(", ")} changed and no ROUND-RECORD.md did — ` +
      `first: ${code[0]}`,
  };
}

const args = process.argv.slice(2);
const sinceAt = args.indexOf("--since");
const since = sinceAt === -1 ? null : args[sinceAt + 1];
const named = args
  .filter((a, i) => !a.startsWith("--") && (sinceAt === -1 || (i !== sinceAt && i !== sinceAt + 1)))
  .map((p) => path.resolve(p));

/** Where to look, and where git is asked from: what was named, or the whole
 *  repository when nothing was. */
const base = named.length > 0 ? named[0] : repo;
const root = (await fs.stat(base)).isDirectory() ? base : path.dirname(base);
const rel = (p) => path.relative(root, p).split(path.sep).join("/") || path.basename(p);

let failed = false;

if (since) {
  const { error, note, skipped } = brought(since, root);
  if (skipped) console.log(`\nsince ${since} — ${skipped}`);
  else if (note) console.log(`\nsince ${since} — ${note}`);
  else {
    console.log(`\nsince ${since}`);
    console.log(`  ERROR  ${error}`);
    failed = true;
  }
}

const files = [];
for (const target of named.length > 0 ? named : [repo]) {
  if ((await fs.stat(target)).isDirectory()) files.push(...(await records(target)));
  else files.push(target);
}

if (files.length === 0) {
  console.log("\nno ROUND-RECORD.md found — nothing written down yet, which is not a fault on its own");
} else {
  for (const file of files.sort()) {
    const { errors, warnings, sections: count } = await lint(file);
    console.log(`\n${rel(file)} — ${count} section(s)`);
    for (const w of warnings) console.log(`  warn   ${w}`);
    for (const e of errors) console.log(`  ERROR  ${e}`);
    if (errors.length === 0 && warnings.length === 0) console.log("  all three answered");
    if (errors.length > 0) failed = true;
  }
}

process.exit(failed ? 1 : 0);
