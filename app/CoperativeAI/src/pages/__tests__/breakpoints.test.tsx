import { beforeEach, describe, expect, it } from "vitest";
import {
  absoluteFor,
  linesIn,
  loadBreakpoints,
  toggleBreakpoint,
} from "../../lib/breakpoints";

describe("breakpoints", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /// Two Solutions can each hold a `src/main.go`, and a breakpoint in one is not
  /// a breakpoint in the other.
  it("keeps a file's lines apart per Solution", () => {
    let store = toggleBreakpoint({}, 1, "src/main.go", 8);
    store = toggleBreakpoint(store, 2, "src/main.go", 20);

    expect(linesIn(store, 1, "src/main.go")).toEqual([8]);
    expect(linesIn(store, 2, "src/main.go")).toEqual([20]);
  });

  it("toggles a line off again, and keeps them in order", () => {
    let store = toggleBreakpoint({}, 1, "a.go", 12);
    store = toggleBreakpoint(store, 1, "a.go", 3);
    expect(linesIn(store, 1, "a.go")).toEqual([3, 12]);

    store = toggleBreakpoint(store, 1, "a.go", 3);
    expect(linesIn(store, 1, "a.go")).toEqual([12]);
  });

  /// **The one that matters to the adapter.** `setBreakpoints` replaces a
  /// file's whole set, so a file left as `[]` and a file not mentioned are
  /// different messages — and the empty entry has to go, or the last removal
  /// would be sent as "this file, unchanged".
  it("drops a file entirely once its last line is removed", () => {
    let store = toggleBreakpoint({}, 1, "a.go", 5);
    store = toggleBreakpoint(store, 1, "a.go", 5);

    expect(linesIn(store, 1, "a.go")).toEqual([]);
    expect(JSON.stringify(store)).not.toContain("a.go");
  });

  /// Adapters match against the path the compiler recorded, which is absolute.
  /// A repository-relative path silently matches nothing and the program runs
  /// straight past the breakpoint.
  it("hands the adapter absolute paths", () => {
    const store = toggleBreakpoint({}, 1, "src/main.go", 8);
    expect(absoluteFor(store, 1, "C:/repos/shop")).toEqual([
      { path: "C:/repos/shop/src/main.go", line: 8 },
    ]);
    // A trailing separator on the working copy must not double up.
    expect(absoluteFor(store, 1, "C:/repos/shop/")).toEqual([
      { path: "C:/repos/shop/src/main.go", line: 8 },
    ]);
  });

  it("survives a reload, because it is stored per machine", () => {
    toggleBreakpoint({}, 7, "cmd/main.go", 42);
    expect(linesIn(loadBreakpoints(), 7, "cmd/main.go")).toEqual([42]);
  });
});
