// Checks the specs the AI writes in ai-only/ against the briefs they came from.
//
// **Why this exists.** People no longer have to read the AI's specs line by
// line — that was the promise the Lean AI layer changed — so something else has
// to. The failure the read-back used to catch is invented scope: a sentence in
// the spec nobody asked for, which the next build then honours. Here every fact
// carries a source, and a source is checkable: the question it names exists,
// and somebody actually answered it. A line with no source, or with a source
// that says nothing, is the invented line.
//
// **What it refuses to guess.** It checks that a source exists and is not
// empty — not that the line says what the source says. That stays a person's
// job when they choose to look, and a passing run should not be read as more.
//
// **Unknowns are not faults.** An `UNKNOWN:` line is the AI doing exactly what
// it was asked — stopping rather than guessing — so it is reported, not failed.
// `--ready <spec>` is the other question, "may this be built now?", and there an
// open unknown is a no. /build runs that before it plans.
//
// Usage:
//   node tools/spec-lint.mjs                   # every project in the repository
//   node tools/spec-lint.mjs <projectRoot…>    # just these
//   node tools/spec-lint.mjs --ready <spec.md> # …and fail if any UNKNOWN is open
//
// Exit code 1 on an error. Notes are printed and do not fail the run.

import { execFileSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", "target", ".git", "dist", "ai-only", "_forms", ".github"]);

/** Reads a document with its line endings normalised — a CRLF checkout once
 *  made a sibling check pass everything it read, because `$` does not match
 *  before a carriage return. */
async function read(file) {
  return (await fs.readFile(file, "utf8")).replace(/\r\n/g, "\n");
}

/** A framework file a project received from `init`, falling back to this
 *  repository's `template/` copy. */
function frameworkFile(root, rel) {
  for (const p of [path.join(root, rel), path.join(repo, "template", rel)]) if (existsSync(p)) return p;
  return null;
}

/** **The allowed keys come from the format document, not from a list here.**
 *  Two copies of the key list would disagree within a month; reading the
 *  `## Keys` table means the document a translator reads is the rule the check
 *  enforces. */
async function allowedKeys(root) {
  const file = frameworkFile(root, "ai-only/2-ai-system.template.md");
  if (!file) return null;
  const text = await read(file);
  // Matched on the word, not the whole heading: a heading reworded to
  // "## Keys: only these" once left the check with no keys at all.
  const section = text.match(/^## Keys\b[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  const keys = new Set();
  for (const line of (section?.[1] ?? "").split("\n")) {
    if (!line.startsWith("|")) continue;
    for (const [, k] of line.matchAll(/`([A-Za-z][A-Za-z-]*)`/g)) keys.add(k);
  }
  return keys;
}

/** Front matter as flat scalars — the same small reader brief-lint uses. */
function frontMatter(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const fields = {};
  for (const line of text.slice(4, end).split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).replace(/\s+#.*$/, "").trim();
  }
  return { fields, bodyStart: text.slice(0, text.indexOf("\n", end + 1) + 1).split("\n").length - 1 };
}

/** Is there an answer here — rather than a question, guidance or an example? */
function hasContent(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v !== "object") return true;
  if (Array.isArray(v)) return v.length > 0;
  if ("answer" in v) return hasContent(v.answer);
  if ("entries" in v) return hasContent(v.entries);
  return Object.entries(v).some(
    ([k, x]) => !["question", "guidance", "example", "exampleEntry", "note"].includes(k) && hasContent(x),
  );
}

/** The answer under `### id —` in a Markdown brief, without its guidance. */
function markdownAnswer(text, id) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^###\\s+${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(l));
  if (start === -1) return null;
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,3}\s|^---\s*$/.test(l)) break;
    if (l.trim() !== "" && !l.trimStart().startsWith(">")) out.push(l);
  }
  return out.join("\n");
}

