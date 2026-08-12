/** Where somebody wants the program to stop.
 *
 *  **Per machine, in localStorage**, by the same rule as the architecture map's
 *  layout and the theme: a breakpoint is one person's way of looking at shared
 *  code, not a fact about the code. Two developers debugging the same file want
 *  different lines, and neither is more true. The Solutions and their files are
 *  the shared truth and those are in the database.
 *
 *  Keyed by Solution and repository-relative path, because two Solutions can
 *  each hold a `src/main.go` and a breakpoint in one is not a breakpoint in the
 *  other. */

const KEY = "coperativeai.breakpoints";

/** One breakpoint: a line, and optionally what to do there beyond stopping. */
export interface Mark {
  line: number;
  /** An expression in the debugged language, evaluated by the adapter in the
   *  running program. Empty means stop every time. */
  condition: string;
  /** A message to print **instead of** stopping — a log point. `{expr}` inside
   *  it is evaluated in the program. Empty means stop, as normal.
   *
   *  This is the `println` you would otherwise add, without the edit and
   *  without the rebuild, which is the whole reason it earns a box. */
  log: string;
  /** How many times the line has to be reached first — "stop the 500th time
   *  round, not the first".
   *
   *  **The grammar is the adapter's**, not this app's: js-debug takes `7`,
   *  Delve takes `== 7`, and DAP says only that it is something the adapter
   *  understands. Passed through verbatim so the debugger's own complaint is
   *  what a person sees. */
  hits: string;
}

/** Every breakpoint on this machine: `solutionId → path → marks`. */
export type BreakpointStore = Record<string, Record<string, Mark[]>>;

/** What was stored before conditions existed: a bare list of line numbers.
 *
 *  Read and converted rather than discarded — somebody's breakpoints are not
 *  worth losing over a shape change, and this store is per machine so there is
 *  no migration anywhere else to do it. */
type StoredFile = (Partial<Mark> & { line: number })[] | number[];

function marksOf(stored: StoredFile): Mark[] {
  return stored.map((entry) =>
    typeof entry === "number"
      ? { line: entry, condition: "", log: "", hits: "" }
      : // Fields are defaulted one by one rather than by shape, because the
        // store has grown three times now and a mark written at any of those
        // points is a real thing to find on somebody's machine.
        {
          line: entry.line,
          condition: entry.condition ?? "",
          log: entry.log ?? "",
          hits: entry.hits ?? "",
        },
  );
}

export function loadBreakpoints(): BreakpointStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Record<string, StoredFile>>;
    const out: BreakpointStore = {};
    for (const [solution, files] of Object.entries(parsed)) {
      out[solution] = {};
      for (const [path, stored] of Object.entries(files)) {
        out[solution][path] = marksOf(stored);
      }
    }
    return out;
  } catch {
    // A machine that refuses localStorage still debugs for this session.
    return {};
  }
}

function save(store: BreakpointStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Same: this session still works.
  }
}

/** The lines that stop the program — the ordinary dots in the gutter. */
export function linesIn(
  store: BreakpointStore,
  solutionId: number,
  path: string,
): number[] {
  return marksIn(store, solutionId, path)
    .filter((m) => m.log === "")
    .map((m) => m.line);
}

/** The lines that print instead of stopping.
 *
 *  Kept apart from `linesIn` so the gutter can draw them differently: a log
 *  point that looked like a breakpoint would be a mark that never stops, which
 *  reads as a debugger that is broken. */
export function logLinesIn(
  store: BreakpointStore,
  solutionId: number,
  path: string,
): number[] {
  return marksIn(store, solutionId, path)
    .filter((m) => m.log !== "")
    .map((m) => m.line);
}

/** The breakpoints in one file, conditions included. */
export function marksIn(
  store: BreakpointStore,
  solutionId: number,
  path: string,
): Mark[] {
  return store[String(solutionId)]?.[path] ?? [];
}

/** Every breakpoint in one Solution, whichever file it is in.
 *
 *  **Because a breakpoint in a closed file is invisible and still stops the
 *  program.** The strip above the editor only knows about the file that is
 *  open, so a mark left in a file since closed halts a run with nothing on
 *  screen to explain why — and no way to clear it short of remembering where it
 *  was and opening that file again.
 *
 *  Sorted by path and then line, so the same set always reads the same way. */
export function allMarksIn(
  store: BreakpointStore,
  solutionId: number,
): { path: string; mark: Mark }[] {
  const files = store[String(solutionId)] ?? {};
  return Object.entries(files)
    .flatMap(([path, marks]) => marks.map((mark) => ({ path, mark })))
    .sort((a, b) => a.path.localeCompare(b.path) || a.mark.line - b.mark.line);
}

