import { readSchema } from "../../lib/schema";

/// The real one, from the hello world item's plan — one line, every bit of its
/// structure inside it as punctuation.
const REAL =
  'Console prompt (not a web page): 1) Output: "Please enter your name" and read a ' +
  'single line of input. 2) On valid input, output: "Hi <name>". Validation rules: ' +
  '- Empty/whitespace-only input -> output error "No name entered", do not print a ' +
  "greeting. - Input containing special characters (anything other than letters, " +
  'spaces, and hyphens/apostrophes) -> output error "Invalid name" (special ' +
  'characters not allowed), do not print a greeting. - Valid input (e.g. "Dave") -> ' +
  'output "Hi Dave".';

describe("reading a schema back into its shape", () => {
  /// **The wall of text, taken apart.** This is what a generated page schema
  /// actually looks like, and it was shown exactly as it stands in a block that
  /// does not wrap.
  it("finds the steps and the rules underneath one of them", () => {
    const blocks = readSchema(REAL);
    expect(blocks).toHaveLength(1);
    const steps = blocks[0];
    if (steps.kind !== "steps") throw new Error(`expected steps, got ${steps.kind}`);

    expect(steps.lead).toBe("Console prompt (not a web page):");
    expect(steps.items).toHaveLength(2);
    expect(steps.items[0].text).toMatch(/Please enter your name/);
    expect(steps.items[0].rules).toEqual([]);

    // The second step carries the validation rules, and keeps them.
    expect(steps.items[1].text).toMatch(/Validation rules:$/);
    expect(steps.items[1].rules).toHaveLength(3);
    expect(steps.items[1].rules[0]).toMatch(/No name entered/);
    expect(steps.items[1].rules[2]).toMatch(/Hi Dave/);
  });

  /// **An arrow is not a bullet.** `->` and `hyphens/apostrophes` are both in
  /// that text, and splitting on either would cut a rule in half.
  it("leaves arrows and hyphenated words alone", () => {
    const blocks = readSchema("- a -> b - c/d-e -> f");
    const rules = blocks[0];
    if (rules.kind !== "rules") throw new Error("expected rules");
    expect(rules.items).toEqual(["a -> b", "c/d-e -> f"]);
  });

  /// One marker is punctuation; two is somebody making a list. A sentence with
  /// a bracket in it must not become a one-item list.
  it("does not split on a single marker", () => {
    expect(readSchema("Step 1) do the thing")).toEqual([
      { kind: "text", text: "Step 1) do the thing" },
    ]);
    expect(readSchema("well-formed - mostly")).toEqual([
      { kind: "text", text: "well-formed - mostly" },
    ]);
  });

  /// Text that was already written as lines keeps them, and blank lines go.
  it("keeps ordinary prose as prose", () => {
    expect(readSchema("One line.\n\nAnother line.")).toEqual([
      { kind: "text", text: "One line." },
      { kind: "text", text: "Another line." },
    ]);
  });

  it("has nothing to say about nothing", () => {
    expect(readSchema("")).toEqual([]);
    expect(readSchema("   \n  ")).toEqual([]);
  });
});
