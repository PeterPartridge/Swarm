import { describe, expect, it } from "vitest";
import { HIVES } from "../registry";

describe("the Hive registry", () => {
  /// The rail is drawn from this list in this order, so the order is the
  /// rail's order — the one the areas had before they were Hives.
  it("lists Product, Develop and Test, in that order", () => {
    expect(HIVES.map((h) => h.id)).toEqual(["product", "develop", "test"]);
    expect(HIVES.map((h) => h.label)).toEqual(["Product", "Develop", "Test"]);
  });

  /// A Hive's id is what its colour, its permission and the palette's way in
  /// are all keyed by, so two Hives sharing one would share all three.
  it("gives every Hive its own id, a screen and a colour", () => {
    expect(new Set(HIVES.map((h) => h.id)).size).toBe(HIVES.length);
    for (const hive of HIVES) {
      expect(hive.Screen, hive.id).toBeTypeOf("function");
      expect(hive.color, hive.id).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