/** Resolves one source. Returns null when it is good, or what is wrong. */
async function checkSource(src, ctx) {
  const preset = src.match(/^(preset|baseline):(.+)$/);
  if (preset) {
    const file = frameworkFile(ctx.root, "_forms/boilerplates.json");
    if (!file) return "no _forms/boilerplates.json to look it up in";
    const all = JSON.parse(await read(file));
    const table = preset[1] === "preset" ? all.boilerplates : all.securityBaselines;
    return table?.[preset[2]] ? null : `${src} is not in _forms/boilerplates.json`;
  }

  const hash = src.lastIndexOf("#");
  const rel = hash === -1 ? ctx.from : src.slice(0, hash);
  const id = hash === -1 ? src : src.slice(hash + 1);
  const file = path.join(ctx.root, rel);
  if (!existsSync(file)) return `${rel} does not exist`;
  const text = await read(file);

  let answered;
  if (rel.endsWith(".json")) {
    let v = JSON.parse(text);
    for (const part of id.split(".")) {
      if (v === null || typeof v !== "object" || !(part in v)) return `${rel} has no "${id}"`;
      v = v[part];
    }
    answered = hasContent(v);
  } else {
    const answer = markdownAnswer(text, id);
    if (answer === null) return `${rel} has no question "${id}"`;
    answered = answer.trim() !== "";
  }
  // **An unknown may cite an empty answer — that is usually why it is unknown** —
  // and so may a deferral of one.
  // Anything else citing one is a fact with nothing behind it.
  return answered || ctx.unknown ? null : `cites ${rel}#${id}, which nobody has answered`;
}

const LINE = /^([A-Za-z][A-Za-z-]*):\s+(.+?)\s*$/;

const ITEM_SPECS = new Set(["page", "endpoint", "model"]);

