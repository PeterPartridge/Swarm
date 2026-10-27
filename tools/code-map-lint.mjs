// Checks a Code_map.md against the code it claims to describe.
//
// **Why this exists at all.** The code map's whole job is to be read *before*
// new code is written, so a method already built gets reused instead of
// rebuilt. That makes it the one document in the framework whose value dies
// the moment it stops being true: a row naming a file that has moved sends the
// next build looking in the wrong place, and a row whose one-line summary has
// grown into three paragraphs costs more to read than the code it describes.
// The template says rows are never left stale. Nothing checked it, so this
// does.
//
// **What it refuses to guess.** It only checks what can be established from
// the files themselves — a path exists, a backticked name appears in one of
// that row's files, a summary is one sentence long. It does not judge whether
// the sentence is *accurate*; that is a person's job, and pretending otherwise
// would make a passing run mean more than it does.
//
// Usage:
//   node tools/code-map-lint.mjs                  # every ai-only/Code_map.md
//   node tools/code-map-lint.mjs <path…>          # just these
//
// Exit code 1 on an error. Warnings are printed and do not fail the run.

import { promises as fs } from "node:fs";
import path from "node:path";

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

/** The longest a row's first sentence may be.
 *
 *  The rule is "one line", and a line is what a person can take in without
 *  reading twice. 200 characters is roughly a full-width terminal line — long
 *  enough for a real sentence about a real method, short enough that rationale
 *  cannot hide inside it. Rationale is welcome; it just goes *after* the first
 *  sentence, where a reuse scan can stop reading. */
const SUMMARY_MAX = 200;

/** A cell that is part of the blank template rather than a claim about code. */
const isPlaceholder = (s) => /^<.*>$/.test(s.trim()) || s.trim() === "" || s.trim() === "…";

/** **Surfaces: the code that has to appear in the map, checked the other way round.**
 *
 *  Every other rule here reads a row and asks whether the code exists. None of
 *  them can see code that has *no* row — so a map describing a quarter of the
 *  codebase passed as `clean`, which is the state this repository was actually
 *  in when this rule was written: 206 Tauri commands and 23 tables appeared
 *  nowhere in its map, and the run before this rule existed said `clean`.
 *  A reuse ledger nobody can tell is empty is worse than no ledger, because the
 *  green run is read as "nothing already does this job".
 *
 *  A *surface* is code whose absence from the map is a reuse failure rather
 *  than a detail: something another build could plausibly rebuild by accident.
 *  Private helpers are not surfaces; an API command and a database table are.
 *
 *  **Declarative on purpose.** This file ships to projects that are not Tauri
 *  and not SQL, so adding a stack is adding a row here, not editing the walk.
 *  A pattern that matches nothing contributes nothing and costs nothing — a
 *  Go project simply finds no `#[tauri::command]` and is neither helped nor
 *  punished by the rule existing. */
const SURFACES = [
  {
    what: "Tauri command",
    dir: "src-tauri/src/commands",
    // The attribute sits above the signature, so the name is on a later line.
    pattern: /#\[tauri::command\][\s\S]{0,200}?\bfn\s+([a-z_][a-z0-9_]*)/g,
    explainedBy: "comment-above",
  },
  {
    what: "database table",
    dir: "src-tauri/src/db",
    pattern: /CREATE TABLE IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/gi,
    // A table's subject is its module. The `CREATE TABLE` line sits inside a
    // `create_table` function, so a comment above *it* describes the function;
    // the file header is what describes the table.
    explainedBy: "module-header",
  },
];

/** The least comment, in characters, that counts as an explanation.
 *
 *  **A floor, because a passing remark is not an explanation.** Without one,
 *  `// TODO: tidy this up` would discharge the rule and the count would fall to
 *  zero without a word being written. The doc comments already in this
 *  repository run to a median of 236 characters and a mean of 274, so 80 is
 *  well under every real one and well over every aside. */
const EXPLANATION_MIN = 80;

