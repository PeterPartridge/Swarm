/** The expressions somebody wants to keep an eye on.
 *
 *  **Per machine, in localStorage**, by the same rule as breakpoints: a watch
 *  is one person's way of looking at shared code, not a fact about it. Two
 *  developers debugging the same Solution are asking different questions, and
 *  neither is more true.
 *
 *  Kept per Solution rather than per file, because a watch is about the running
 *  program rather than about a line — `len(items)` is worth watching across
 *  every file the program passes through. */

const KEY = "coperativeai.watches";

/** Every watch on this machine: `solutionId → expressions`. */
export type WatchStore = Record<string, string[]>;

export function loadWatches(): WatchStore {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as WatchStore) : {};
  } catch {
    // A machine that refuses localStorage still debugs for this session.
    return {};
  }
}

function save(store: WatchStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Same: this session still works.
  }
}

/** The expressions kept for one Solution, in the order they were added. */
export function watchesIn(store: WatchStore, solutionId: number): string[] {
  return store[String(solutionId)] ?? [];
}

/** Adds an expression, unless it is blank or already there.
 *
 *  Returns a new store rather than mutating: it is React state, and a mutated
 *  object would not re-render the list showing it.
 *
 *  **Order is insertion order, deliberately.** Sorting would move a watch you
 *  just added away from where you were looking, and the order somebody adds
 *  things in is usually the order they are thinking about them. */
export function addWatch(
  store: WatchStore,
  solutionId: number,
  expression: string,
): WatchStore {
  const wanted = expression.trim();
  const held = watchesIn(store, solutionId);
  // A duplicate would be two rows that always agree — noise, and a second
  // request per stop for an answer already on screen.
  if (wanted === "" || held.includes(wanted)) return store;
  return write(store, solutionId, [...held, wanted]);
}

/** Takes an expression away. */
export function removeWatch(
  store: WatchStore,
  solutionId: number,
  expression: string,
): WatchStore {
  const held = watchesIn(store, solutionId);
  if (!held.includes(expression)) return store;
  return write(
    store,
    solutionId,
    held.filter((e) => e !== expression),
  );
}

function write(store: WatchStore, solutionId: number, expressions: string[]): WatchStore {
  const key = String(solutionId);
  const updated = { ...store };
  if (expressions.length === 0) delete updated[key];
  else updated[key] = expressions;
  save(updated);
  return updated;
}