/** `[a, b]` → ["a", "b"], sorted so order is not a difference. */
const listOf = (v) =>
  String(v ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .sort();

/** An item brief's deliverable and dependencies, Markdown or JSON. */
async function briefHeader(file) {
  const text = await read(file);
  if (file.endsWith(".json")) {
    const b = JSON.parse(text);
    return { deliverable: b.deliverable ?? "", dependsOn: [...(b.dependsOn?.entries ?? [])].sort() };
  }
  const f = frontMatter(text)?.fields ?? {};
  return { deliverable: f.deliverable ?? "", dependsOn: listOf(f["depends-on"]) };
}

async function lintSpec(file, root, keys) {
  const errors = [];
  const unknowns = [];
  const checks = [];
  const cites = [];
  const text = await read(file);
  const fm = frontMatter(text);
  if (!fm?.fields.spec) return null; // not a spec — the framework's own documents live here too

  const from = fm.fields.from;
  if (!from) errors.push(`:1  no "from:" — nothing to check its sources against`);
  else if (!existsSync(path.join(root, from))) errors.push(`:1  from: ${from} does not exist`);

  // **The copy /build reads instead of the brief.** An item spec carries its
  // brief's deliverable and dependencies so a build need not open the brief.
  // A copy that has drifted would build towards the wrong deliverable, or
  // before what it depends on — so it is checked like any other source.
  if (ITEM_SPECS.has(fm.fields.spec) && from && existsSync(path.join(root, from))) {
    const brief = await briefHeader(path.join(root, from));
    const list = (v) => `[${v.join(", ")}]`;
    if (!("deliverable" in fm.fields)) errors.push(`:1  no "deliverable:" — copy it from ${from}`);
    else if (fm.fields.deliverable !== brief.deliverable) {
      errors.push(`:1  deliverable "${fm.fields.deliverable}" but the brief says "${brief.deliverable}" — re-translate`);
    }
    if (!("depends-on" in fm.fields)) errors.push(`:1  no "depends-on:" — copy it from ${from}`);
    else {
      const deps = listOf(fm.fields["depends-on"]);
      if (list(deps) !== list(brief.dependsOn)) {
        errors.push(`:1  depends-on ${list(deps)} but the brief says ${list(brief.dependsOn)} — re-translate`);
      }
    }
  }

  const lines = text.split("\n");
  for (let i = fm.bodyStart; i < lines.length; i++) {
    const line = lines[i];
    const at = `:${i + 1}`;
    if (/^##\s+Round\b/.test(line)) break; // build's reports — prose, by design
    if (line.trim() === "" || line.startsWith("#") || line.startsWith(">") || line.startsWith("```")) continue;

    const m = line.match(LINE);
    if (!m) {
      errors.push(`${at}  not a "key: value [source]" line — ${line.slice(0, 60)}`);
      continue;
    }
    const [, key, rest] = m;
    if (!keys.has(key)) {
      errors.push(`${at}  "${key}" is not a key in 2-ai-system.template.md`);
      continue;
    }
    const src = rest.match(/\[([^\]]+)\]\s*$/);
    if (!src) {
      errors.push(`${at}  "${key}" has no [source] — where did it come from?`);
      continue;
    }
    if (key === "DEFERRED" && !/—\s*owner:\s*\S/.test(rest)) {
      errors.push(`${at}  DEFERRED needs "— owner: <name>" — a deferral nobody owns is an unknown`);
    }
    if (key === "check") {
      const id = rest.match(/^(C\d+)\s+\S/)?.[1];
      if (!id) errors.push(`${at}  check needs an ID: check: C<n> <what must be true> [source]`);
      else if (checks.includes(id)) errors.push(`${at}  ${id} is used twice — a test naming it would not say which`);
      else checks.push(id);
    }
    if (key === "UNKNOWN") unknowns.push(`${at}  ${rest.replace(/\s*\[[^\]]+\]\s*$/, "")}`);

    if (from && existsSync(path.join(root, from))) {
      for (const s of src[1].split(",").map((x) => x.trim()).filter(Boolean)) {
        const wrong = await checkSource(s, { root, from, unknown: key === "UNKNOWN" || key === "DEFERRED" });
        if (wrong) errors.push(`${at}  [${s}] — ${wrong}`);
        else if (!/^(preset|baseline):/.test(s)) cites.push({ line: i + 1, src: s });
      }
    }
  }
  return { errors, unknowns, checks, kind: fm.fields.spec, from, text, file, cites };
}

// ---------------------------------------------------------------------------
// **Impact: what a brief change affects.** Every line cites the answer it came
// from, and git holds that answer as it read when the spec was last written.
// A line whose cited answer now reads differently is stale: the spec says
// something the people no longer do. Noted on every run, listed by
// `--impact`, and refused by `--ready`, so nothing is built from an old
// reading of the brief. A spec changed since its last commit counts as freshly
// written; a project not in git cannot tell, and says nothing.

const git = (cwd, args) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
};

/** An answer as plain text, so a change in spacing is not a change. */
function answerIn(text, rel, id) {
  if (text === null) return null;
  if (rel.endsWith(".json")) {
    let v;
    try {
      v = JSON.parse(text);
    } catch {
      return null;
    }
    for (const part of id.split(".")) v = v && typeof v === "object" ? v[part] : undefined;
    return v === undefined ? null : JSON.stringify(v);
  }
  const a = markdownAnswer(text, id);
  return a === null ? null : a.replace(/\s+/g, " ").trim();
}

async function staleness({ file, from, cites }, root) {
  const stale = [];
  const top = git(root, ["rev-parse", "--show-toplevel"])?.trim();
  if (!top || !from) return stale;
  const relToTop = (p) => path.relative(top, p).split(path.sep).join("/");
  const commit = git(root, ["log", "-1", "--format=%H", "--", relToTop(file)])?.trim();
  if (!commit) return stale; // never committed: written just now
  if (git(root, ["status", "--porcelain", "--", relToTop(file)])?.trim()) return stale; // rewritten since
  const then = new Map();
  for (const { line, src } of cites) {
    const hash = src.lastIndexOf("#");
    const rel = hash === -1 ? from : src.slice(0, hash);
    const id = hash === -1 ? src : src.slice(hash + 1);
    if (!then.has(rel)) then.set(rel, git(root, ["show", `${commit}:${relToTop(path.join(root, rel))}`]));
    const before = answerIn(then.get(rel), rel, id);
    const now = answerIn(await read(path.join(root, rel)), rel, id);
    if (before !== now) stale.push({ line, src });
  }
  return stale;
}