/** How many surfaces may have **no explanation anywhere** before this fails
 *  rather than warns.
 *
 *  **A ratchet, not a target.** Failing on the true number the day the rule
 *  landed would have blocked every other piece of work, which is how a good
 *  check gets commented out in week two. So the ceiling starts at what was
 *  already owed and only ever comes down: each explanation written lowers it,
 *  and a build that adds an unexplained surface fails immediately because the
 *  count went up.
 *
 *  **It counts the undocumented, not the unindexed** — see `unindexed` below
 *  for why those are two debts and only one of them is work.
 *
 *  **Why 106 and not 67.** Counting any doc comment at all as an explanation
 *  gives 67. Applying `EXPLANATION_MIN` gives 106, because 44 of them are a
 *  single line restating the name — `/// Writes to the terminal.` is 30
 *  characters and tells a reuse scan nothing the name did not. The higher
 *  number is the honest one.
 *
 *  Lower this number. Never raise it. */
const UNDOCUMENTED_CEILING = 106;

/** `{a,b}` → two strings. Tauri-side rows write two files that way, and so do
 *  frontend rows for a component and its helper. */
function expandBraces(s) {
  const m = s.match(/\{([^{}]*)\}/);
  if (!m) return [s];
  return m[1]
    .split(",")
    .map((part) => s.slice(0, m.index) + part.trim() + s.slice(m.index + m[0].length))
    .flatMap(expandBraces);
}

/** The file paths a row claims. */
function filesOf(cell) {
  const clean = cell.replace(/`/g, "").replace(/\*\*/g, "").trim();
  const out = new Set();
  for (const variant of expandBraces(clean)) {
    for (const piece of variant.split(",")) {
      const p = piece.trim();
      // Prose in a file cell ("and its tests") is not a path; a path here
      // always has a slash or an extension.
      if (p && (p.includes("/") || /\.[a-z]+$/.test(p))) out.add(p);
    }
  }
  return [...out];
}

/** The method names a row claims, taken **only** from backticks.
 *
 *  A cell with no backticks ("backend.ts wrappers", "standalone routing") is a
 *  prose label for a group of code rather than a name to look for, and
 *  searching for its words would report nothing but noise. */
function methodsOf(cell) {
  const out = new Set();
  for (const [, span] of cell.matchAll(/`([^`]+)`/g)) {
    // `mod::{a, b}` → a, b · `mod::name` → name · `*` → nothing
    const braced = span.match(/\{([^}]*)\}/);
    const names = braced ? braced[1].split(",") : [span.split("::").pop()];
    for (const raw of names) {
      for (const token of raw.split(/[/,]/)) {
        const name = token.trim().replace(/^[&*]+|[&*()]+$/g, "");
        // Four characters up, identifiers only: `get` out of
        // `get/set_roadmap_mode` is a fragment, not a name, and would match
        // any file on earth.
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && name.length >= 4) out.add(name);
      }
    }
  }
  return [...out];
}

/** The first sentence — what a reuse scan reads before deciding to keep going.
 *
 *  A sentence ends at a full stop followed by whitespace and something that
 *  starts a new one. Requiring the whitespace is what stops `backend.ts` and
 *  `0.1.0` from counting as endings; requiring a sentence-opening character
 *  stops `e.g. two` from doing so. **A backtick counts as one** — these rows
 *  routinely open a sentence with a code span, and leaving it out read four
 *  perfectly disciplined rows as a single 500-character run-on. Getting this
 *  wrong in the lenient direction passes a row it should have queried, which
 *  is the right way to be wrong. */
