import { beforeEach, describe, expect, it } from "vitest";
import {
  addWatch,
  loadWatches,
  removeWatch,
  watchesIn,
} from "../../lib/watches";

/// Watches are one person's questions about shared code, so they live on this
/// machine — the same rule as breakpoints and the map's layout.
describe("watches", () => {
  beforeEach(() => localStorage.clear());

  it("keeps expressions per Solution, in the order they were added", () => {
    let store = addWatch({}, 1, "subtotal + tax");
    store = addWatch(store, 1, "len(items)");
    store = addWatch(store, 2, "order.Region");

    // Insertion order, not sorted: sorting would move a watch away from where
    // somebody was just looking.
    expect(watchesIn(store, 1)).toEqual(["subtotal + tax", "len(items)"]);
    expect(watchesIn(store, 2)).toEqual(["order.Region"]);
  });

  /// A duplicate would be two rows that always agree, and a second request per
  /// stop for an answer already on screen.
  it("will not add the same expression twice", () => {
    let store = addWatch({}, 1, "total");
    store = addWatch(store, 1, "total");
    expect(watchesIn(store, 1)).toEqual(["total"]);
  });

  it("ignores a blank expression, and trims the rest", () => {
    let store = addWatch({}, 1, "   ");
    expect(watchesIn(store, 1)).toEqual([]);
    store = addWatch(store, 1, "  total  ");
    expect(watchesIn(store, 1)).toEqual(["total"]);
  });

  it("takes one away, and leaves the others", () => {
    let store = addWatch({}, 1, "a");
    store = addWatch(store, 1, "b");
    store = removeWatch(store, 1, "a");
    expect(watchesIn(store, 1)).toEqual(["b"]);
  });

  it("survives a reload, because it is stored per machine", () => {
    addWatch({}, 7, "len(items)");
    expect(watchesIn(loadWatches(), 7)).toEqual(["len(items)"]);
  });
});
