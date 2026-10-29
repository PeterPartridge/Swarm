// Checks item briefs against the Project Brief they belong to.
//
// **One rule today, and it is the one with teeth.** An item names the
// `deliverable` it works towards, and `/build` stops when the last item naming
// a deliverable is built — that pause is the whole reason the field exists. A
// misspelled name breaks it silently and in the worst direction: the item looks
// aimed at something, and the deliverable it was supposed to complete never
// completes, because the last item was never counted. Nothing else in the
// framework would notice, so this does.
//
// **Quiet where there is nothing to check.** A blank brief, or a project whose
// brief names no deliverables yet, is not a fault — it is work not started. A
// tool that reports those as problems is a tool people stop running, so a
// project with no deliverables answered gets **one** line saying how many
// briefs went unchecked, not one line per brief.
//
// Usage:
//   node tools/brief-lint.mjs                 # every project in the repository
//   node tools/brief-lint.mjs <projectRoot…>  # just these
//   node tools/brief-lint.mjs --status <brief…> # one line per brief: its status
//
// **`--status` is what /build reads instead of whole briefs.** A build needs
// one word from each brief it depends on, and reading the file for it cost
// hundreds of tokens a dependency.
//
// Exit code 1 on an error. Warnings are printed and do not fail the run.

import { promises as fs } from "node:fs";
import path from "node:path";

const repo = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);

const SKIP = new Set(["node_modules", "target", ".git", "dist", "ai-only", "_forms", ".github", "qa"]);

/** Reads a document with its line endings normalised.
 *
 *  **A CRLF checkout made this tool pass everything.** Half the rules here end
 *  a pattern with `$`, and in JavaScript `$` does not match before a carriage
 *  return and `.` does not cross one — so on a Windows checkout every bullet
 *  stopped matching, every front-matter comment stayed glued to its value, and
 *  the run came back green having read nothing. A check that cannot fail is
 *  worse than no check, so line endings are dealt with once, here, rather than
 *  in each pattern. */
async function read(file) {
  return (await fs.readFile(file, "utf8")).replace(/\r\n/g, "\n");
}

/** Front matter of a Markdown brief, as flat scalars.
 *
 *  The same deliberately small reader the site build uses: these files carry
 *  two or three plain fields and a YAML parser would be a dependency bought to
 *  read `status: filled`. Trailing `# …` comments are stripped, because the
 *  blank forms ship guidance in them. */
function frontMatter(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const fields = {};
  for (const line of text.slice(3, end).split("\n")) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    const value = line
      .slice(at + 1)
      .replace(/\s+#.*$/, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) fields[key] = value;
  }
  return fields;
}

/** The deliverable names a Project Brief lists.
 *
 *  The form asks for `- Deliverable: MVP — done when: …`, but people write
 *  `- MVP — …` and `- MVP` too, and all three mean the same thing. So: take
 *  each bullet under the heading, drop a leading `Deliverable:` label, and keep
 *  what comes before the first dash or colon. Guidance lines (`>`) are not
 *  answers and never count as one. */
function deliverablesIn(brief) {
  // The last alternative is end-of-input: a brief whose deliverables are its
  // final section has no heading after them, and without this it read as having
  // none at all — silently, which is the worst way for a check to be wrong.
  const section = brief.match(
    /^###\s+deliverables\b[^\n]*\n([\s\S]*?)(?=^###\s|^##\s|^---\s*$|(?![\s\S]))/m,
  );
  if (!section) return [];
  const names = [];
  for (const line of section[1].split("\n")) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (!bullet || line.trimStart().startsWith(">")) continue;
    const name = bullet[1]
      .replace(/^\**Deliverable\**\s*:\s*/i, "")
      .split(/\s+[—–-]\s+|:/)[0]
      .replace(/\*\*/g, "")
      .trim();
    if (name && !/^e\.g\./i.test(name)) names.push(name);
  }
  return names;
}

/** Every folder holding a Project_brief.md. */
async function projectRoots(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && e.name === "Project_brief.md")) out.push(dir);
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name)) continue;
    await projectRoots(path.join(dir, e.name), out);
  }
  return out;
}