function firstSentence(text) {
  const m = text.match(/^(.*?[.!?][*_)\]"'”]*)\s+(?=[A-Z*_[(`"'“])/s);
  return (m ? m[1] : text).trim();
}

/** A path that is a *file*. A folder is not a match: rows name files, and a
 *  cell that resolves to a directory ("src/lib/") is the row being vaguer than
 *  the map is for. */
async function isFile(p) {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Is this line a comment, in any language this might ship to?
 *
 *  **Deliberately broad.** A framework that only recognised Rust's `///` would
 *  report a TypeScript or Python project as entirely unexplained on the day it
 *  installed. Doc markers (`///`, `//!`, `/**`, `"""`) and plain comments
 *  (`//`, `#`, `--`, ` *` inside a block) all count; the `EXPLANATION_MIN`
 *  floor is what separates an explanation from an aside, not the marker. */
const COMMENT_LINE = /^\s*(\/\/\/?!?|\/\*\*?|\*|#|--|"""|''')/;

/** The comment text immediately above `index`, as one string.
 *
 *  Walks back over blank lines first, so a comment separated from its
 *  declaration by one still counts, then takes the contiguous comment block. */
function commentAbove(text, index) {
  const lines = text.slice(0, index).split("\n");
  // The last element is the partial line the match sits on.
  lines.pop();
  const block = [];
  let i = lines.length - 1;
  while (i >= 0 && lines[i].trim() === "") i--;
  while (i >= 0 && COMMENT_LINE.test(lines[i])) {
    block.unshift(lines[i].replace(COMMENT_LINE, "").trim());
    i--;
  }
  return block.join(" ").trim();
}

/** The comment block at the very top of a file, as one string.
 *
 *  Attributes and `use` lines may sit above a module header in Rust, so those
 *  are stepped over rather than ending the search. */
function moduleHeader(text) {
  const block = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#![") || t.startsWith("use ")) continue;
    if (!COMMENT_LINE.test(line)) break;
    block.push(line.replace(COMMENT_LINE, "").trim());
  }
  return block.join(" ").trim();
}

/** Is this surface explained where somebody changing it would see it?
 *
 *  **Why a doc comment counts.** The map's job is to be an index — the AI
 *  workspace README says so: *"the code map is a supporting index"*. An
 *  explanation already sitting on the function is in a better place than a copy
 *  of it in a table: the compiler ships it, the diff shows it changing, and the
 *  person editing the code is looking straight at it. Requiring a row as well
 *  would make the map a third copy of prose that already lives in two places,
 *  and transcription is not the work this count exists to measure. */
function explained(text, index, how) {
  const prose = how === "module-header" ? moduleHeader(text) : commentAbove(text, index);
  return prose.length >= EXPLANATION_MIN;
}

/** Every surface on disk under one solution, as
 *  `{ what, name, file, explained }`.
 *
 *  A directory that is not there is not a failure — it means this solution has
 *  no surfaces of that kind, which is the normal case for most projects. */
async function surfacesUnder(root, base) {
  const found = [];
  for (const surface of SURFACES) {
    const dir = path.join(root, base ?? "", surface.dir);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const text = await fs.readFile(path.join(dir, entry.name), "utf8");
      for (const m of text.matchAll(surface.pattern)) {
        found.push({
          what: surface.what,
          name: m[1],
          file: `${surface.dir}/${entry.name}`,
          explained: explained(text, m.index, surface.explainedBy),
        });
      }
    }
  }
  return found;
}

/** Is this surface named anywhere in the map?
 *
 *  **Deliberately lenient.** A whole-word match against the entire document,
 *  not against the Method column — rows legitimately group names
 *  (`work_items::{list_work_items, create_work_item, …}`) and some describe a
 *  cluster in prose. Being lenient here passes a surface that is only
 *  mentioned in passing, which under-reports the debt; being strict would
 *  report hundreds of surfaces that *are* documented and bury the ones that
 *  are not. Under-reporting is the right way to be wrong for a number whose
 *  job is to come down. */
const isNamed = (text, name) => new RegExp(`\\b${name}\\b`).test(text);

/** One code map, parsed into solutions and their rows. */
async function parse(file) {
  // Normalised on the way in: a row's last cell would otherwise carry a
  // carriage return on a Windows checkout, and a rule anchored to the end of
  // a line would quietly stop matching — a green run that had read nothing.
  const text = (await fs.readFile(file, "utf8")).replace(/\r\n/g, "\n");
  const lines = text.split(/\r?\n/);
  const solutions = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const heading = line.match(/^##\s+Solution\s+[—-]\s+(.+)$/);
    if (heading) {
      current = { name: heading[1].trim(), localPath: null, rows: [] };
      solutions.push(current);
      continue;
    }
    if (!current) continue;

    const local = line.match(/\*\*Local path:\*\*\s*(.+?)\s*$/);
    if (local) {
      current.localPath = local[1].replace(/`/g, "").replace(/\s*·.*$/, "").trim();
      continue;
    }

    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;
    if (/^[-: ]+$/.test(cells[0])) continue; // separator
    if (/^Method$/i.test(cells[0])) continue; // header
    if (isPlaceholder(cells[0]) || isPlaceholder(cells[1])) continue; // blank template row
    current.rows.push({ line: i + 1, method: cells[0], file: cells[1], what: cells[2], uses: cells[3] });
  }
  return solutions;
}

async function lint(file) {
  // **Where a row's paths are resolved from.** A map lives at
  // `<project>/ai-only/Code_map.md`, so the project is two levels up —
  // and that is what a row's local path is relative to. The repository this
  // script sits in is tried as well, because a project inside a larger
  // repository (this one) writes local paths from the repository root. Both
  // are cheap to try and getting it wrong reports a file that is really there.
  const holder = path.dirname(file);
  const project = path.basename(holder) === "ai-only" ? path.dirname(holder) : repo;
  const errors = [];
  const warnings = [];
  const rel = path.relative(repo, file).split(path.sep).join("/");
  const solutions = await parse(file);
  const mapText = (await fs.readFile(file, "utf8")).replace(/\r\n/g, "\n");
  let rowCount = 0;
  const uncovered = [];

  for (const solution of solutions) {
    // A solution whose local path is still the template's angle-bracket
    // placeholder is not claiming anything about code on disk.
    const base = solution.localPath && !isPlaceholder(solution.localPath) ? solution.localPath : null;
    const seen = new Map();

    for (const row of solutions.find((s) => s === solution).rows) {
      rowCount++;
      const at = `${rel}:${row.line}`;

      // --- the summary is one line ---------------------------------------
      if (isPlaceholder(row.what)) {
        errors.push(`${at}  no description: a row with no summary cannot be scanned for reuse`);
      } else {
        const first = firstSentence(row.what);
        if (first.length > SUMMARY_MAX) {
          errors.push(
            `${at}  first sentence is ${first.length} chars (max ${SUMMARY_MAX}) — ` +
              `state what it does in one line, then put the reasoning after it\n` +
              `          ${first.slice(0, 120)}…`,
          );
        }
      }

      if (isPlaceholder(row.uses)) {
        warnings.push(`${at}  empty "Uses" — write "nothing" if it stands alone`);
      }

      // --- the files exist -------------------------------------------------
      const claimed = filesOf(row.file);
      if (claimed.length === 0) {
        warnings.push(`${at}  no file path in the File column: ${row.file}`);
        continue;
      }
      const present = [];
      for (const p of claimed) {
        const roots = project === repo ? [repo] : [project, repo];
        const candidates = roots.flatMap((r) => (base ? [path.join(r, base, p), path.join(r, p)] : [path.join(r, p)]));
        let found = null;
        for (const c of candidates) if (await isFile(c)) { found = c; break; }
        if (found) present.push(found);
        else
          errors.push(
            `${at}  file not found: ${p}` + (base ? `  (looked under ${base} and the project root)` : ""),
          );
      }

      // --- the methods are in them -----------------------------------------
      if (present.length > 0) {
        const bodies = await Promise.all(present.map((p) => fs.readFile(p, "utf8")));
        const haystack = bodies.join("\n");
        for (const name of methodsOf(row.method)) {
          if (!haystack.includes(name)) {
            errors.push(
              `${at}  "${name}" is not in ${present
                .map((p) => path.relative(repo, p).split(path.sep).join("/"))
                .join(", ")} — renamed, removed, or in another file`,
            );
          }
          // **Keyed by file, not by bare name.** `create` exists in a dozen
          // db modules and they are a dozen different methods; only two rows
          // naming the same method in the same file are describing one thing
          // twice — which is how a round-3 row ends up sitting under the row it
          // replaced.
          const key = `${path.relative(repo, present[0])}::${name}`;
          const before = seen.get(key);
          if (before) {
            warnings.push(
              `${at}  "${name}" already has a row at line ${before} for the same file — the map ` +
                `describes the code as it is now, so a later round edits that row rather than adding one`,
            );
          } else seen.set(key, row.line);
        }
      }
    }

    // --- and the other direction: code with no row at all ------------------
    if (base) {
      const roots = project === repo ? [repo] : [project, repo];
      for (const root of roots) {
        const found = await surfacesUnder(root, base);
        if (found.length === 0) continue;
        for (const s of found) if (!isNamed(mapText, s.name)) uncovered.push(s);
        break; // The first root that has the code is the one it lives in.
      }
    }
  }

  return { rel, rowCount, solutions: solutions.length, errors, warnings, uncovered };
}

/** Every code map in the repository, when none is named. */
async function findMaps(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "target" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await findMaps(full, out);
    else if (entry.name === "Code_map.md") out.push(full);
  }
  return out;
}

const named = process.argv.slice(2);
const maps = named.length > 0 ? named.map((p) => path.resolve(p)) : await findMaps(repo);

if (maps.length === 0) {
  console.log("no Code_map.md found — nothing to check");
  process.exit(0);
}

let failed = false;
for (const map of maps) {
  const { rel, rowCount, solutions, errors, warnings, uncovered } = await lint(map);
  console.log(`\n${rel} — ${rowCount} rows, ${solutions} solution(s)`);
  for (const w of warnings) console.log(`  warn   ${w}`);
  for (const e of errors) console.log(`  ERROR  ${e}`);

  // **Two debts, counted separately, because only one of them is work.**
  // A surface explained in a doc comment is *unindexed*: the reasoning is
  // already where whoever changes the code is looking, and adding a row would
  // copy it. A surface explained nowhere is *undocumented*, and that is the one
  // somebody has to sit down and write. A single number put 160 transcriptions
  // and 67 pieces of real work behind the same figure, so the figure could only
  // be paid down by transcribing.
  const undocumented = uncovered.filter((s) => !s.explained);
  const unindexed = uncovered.filter((s) => s.explained);

  // Grouped and counted rather than listed in full: two hundred lines of
  // "no row for X" is a wall nobody reads, and the number is the part that has
  // to move. The first few name themselves so there is somewhere to start.
  const report = (items, label) => {
    const byKind = new Map();
    for (const s of items) byKind.set(s.what, [...(byKind.get(s.what) ?? []), s]);
    for (const [what, group] of byKind) {
      console.log(
        `           ${group.length} ${what}(s)${label}, e.g. ${group
          .slice(0, 3)
          .map((s) => `${s.name} (${s.file})`)
          .join(", ")}`,
      );
    }
  };

  if (undocumented.length > 0) {
    const over = undocumented.length > UNDOCUMENTED_CEILING;
    console.log(
      `  ${over ? "ERROR " : "warn  "} ${undocumented.length} surface(s) have no explanation anywhere ` +
        `(ceiling ${UNDOCUMENTED_CEILING}) — no row, and nothing on the code either`,
    );
    report(undocumented, "");
    if (over) {
      console.log(
        `           This went UP. Explain what you built — a doc comment on it counts — ` +
          `or say why it is not a surface.`,
      );
      failed = true;
    } else if (undocumented.length < UNDOCUMENTED_CEILING) {
      console.log(
        `           Below the ceiling by ${UNDOCUMENTED_CEILING - undocumented.length} — ` +
          `lower UNDOCUMENTED_CEILING in tools/code-map-lint.mjs to lock the gain in.`,
      );
    }
  }

  // Reported, never failed on. The explanation exists; where it is indexed is a
  // judgement about reuse, not a gap in the record, and failing a build over it
  // would buy a row nobody needed with prose that already existed.
  if (unindexed.length > 0) {
    console.log(
      `  note   ${unindexed.length} surface(s) explained in the code but not indexed ` +
        `— reuse scans read the map, so add a row for any of these a build might rebuild`,
    );
    report(unindexed, " explained on the code");
  }

  if (errors.length === 0 && warnings.length === 0 && uncovered.length === 0) console.log("  clean");
  else
    console.log(
      `  ${errors.length} error(s), ${warnings.length} warning(s)` +
        (undocumented.length > 0 ? `, ${undocumented.length} unexplained` : "") +
        (unindexed.length > 0 ? `, ${unindexed.length} unindexed` : ""),
    );
  if (errors.length > 0) failed = true;
}

process.exit(failed ? 1 : 0);