// ---------------------------------------------------------------------------
// **Debt flows back.** A build declares each debt as `D<n>: …` under "Debt I
// left behind". People decide in the brief: a change round naming it schedules
// it; the accepted-debt part accepts it as it is. A later round that pays it
// says `Paid D<n>`. Whatever nobody has decided on is open — and `--debt`
// lists it, so a person can be walked through it.

const DEBT_LINE = /^\s*(?:[-*]\s+)?\**(D\d+)\**\s*[:—–-]\s*(.*)$/;
const SHRUG = /^\s*(?:[-*]\s+)?(none|nothing|n\/a)\.?\s*$/i;

/** The debt a spec's build reports declare, and the debt they say was paid. */
function reportedDebt(text) {
  const declared = [];
  const paid = new Set();
  const errors = [];
  const at = text.search(/^##\s+Round\b/m);
  if (at === -1) return { declared, paid, errors };
  let section = null;
  let unlabelled = false;
  for (const line of text.slice(at).split("\n")) {
    const heading = line.match(/^#{2,3}\s+(.*)$/);
    if (heading) {
      section = /^debt i left behind/i.test(heading[1]) ? "debt" : /^what i did/i.test(heading[1]) ? "did" : null;
      continue;
    }
    if (section === "did") for (const [, id] of line.matchAll(/\bpaid\s+(D\d+)\b/gi)) paid.add(id);
    if (section !== "debt" || line.trim() === "" || SHRUG.test(line) || /^\s{2,}\S/.test(line)) continue;
    const m = line.match(DEBT_LINE);
    if (!m) unlabelled = true;
    else if (declared.some((d) => d.id === m[1])) errors.push(`  ${m[1]} is declared twice — a round naming it would not say which`);
    else declared.push({ id: m[1], text: m[2].trim() });
  }
  if (unlabelled) errors.push(`  debt needs an ID: write each as "- D<n>: …", so a person can schedule it`);
  return { declared, paid, errors };
}

/** What the brief has decided: the debt its change rounds schedule, and the
 *  debt it accepts as it is. */
function decidedDebt(briefText, isJson) {
  const ids = (s) => [...String(s).matchAll(/\bD\d+\b/g)].map((m) => m[0]);
  if (isJson) {
    const b = JSON.parse(briefText);
    return {
      scheduled: new Set((b.changesOverTime?.rounds ?? []).flatMap((r) => ids(r?.change ?? r))),
      accepted: new Set((b.acceptedDebt?.entries ?? []).flatMap((e) => ids(e?.debt ?? e))),
    };
  }
  const part = (name) =>
    (briefText.match(new RegExp(`^##[^\\n]*${name}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "im"))?.[1] ?? "")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith(">"))
      .join("\n");
  return { scheduled: new Set(ids(part("changes-over-time"))), accepted: new Set(ids(part("accepted-debt"))) };
}

async function debt({ kind, from, text }, root) {
  const errors = [];
  const notes = [];
  const open = [];
  if (!ITEM_SPECS.has(kind) || !from || !existsSync(path.join(root, from))) return { errors, notes, open };
  const { declared, paid, errors: reportErrors } = reportedDebt(text);
  errors.push(...reportErrors);
  const { scheduled, accepted } = decidedDebt(await read(path.join(root, from)), from.endsWith(".json"));
  const known = new Set(declared.map((d) => d.id));
  for (const id of new Set([...scheduled, ...accepted, ...paid])) {
    if (!known.has(id)) errors.push(`  ${from} names ${id}, which no build declared`);
  }
  if (declared.length === 0) return { errors, notes, open };
  const of = (pick) => declared.filter(pick).map((d) => d.id);
  const isPaid = (d) => paid.has(d.id);
  const isAccepted = (d) => !isPaid(d) && accepted.has(d.id);
  const isScheduled = (d) => !isPaid(d) && !isAccepted(d) && scheduled.has(d.id);
  for (const d of declared) if (!isPaid(d) && !isAccepted(d) && !isScheduled(d)) open.push(`${from} ${d.id}: ${d.text}`);
  const count = (label, ids) => `${ids.length} ${label}${ids.length ? ` (${ids.join(", ")})` : ""}`;
  notes.push(
    `debt: ${count("open", open.map((o) => o.split(" ")[1].replace(":", "")))}, ${count("scheduled", of(isScheduled))}, ` +
      `${count("accepted", of(isAccepted))}, ${count("paid", of(isPaid))}`,
  );
  return { errors, notes, open };
}

// ---------------------------------------------------------------------------
// **Tracing: every check has a test, and every test names a real check.**
//
// A test proves a check by naming it as `<item>#C<n>` (`userLogin#C2`) in its
// name or beside it. This searches the solution's code for those names. A
// built item with a check no test names is "done" with nothing behind it, so
// it fails; one not built yet is only noted. A name for a check the spec does
// not have is a test of something nobody asked for, or of a check since
// removed, so it fails too. It proves a test *names* a check, not that it
// tests it: that is /verify's question, and a person's.

const SKIP_CODE = new Set(["node_modules", ".git", "dist", "build", "target", "ai-only", "qa", ".next", "coverage"]);

/** Each solution's local path, from the digest's `solution:` lines. */
async function solutionPaths(root) {
  const out = new Map();
  const digest = path.join(root, "ai-only/Project_digest.md");
  if (!existsSync(digest)) return out;
  for (const line of (await read(digest)).split("\n")) {
    const m = line.match(/^solution:\s+(.+?)\s*\[[^\]]+\]\s*$/);
    if (!m) continue;
    const parts = m[1].split(/\s+—\s+/);
    if (parts.length >= 4) out.set(parts[0].trim(), parts[parts.length - 1].trim());
  }
  return out;
}

async function codeFiles(dir, out = []) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP_CODE.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await codeFiles(full, out);
    else if (!e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

async function trace({ checks, kind, from }, root, solutions) {
  const errors = [];
  const notes = [];
  if (!ITEM_SPECS.has(kind) || !from || checks.length === 0) return { errors, notes };
  const solution = from.split("/")[0];
  const item = path.basename(from).replace(/\.(md|json)$/, "");
  const local = solutions.get(solution);
  if (!local) return { errors, notes: [`cannot trace checks: the digest has no solution line for ${solution}`] };
  const dir = path.resolve(root, local);
  if (!existsSync(dir)) return { errors, notes: [`cannot trace checks: ${local} is not here`] };

  const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = new RegExp(`(?<![\\w-])${escaped}#(C\\d+)\\b`, "g");
  const found = new Set();
  for (const file of await codeFiles(dir)) {
    for (const [, id] of (await read(file)).matchAll(tag)) {
      if (checks.includes(id)) found.add(id);
      else errors.push(`  ${path.relative(dir, file).split(path.sep).join("/")} names ${item}#${id}, which the spec does not have`);
    }
  }
  const brief = await read(path.join(root, from));
  const status = from.endsWith(".json") ? JSON.parse(brief).status : frontMatter(brief)?.fields.status;
  for (const id of checks.filter((c) => !found.has(c))) {
    if (status === "built") errors.push(`  built, and ${id} has no test naming it (${item}#${id})`);
  }
  notes.push(`${found.size} of ${checks.length} check(s) have a test naming them (${item}#C<n>)`);
  return { errors, notes };
}

/** Every folder holding a Project_brief.md. */
async function projectRoots(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && e.name === "Project_brief.md")) out.push(dir);
  for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name)) await projectRoots(path.join(dir, e.name), out);
  return out;
}

async function specsIn(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== "procedures") await specsIn(full, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** The project a spec belongs to: the nearest folder above it with a brief. */
function rootOf(file) {
  for (let d = path.dirname(file); d !== path.dirname(d); d = path.dirname(d)) {
    if (existsSync(path.join(d, "Project_brief.md"))) return d;
  }
  return null;
}

const debtMode = process.argv.includes("--debt");
const impactMode = process.argv.includes("--impact");
const args = process.argv.slice(2).filter((a) => a !== "--debt" && a !== "--impact");
const readyAt = args.indexOf("--ready");
let targets; // [{ root, files }]
if (readyAt !== -1) {
  const spec = path.resolve(args[readyAt + 1] ?? "");
  const root = rootOf(spec);
  if (!existsSync(spec) || !root) {
    console.log(`--ready needs a spec inside a project — got ${args[readyAt + 1] ?? "nothing"}`);
    process.exit(1);
  }
  targets = [{ root, files: [spec] }];
} else {
  const roots = args.length > 0 ? args.map((p) => path.resolve(p)) : await projectRoots(repo);
  targets = await Promise.all(roots.map(async (root) => ({ root, files: await specsIn(path.join(root, "ai-only")) })));
}

let failed = false;
let checked = 0;
const openDebt = [];
const impact = [];
// In --debt and --impact modes the per-spec report is not wanted: just the list.
const say = debtMode || impactMode ? () => {} : (...a) => console.log(...a);
for (const { root, files } of targets) {
  const keys = await allowedKeys(root);
  if (!keys || keys.size === 0) {
    console.log(`\n${path.relative(repo, root) || "."} — no key table in ai-only/2-ai-system.template.md`);
    failed = true;
    continue;
  }
  const solutions = await solutionPaths(root);
  for (const file of files.sort()) {
    const result = await lintSpec(file, root, keys);
    if (!result) continue;
    checked++;
    const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
    const traced = await trace(result, root, solutions);
    const owed = await debt(result, root);
    openDebt.push(...owed.open);
    traced.notes.push(...owed.notes);
    const stale = await staleness(result, root);
    for (const { line, src } of stale) {
      traced.notes.push(`stale: line ${line} cites [${src}], which changed since this spec was written — re-translate`);
    }
    if (stale.length > 0) impact.push(`${rel}: ${[...new Set(stale.map((x) => `[${x.src}]`))].join(", ")}`);
    const errors = [...result.errors, ...traced.errors, ...owed.errors];
    const { unknowns } = result;
    say(`\n${rel}`);
    for (const e of errors) say(`  ERROR  ${rel}${e}`);
    for (const n of traced.notes) say(`  note   ${n}`);
    for (const u of unknowns) say(`  open   ${rel}${u}`);
    if (errors.length === 0 && unknowns.length === 0) say("  every line sourced");
    if (errors.length > 0) failed = true;
    if (readyAt !== -1 && stale.length > 0) {
      console.log(`  not ready: ${stale.length} line(s) stale — the brief changed after this spec was written; re-translate it`);
      failed = true;
    }
    if (readyAt !== -1 && unknowns.length > 0) {
      console.log(`  not ready: ${unknowns.length} unknown(s) open — a person answers them, or marks them DEFERRED with an owner`);
      failed = true;
    }
  }
}
if (impactMode) {
  console.log(impact.length === 0 ? "nothing to re-translate — every spec matches the answers it cites" : `${impact.length} spec(s) to re-translate:`);
  for (const i of impact) console.log(`  ${i}`);
  process.exit(0);
}
if (debtMode) {
  console.log(openDebt.length === 0 ? "no open debt" : `${openDebt.length} open debt item(s), nobody has decided on yet:`);
  for (const d of openDebt) console.log(`  ${d}`);
  process.exit(0);
}
if (checked === 0) console.log("no specs in ai-only/ yet — nothing to check");
process.exit(failed ? 1 : 0);
