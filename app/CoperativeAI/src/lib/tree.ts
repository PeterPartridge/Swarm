import type { TreeEntry } from "./backend";

/** Every folder above a path, outermost first: `a/b/c.ts` → `a`, `a/b`. */
export function ancestors(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** The walked tree, with changed files put back where they belong.
 *
 *  **A changed file the walk never saw.** The backend skips the folders nobody
 *  wants to browse — `bin`, `obj`, `node_modules`, `.git` — and stops at six
 *  levels deep, both for good reasons: a monorepo would otherwise serialise
 *  tens of thousands of paths into a panel. But a file that has *changed* is
 *  worth seeing wherever it lives, and in a .NET project the changed files are
 *  very often exactly the ones under `bin/` and `obj/`.
 *
 *  So the changed paths are merged in, with the folders they sit in created as
 *  they are needed. `bin/Debug/net8.0/app.dll` arrives as `bin` → `Debug` →
 *  `net8.0` → `app.dll`, nested where it really is, rather than as a flat line
 *  in a list of changes or as nothing at all. The rest of `bin` stays unwalked,
 *  which is the point of skipping it.
 *
 *  Ordering is rebuilt rather than patched: folders before files, alphabetical
 *  within a folder, depth-first — the order a person expects, and the same rule
 *  the backend walk uses. Patching new rows into an existing order would leave
 *  a folder's contents scattered around it. */
export function withChanges(entries: TreeEntry[], changedPaths: string[]): TreeEntry[] {
  const folders = new Set<string>();
  const files = new Set<string>();

  for (const entry of entries) {
    (entry.isDir ? folders : files).add(entry.path);
    for (const above of ancestors(entry.path)) folders.add(above);
  }
  for (const path of changedPaths) {
    if (path.trim() === "") continue;
    files.add(path);
    for (const above of ancestors(path)) folders.add(above);
  }
  // A path cannot be both. The walk is the authority on which is which, and a
  // change list only ever names files.
  for (const file of files) folders.delete(file);

  const childrenOf = new Map<string, { path: string; isDir: boolean }[]>();
  const add = (path: string, isDir: boolean) => {
    const parent = ancestors(path).pop() ?? "";
    const siblings = childrenOf.get(parent) ?? [];
    siblings.push({ path, isDir });
    childrenOf.set(parent, siblings);
  };
  for (const folder of folders) add(folder, true);
  for (const file of files) add(file, false);

  const name = (path: string) => path.split("/").pop() ?? path;
  const out: TreeEntry[] = [];
  const walk = (parent: string, depth: number) => {
    const children = (childrenOf.get(parent) ?? []).sort(
      (a, b) =>
        Number(b.isDir) - Number(a.isDir) ||
        name(a.path).localeCompare(name(b.path)),
    );
    for (const child of children) {
      out.push({ path: child.path, name: name(child.path), isDir: child.isDir, depth });
      if (child.isDir) walk(child.path, depth + 1);
    }
  };
  walk("", 0);
  return out;
}
