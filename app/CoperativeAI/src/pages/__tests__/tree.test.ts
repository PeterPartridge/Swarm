import { withChanges, ancestors } from "../../lib/tree";
import type { TreeEntry } from "../../lib/backend";

const entry = (path: string, isDir: boolean, depth: number): TreeEntry => ({
  path,
  name: path.split("/").pop() ?? path,
  isDir,
  depth,
});

describe("the file tree, with an agent's changes in it", () => {
  /// **The changed file the walk never saw.** The backend skips `bin` and `obj`
  /// — sensible, they are generated and enormous — and in a .NET project those
  /// are exactly where the changed files are. Shown as a flat list they had no
  /// context; skipped entirely they were invisible.
  it("puts a change under folders the walk skipped", () => {
    const rows = withChanges(
      [entry("Program.cs", false, 0)],
      ["bin/Debug/net8.0/app.dll", "Program.cs"],
    );

    expect(rows.map((r) => `${" ".repeat(r.depth)}${r.name}`)).toEqual([
      "bin",
      " Debug",
      "  net8.0",
      "   app.dll",
      "Program.cs",
    ]);
    // The made-up rows are folders, and the changed one is a file.
    expect(rows.find((r) => r.path === "bin")?.isDir).toBe(true);
    expect(rows.find((r) => r.path === "bin/Debug/net8.0/app.dll")?.isDir).toBe(false);
  });

  /// Folders before files, alphabetical within a folder, depth-first — the same
  /// order the backend walk uses, rebuilt rather than patched. New rows spliced
  /// into an existing order would leave a folder's contents scattered.
  it("orders folders first, then names, depth first", () => {
    const rows = withChanges(
      [
        entry("README.md", false, 0),
        entry("src", true, 0),
        entry("src/b.ts", false, 1),
        entry("src/a.ts", false, 1),
      ],
      [],
    );
    expect(rows.map((r) => r.path)).toEqual([
      "src",
      "src/a.ts",
      "src/b.ts",
      "README.md",
    ]);
  });

  /// A file already in the walk is not doubled by also being changed.
  it("does not repeat a file that is both walked and changed", () => {
    const rows = withChanges(
      [entry("src", true, 0), entry("src/main.ts", false, 1)],
      ["src/main.ts"],
    );
    expect(rows.filter((r) => r.path === "src/main.ts")).toHaveLength(1);
    expect(rows).toHaveLength(2);
  });

  /// Depth is recomputed, not carried: a row's indent has to match where it
  /// ends up, and merged rows have no depth of their own.
  it("recomputes depth from the path", () => {
    const rows = withChanges([], ["a/b/c/d.txt"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 3]);
  });

  /// Nothing changed is the walk, unchanged — the pane's ordinary state must
  /// not depend on the merge doing nothing subtly differently.
  it("leaves a tree with no changes alone", () => {
    const walked = [entry("src", true, 0), entry("src/main.ts", false, 1)];
    expect(withChanges(walked, []).map((r) => r.path)).toEqual(["src", "src/main.ts"]);
  });

  it("names every folder above a path, outermost first", () => {
    expect(ancestors("a/b/c.ts")).toEqual(["a", "a/b"]);
    expect(ancestors("top.ts")).toEqual([]);
  });
});
