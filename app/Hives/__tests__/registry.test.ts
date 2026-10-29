import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HIVES } from "../registry";

describe("the Hive registry", () => {
  /// The rail is drawn from this list in this order, so the order is the
  /// rail's order — the one the areas had before they were Hives.
  it("lists Product, Develop and Test, in that order", () => {
    expect(HIVES.map((h) => h.id)).toEqual(["product", "develop", "test"]);
    expect(HIVES.map((h) => h.label)).toEqual(["Product", "Develop", "Test"]);
  });

  /// The repository's `swarm-extensions.json` is what Swarm builds in as the
  /// list of what it contains, so its Hives must be exactly these. A Hive
  /// missing there could never be installed; one listed there without a
  /// folder here would install nothing. (Vitest runs from app/Swarm.)
  it("is exactly the Hives the repository's swarm-extensions.json lists", () => {
    const file = JSON.parse(readFileSync(`${process.cwd()}/../../swarm-extensions.json`, "utf8")) as {
      extensions: { kind: string; id: string; name: string }[];
    };
    const listed = file.extensions.filter((e) => e.kind === "hive");
    expect(listed.map((e) => e.id)).toEqual(HIVES.map((h) => h.id));
    expect(listed.map((e) => e.name)).toEqual(HIVES.map((h) => h.label));
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
