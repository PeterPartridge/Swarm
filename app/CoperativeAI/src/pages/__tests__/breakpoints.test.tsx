import { beforeEach, describe, expect, it } from "vitest";
import {
  absoluteFor,
  linesIn,
  loadBreakpoints,
  marksIn,
  relativeTo,
  setCondition,
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
      { path: "C:/repos/shop/src/main.go", line: 8, condition: "" },
    ]);
    // A trailing separator on the working copy must not double up.
    expect(absoluteFor(store, 1, "C:/repos/shop/")).toEqual([
      { path: "C:/repos/shop/src/main.go", line: 8, condition: "" },
    ]);
  });

  /// **A condition rides with the breakpoint it belongs to**, because the
  /// adapter is told both in one message.
  it("carries a condition through to the adapter", () => {
    let store = toggleBreakpoint({}, 1, "src/main.go", 8);
    store = setCondition(store, 1, "src/main.go", 8, "i == 7");
    expect(absoluteFor(store, 1, "C:/repos/shop")).toEqual([
      { path: "C:/repos/shop/src/main.go", line: 8, condition: "i == 7" },
    ]);
  });

  /// Clearing a condition means "stop every time", not "stop caring" — the
  /// breakpoint stays.
  it("keeps the breakpoint when its condition is cleared", () => {
    let store = toggleBreakpoint({}, 1, "src/main.go", 8);
    store = setCondition(store, 1, "src/main.go", 8, "i == 7");
    store = setCondition(store, 1, "src/main.go", 8, "");
    expect(marksIn(store, 1, "src/main.go")).toEqual([{ line: 8, condition: "" }]);
  });

  /// A condition on a line with no breakpoint would be a condition on nothing.
  it("will not condition a line that has no breakpoint", () => {
    const store = toggleBreakpoint({}, 1, "src/main.go", 8);
    expect(setCondition(store, 1, "src/main.go", 99, "x > 1")).toBe(store);
  });

  /// **Breakpoints stored before conditions existed still load.** They were a
  /// bare list of line numbers, and somebody's marks are not worth losing over
  /// a shape change.
  it("reads breakpoints stored in the old shape", () => {
    localStorage.setItem(
      "coperativeai.breakpoints",
      JSON.stringify({ "3": { "cmd/main.go": [4, 9] } }),
    );
    expect(marksIn(loadBreakpoints(), 3, "cmd/main.go")).toEqual([
      { line: 4, condition: "" },
      { line: 9, condition: "" },
    ]);
  });

  it("survives a reload, because it is stored per machine", () => {
    toggleBreakpoint({}, 7, "cmd/main.go", 42);
    expect(linesIn(loadBreakpoints(), 7, "cmd/main.go")).toEqual([42]);
  });
});

/// The other direction: an adapter reports where it stopped as an absolute
/// path, and the editor works in repository-relative ones.
describe("relativeTo", () => {
  it("brings an absolute path back inside the working copy", () => {
    expect(relativeTo("C:/repos/orders", "C:/repos/orders/main.go")).toBe("main.go");
    expect(relativeTo("C:/repos/orders", "C:/repos/orders/cmd/api/main.go")).toBe(
      "cmd/api/main.go",
    );
  });

  /// A compiler records the path with whatever separators and capitalisation it
  /// saw, and neither spelling is wrong.
  it("does not care about separators, or about case on Windows", () => {
    expect(relativeTo("C:/repos/orders", "C:\\repos\\orders\\main.go")).toBe("main.go");
    expect(relativeTo("C:/repos/Orders", "c:/repos/orders/main.go")).toBe("main.go");
    expect(relativeTo("C:/repos/orders/", "C:/repos/orders/main.go")).toBe("main.go");
  });

  /// **Null is the interesting answer.** A frame in the Go runtime or in a
  /// dependency is a real frame at a real path that this Solution cannot open,
  /// and opening the wrong file would be worse than opening none.
  it("says nothing rather than guessing when the file is somewhere else", () => {
    expect(relativeTo("C:/repos/orders", "C:/go/src/runtime/proc.go")).toBeNull();
    expect(relativeTo("C:/repos/orders", "")).toBeNull();
    expect(relativeTo("", "C:/repos/orders/main.go")).toBeNull();
    // A sibling whose name merely starts the same is not inside it.
    expect(relativeTo("C:/repos/orders", "C:/repos/orders-api/main.go")).toBeNull();
  });

  /// Case folding is a Windows rule. Doing it on a POSIX path would match two
  /// genuinely different files.
  it("keeps POSIX paths case-sensitive", () => {
    expect(relativeTo("/home/dev/orders", "/home/dev/orders/main.go")).toBe("main.go");
    expect(relativeTo("/home/dev/Orders", "/home/dev/orders/main.go")).toBeNull();
  });
});