/** The item briefs of a project: one per page, endpoint or model. */
async function itemBriefs(root) {
  const items = [];
  for (const solution of await fs.readdir(root, { withFileTypes: true })) {
    if (!solution.isDirectory() || SKIP.has(solution.name)) continue;
    const dir = path.join(root, solution.name);
    for (const file of await fs.readdir(dir)) {
      if (file === "application-spec.json") continue; // the solution, not an item
      const full = path.join(dir, file);
      if (file.endsWith(".md")) {
        const text = await read(full);
        const fields = frontMatter(text);
        if (fields?.form === "page-brief") items.push({ file: full, fields, text });
      } else if (file.endsWith(".json")) {
        let parsed;
        try {
          parsed = JSON.parse(await read(full));
        } catch (e) {
          items.push({ file: full, broken: String(e.message) });
          continue;
        }
        if (parsed.form === "endpoint-brief" || parsed.form === "database-model") {
          items.push({ file: full, fields: parsed });
        }
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// **The two sign-offs.** Product signs the idea and its use case; Dev and
// Product sign how it will be built, after QA has reviewed it. Each names the
// change round it covers — `Sam 2026-10-30 round 1` — so when a brief gains a
// round, the sign-offs it needs are visibly missing rather than silently
// stale. Endpoints and models have no Product part, so they need Dev's alone.

const SIGNOFF = /^(.+?)\s+(\d{4}-\d{2}-\d{2})\s+round\s+(\d+)$/;

/** The round a brief is at: 1, plus one for every change it has had. The
 *  form's own `- Round 2: …` placeholder is not a change. */
function roundOf(item) {
  if (!item.text) return 1 + (item.fields.changesOverTime?.rounds ?? []).filter((r) => r && (r.change ?? r)).length;
  const section = item.text.match(/^##[^\n]*changes-over-time[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/im);
  const changes = (section?.[1] ?? "").split("\n").filter((l) => {
    const bullet = l.match(/^\s*[-*]\s+(.*)$/);
    if (!bullet) return false;
    const what = bullet[1].replace(/^round\s+\d+\s*:\s*/i, "").trim();
    return what !== "" && !/^(…|\.\.\.)$/.test(what);
  });
  return 1 + changes.length;
}

/** The sign-offs an item needs, by the name its brief writes them under. */
const signoffsFor = (item) =>
  item.text
    ? [
        ["product-signoff", "Product's sign-off"],
        ["build-signoff", "Dev and Product's sign-off"],
      ]
    : [["buildSignoff", "Dev's sign-off"]];

/** QA's verdict on each item it has reviewed, by the item's path. */
async function qaVerdicts(root) {
  const out = new Map();
  const qa = path.join(root, "qa");
  for (const dir of await fs.readdir(qa, { withFileTypes: true }).catch(() => [])) {
    if (!dir.isDirectory()) continue;
    for (const file of await fs.readdir(path.join(qa, dir.name))) {
      if (!file.endsWith(".md")) continue;
      const fields = frontMatter(await read(path.join(qa, dir.name, file)));
      if (fields?.form === "qa-review" && fields.item) out.set(fields.item, fields.status ?? "blank");
    }
  }
  return out;
}

/** What an item still waits on before it may be built, and what is wrong
 *  with the sign-offs it has. */
function readiness(item, itemPath, verdicts) {
  const round = roundOf(item);
  const waiting = [];
  const wrong = [];
  for (const [field, who] of signoffsFor(item)) {
    const value = String(item.fields[field] ?? "").trim();
    if (value === "") {
      waiting.push(`${who} for round ${round}`);
      continue;
    }
    const m = value.match(SIGNOFF);
    if (!m) {
      wrong.push(`${field} "${value}" — write it as <name> <YYYY-MM-DD> round <n>`);
      continue;
    }
    const signed = Number(m[3]);
    if (signed > round) wrong.push(`${field} signs round ${signed}, and the brief is at round ${round}`);
    else if (signed < round) waiting.push(`${who} for round ${round} (signed for round ${signed})`);
  }
  if (verdicts.get(itemPath) !== "happy") waiting.push(`QA's review (qa/…, status: happy)`);
  return { round, waiting, wrong };
}

/** The data rows of every Markdown table in a document, as trimmed cells.
 *  Header rows (first cell `ID` or `Deliverable`), separators and the blank
 *  form's `<…>` placeholder rows are not claims, so they are left out. */
function tableRows(text) {
  const rows = [];
  text.split("\n").forEach((line, i) => {
    if (!line.startsWith("|")) return;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 2 || /^[-: ]+$/.test(cells[0]) || /^(ID|Deliverable)$/i.test(cells[0])) return;
    if (cells[0] === "" || /^<.*>$/.test(cells[0])) return;
    rows.push({ line: i + 1, cells });
  });
  return rows;
}

/** **QA's track: the regression suite, the reviews and the sign-off.**
 *
 *  These are people's documents, so they are read the way the briefs are:
 *  against what they claim. A regression test pointing at automation that is
 *  not there, or a sign-off nobody signed, makes the sign-off mean less than it
 *  says, which is the one thing it exists not to do. A project with no `qa/`
 *  folder predates the track and is left alone. */
async function lintQa(root, deliverables, items, { errors, warnings, notes }) {
  const qa = path.join(root, "qa");
  if (!(await fs.stat(qa).catch(() => null))?.isDirectory()) return;
  const rel = (p) => path.relative(repo, p).split(path.sep).join("/");
  const exists = (p) => fs.access(path.join(root, p)).then(() => true, () => false);

  // QA reviews: one per item, each naming the brief it reviews.
  for (const dir of await fs.readdir(qa, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of await fs.readdir(path.join(qa, dir.name))) {
      if (!file.endsWith(".md")) continue;
      const full = path.join(qa, dir.name, file);
      const fields = frontMatter(await read(full));
      if (fields?.form !== "qa-review") continue;
      if (fields.item && !(await exists(fields.item))) {
        errors.push(`${rel(full)}  reviews ${fields.item}, which does not exist`);
      }
      if (!["blank", "reviewing", "happy"].includes(fields.status ?? "blank")) {
        errors.push(`${rel(full)}  status "${fields.status}" — one of: blank, reviewing, happy`);
      }
    }
  }

  // The regression suite: ID | Proves | Item | Kind | Steps | Expected | Automation
  const suite = path.join(qa, "regression.md");
  const tests = (await fs.stat(suite).catch(() => null)) ? tableRows(await read(suite)) : [];
  const seen = new Set();
  let waiting = 0;
  for (const { line, cells } of tests) {
    const [id, , item, kind, steps, expected, automation] = cells;
    const at = `${rel(suite)}:${line}  ${id}`;
    if (seen.has(id)) errors.push(`${at} is used twice — a sign-off naming it would not say which`);
    seen.add(id);
    if (item && !(await exists(item))) errors.push(`${at} tests ${item}, which does not exist`);
    if (!["manual", "automated"].includes(kind)) errors.push(`${at} kind "${kind}" — manual or automated`);
    if (!expected) warnings.push(`${at} has no expected result — nobody can say it passed`);
    if (kind === "manual" && !steps) warnings.push(`${at} is manual with no steps yet`);
    if (kind === "automated" && !automation) waiting++;
    if (automation && !(await exists(automation))) errors.push(`${at} automation ${automation} does not exist`);
  }
  if (tests.length > 0) notes.push(`${tests.length} regression test(s)`);
  if (waiting > 0) notes.push(`${waiting} automated test(s) not automated yet — /qa writes them when QA asks`);

  // The sign-off: Deliverable | Date | Signed off by | Regression run | Accepted issues
  const signoff = path.join(qa, "signoff.md");
  const signed = new Map();
  for (const { line, cells } of (await fs.stat(signoff).catch(() => null)) ? tableRows(await read(signoff)) : []) {
    const [deliverable, date, by] = cells;
    const at = `${rel(signoff)}:${line}`;
    if (deliverables.length > 0 && !deliverables.includes(deliverable)) {
      errors.push(`${at}  signs off "${deliverable}", which the Project Brief does not list`);
    }
    if (!by) errors.push(`${at}  ${deliverable} sign-off has no name — a sign-off is a person saying so`);
    if (!date) errors.push(`${at}  ${deliverable} sign-off has no date`);
    signed.set(deliverable, { date, by });
  }

  // Where each deliverable stands: built is the AI's stopping point; signed off
  // is QA's, and only that one makes a deliverable done.
  for (const d of deliverables) {
    const mine = items.filter((i) => !i.broken && (i.fields.deliverable ?? "").trim() === d);
    if (mine.length === 0) continue;
    const s = signed.get(d);
    if (s && s.by) notes.push(`${d} signed off ${s.date} by ${s.by}`);
    else if (mine.every((i) => i.fields.status === "built")) notes.push(`${d} is built — waiting on QA sign-off`);
  }
}

async function lint(root) {
  const rel = (p) => path.relative(repo, p).split(path.sep).join("/") || ".";
  const errors = [];
  const warnings = [];
  const notes = [];

  const briefPath = path.join(root, "Project_brief.md");
  const brief = await read(briefPath);
  const items = await itemBriefs(root);

  // **Neither the blank copy nor a drafted one is making a claim.** The first
  // has not been written; the second was written by /draft and nobody has
  // accepted it yet. Checking either is checking nobody's answers, and saying
  // so every run teaches people to skim the output.
  const status = frontMatter(brief)?.status ?? "blank";
  if (status === "blank" || status === "drafted") {
    return { rel: rel(root), items: items.length, named: [], errors, warnings, notes, unfinished: status };
  }

  const named = deliverablesIn(brief);

  // A brief nobody has filled in claims nothing, and a drafted one is the AI's
  // proposal rather than the project's answer — so neither is checked here.
  const unaccepted = (s) => s === undefined || s === "blank" || s === "drafted";
  const live = items.filter((i) => i.broken || !unaccepted(i.fields.status));
  const drafted = items.filter((i) => !i.broken && i.fields.status === "drafted");
  if (drafted.length > 0) {
    warnings.push(
      `${drafted.length} item brief(s) drafted from the code and not accepted — ` +
        "/translate refuses a drafted brief until a person sets status: filled",
    );
  }

  await lintQa(root, named, items, { errors, warnings, notes });

  // Where each accepted item stands on its sign-offs. Waiting is not a fault —
  // it is where work is — so it is a note; a malformed sign-off is an error.
  // A project with no qa/ folder predates the sign-offs and is not nagged;
  // `--ready`, the gate /build asks, holds everywhere.
  const verdicts = await qaVerdicts(root);
  const onTrack = !!(await fs.stat(path.join(root, "qa")).catch(() => null));
  for (const item of onTrack ? live : []) {
    if (item.broken) continue;
    const itemPath = path.relative(root, item.file).split(path.sep).join("/");
    const { waiting, wrong } = readiness(item, itemPath, verdicts);
    for (const w of wrong) errors.push(`${rel(item.file)}  ${w}`);
    if (wrong.length > 0) continue;
    if (waiting.length > 0) notes.push(`${itemPath} waiting on ${waiting.join("; ")}`);
    else if (item.fields.status !== "built") notes.push(`${itemPath} ready to build`);
  }

  if (named.length === 0) {
    notes.push(
      `no deliverables answered in ${rel(briefPath)} — ${live.length} item brief(s) unchecked`,
    );
    return { rel: rel(root), items: items.length, named, errors, warnings, notes };
  }

  for (const item of live) {
    const at = rel(item.file);
    if (item.broken) {
      errors.push(`${at}  is not valid JSON: ${item.broken}`);
      continue;
    }
    const claimed = (item.fields.deliverable ?? "").trim();
    if (claimed === "") {
      warnings.push(
        `${at}  names no deliverable (status: ${item.fields.status}) — one of: ${named.join(", ")}`,
      );
      continue;
    }
    if (named.includes(claimed)) continue;

    // **The near-miss is worth its own sentence.** "mvp" and "MVP" differ only
    // by a shift key, and the fix is obvious once said out loud — whereas a
    // name nobody recognises usually means the brief has moved on and the item
    // has not.
    const near = named.find((n) => n.toLowerCase() === claimed.toLowerCase());
    errors.push(
      near
        ? `${at}  deliverable "${claimed}" is spelled "${near}" in ${rel(briefPath)} — they have to match exactly`
        : `${at}  deliverable "${claimed}" is not in ${rel(briefPath)} (it lists: ${named.join(", ")})`,
    );
  }

  return { rel: rel(root), items: items.length, named, errors, warnings, notes };
}

const named = process.argv.slice(2);

if (named[0] === "--status") {
  let missing = false;
  for (const p of named.slice(1)) {
    let text;
    try {
      text = await read(path.resolve(p));
    } catch {
      console.log(`${p}: not found`);
      missing = true;
      continue;
    }
    let status;
    if (p.endsWith(".json")) {
      try {
        status = JSON.parse(text).status;
      } catch {
        status = "not valid JSON";
      }
    } else status = frontMatter(text)?.status;
    console.log(`${p}: ${status || "no status"}`);
  }
  process.exit(missing ? 1 : 0);
}

// **`--ready <brief>` is the gate /build asks before it plans.** Both
// sign-offs for the brief's current round, and QA's review happy. The builder
// gets the verdict, never QA's tests.
if (named[0] === "--ready") {
  const file = path.resolve(named[1] ?? "");
  let root = path.dirname(file);
  while (root !== path.dirname(root) && !(await fs.stat(path.join(root, "Project_brief.md")).catch(() => null))) {
    root = path.dirname(root);
  }
  const itemPath = path.relative(root, file).split(path.sep).join("/");
  const item = (await itemBriefs(root)).find((i) => path.resolve(i.file) === file);
  if (!item || item.broken) {
    console.log(`${named[1] ?? "nothing"}: not an item brief in a project`);
    process.exit(1);
  }
  const { round, waiting, wrong } = readiness(item, itemPath, await qaVerdicts(root));
  for (const w of wrong) console.log(`  ERROR  ${w}`);
  if (waiting.length === 0 && wrong.length === 0) {
    console.log(`${itemPath}: ready to build (round ${round})`);
    process.exit(0);
  }
  console.log(`${itemPath}: not ready (round ${round}) — waiting on:`);
  for (const w of waiting) console.log(`  ${w}`);
  process.exit(1);
}

const roots = named.length > 0 ? named.map((p) => path.resolve(p)) : await projectRoots(repo);

if (roots.length === 0) {
  console.log("no folder with a Project_brief.md found — nothing to check");
  process.exit(0);
}

let failed = false;
for (const root of roots.sort()) {
  const { rel, items, named: deliverables, errors, warnings, notes, unfinished } = await lint(root);
  if (unfinished) {
    const why =
      unfinished === "drafted"
        ? " — drafted from the code, not yet accepted (/translate refuses it until status: filled)"
        : " — not filled in yet, nothing to check";
    console.log("\n" + rel + why);
    continue;
  }
  console.log(
    `\n${rel} — ${items} item brief(s), ${deliverables.length} deliverable(s)` +
      (deliverables.length ? `: ${deliverables.join(" → ")}` : ""),
  );
  for (const n of notes) console.log(`  note   ${n}`);
  for (const w of warnings) console.log(`  warn   ${w}`);
  for (const e of errors) console.log(`  ERROR  ${e}`);
  if (errors.length === 0 && warnings.length === 0 && notes.length === 0) console.log("  clean");
  else if (errors.length > 0) console.log(`  ${errors.length} error(s), ${warnings.length} warning(s)`);
  if (errors.length > 0) failed = true;
}

process.exit(failed ? 1 : 0);
