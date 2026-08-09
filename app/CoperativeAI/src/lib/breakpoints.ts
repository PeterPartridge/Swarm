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

/** Every breakpoint on this machine: `solutionId → path → lines`. */
export type BreakpointStore = Record<string, Record<string, number[]>>;

export function loadBreakpoints(): BreakpointStore {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BreakpointStore) : {};
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

/** The lines marked in one file. */
export function linesIn(
  store: BreakpointStore,
  solutionId: number,
  path: string,
): number[] {
  return store[String(solutionId)]?.[path] ?? [];
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
  const key = String(solutionId);
  const forSolution = { ...(store[key] ?? {}) };
  const held = forSolution[path] ?? [];
  const next = held.includes(line)
    ? held.filter((l) => l !== line)
    : [...held, line].sort((a, b) => a - b);

  // An empty list is dropped rather than kept as `[]`. It matters more than it
  // looks: `setBreakpoints` replaces a file's whole set, so "this file, with
  // none" and "this file, not mentioned" are different messages to an adapter,
  // and only the first clears it.
  if (next.length === 0) delete forSolution[path];
  else forSolution[path] = next;

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
): { path: string; line: number }[] {
  const root = localPath.replace(/[/\\]+$/, "");
  const files = store[String(solutionId)] ?? {};
  return Object.entries(files).flatMap(([path, lines]) =>
    lines.map((line) => ({ path: `${root}/${path}`, line })),
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