/** Adds a line, or takes it away if it is already there.
 *
 *  Returns a new store rather than mutating: it is React state, and a mutated
 *  object would not re-render the gutter that is showing it. */
export function toggleBreakpoint(
  store: BreakpointStore,
  solutionId: number,
  path: string,
  line: number,
): BreakpointStore {
  const held = marksIn(store, solutionId, path);
  const next = held.some((m) => m.line === line)
    ? held.filter((m) => m.line !== line)
    : [...held, { line, condition: "", log: "", hits: "" }].sort((a, b) => a.line - b.line);
  return write(store, solutionId, path, next);
}

/** Sets or clears what has to be true for one breakpoint to stop the program.
 *
 *  An empty condition is stored as empty rather than removing the breakpoint:
 *  clearing a condition means "stop every time", not "stop caring". */
export function setCondition(
  store: BreakpointStore,
  solutionId: number,
  path: string,
  line: number,
  condition: string,
): BreakpointStore {
  return amend(store, solutionId, path, line, (m) => ({ ...m, condition }));
}

/** Sets or clears the message one breakpoint prints instead of stopping.
 *
 *  Clearing it turns a log point back into an ordinary breakpoint rather than
 *  removing it — the mark in the gutter is the same mark either way. */
export function setLog(
  store: BreakpointStore,
  solutionId: number,
  path: string,
  line: number,
  log: string,
): BreakpointStore {
  return amend(store, solutionId, path, line, (m) => ({ ...m, log }));
}

/** Sets or clears how many hits one breakpoint waits for. */
export function setHits(
  store: BreakpointStore,
  solutionId: number,
  path: string,
  line: number,
  hits: string,
): BreakpointStore {
  return amend(store, solutionId, path, line, (m) => ({ ...m, hits }));
}

function amend(
  store: BreakpointStore,
  solutionId: number,
  path: string,
  line: number,
  change: (mark: Mark) => Mark,
): BreakpointStore {
  const held = marksIn(store, solutionId, path);
  // A change to a line with no breakpoint would be a setting on nothing.
  if (!held.some((m) => m.line === line)) return store;
  return write(
    store,
    solutionId,
    path,
    held.map((m) => (m.line === line ? change(m) : m)),
  );
}

function write(
  store: BreakpointStore,
  solutionId: number,
  path: string,
  marks: Mark[],
): BreakpointStore {
  const key = String(solutionId);
  const forSolution = { ...(store[key] ?? {}) };

  // An empty list is dropped rather than kept as `[]`. It matters more than it
  // looks: `setBreakpoints` replaces a file's whole set, so "this file, with
  // none" and "this file, not mentioned" are different messages to an adapter,
  // and only the first clears it.
  if (marks.length === 0) delete forSolution[path];
  else forSolution[path] = marks;

  const updated = { ...store, [key]: forSolution };
  if (Object.keys(forSolution).length === 0) delete updated[key];
  save(updated);
  return updated;
}

/** Everything for one Solution, as the absolute paths an adapter matches on.
 *
 *  Adapters compare source paths against what the compiler recorded, which is
 *  absolute — a repository-relative path silently matches nothing, and the
 *  program runs straight past the breakpoint. */
export function absoluteFor(
  store: BreakpointStore,
  solutionId: number,
  localPath: string,
): { path: string; line: number; condition: string; log: string; hits: string }[] {
  const root = localPath.replace(/[/\\]+$/, "");
  const files = store[String(solutionId)] ?? {};
  return Object.entries(files).flatMap(([path, marks]) =>
    marks.map((m) => ({
      path: `${root}/${path}`,
      line: m.line,
      condition: m.condition,
      log: m.log,
      hits: m.hits,
    })),
  );
}

/** The other direction: an adapter's absolute path back to one inside a working
 *  copy, or null when it is somewhere else entirely.
 *
 *  **Null is the interesting answer.** A stack frame in the Go runtime or in a
 *  dependency under `GOPATH` is a real frame at a real path, and it is simply
 *  not a file this Solution can open — saying so is the point, because silently
 *  opening the wrong file would be worse than opening none.
 *
 *  Separators are normalised and Windows is compared case-insensitively, since
 *  a compiler may record `C:\repos\Orders` for a folder the app stored as
 *  `C:/repos/orders` and neither spelling is wrong. */
export function relativeTo(root: string, absolute: string): string | null {
  const tidy = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = tidy(root);
  const full = tidy(absolute);
  if (base === "" || full === "") return null;

  // Windows paths are case-insensitive; POSIX ones are not, and folding there
  // would match two genuinely different files.
  const windows = /^[a-z]:\//i.test(base);
  const left = windows ? base.toLowerCase() : base;
  const right = windows ? full.toLowerCase() : full;

  if (!right.startsWith(`${left}/`)) return null;
  return full.slice(base.length + 1);
}
