/** One numbered step, and any rules written underneath it. */
export interface SchemaStep {
  text: string;
  rules: string[];
}

/** A schema, in the shape it was written in rather than as one line. */
export type SchemaBlock =
  | { kind: "text"; text: string }
  | { kind: "steps"; lead: string; items: SchemaStep[] }
  | { kind: "rules"; lead: string; items: string[] };

/** Splits a line where a marker appears at least twice.
 *
 *  Twice, not once: a single `1)` is a sentence that happens to contain a
 *  bracket, and one `-` is a hyphen. Two or more is somebody making a list.
 */
function splitOn(line: string, marker: RegExp): { lead: string; items: string[] } | null {
  const parts = line.split(marker);
  if (parts.length < 3) return null;
  return { lead: parts[0].trim(), items: parts.slice(1).map((p) => p.trim()).filter(Boolean) };
}

/** `1)` or `1.` — a numbered step, at the start of a line or after a space. */
const NUMBERED = /(?:^|\s)\d+[).]\s+/;
/** A dash with a space after it, and either the start of the line or a space
 *  before it — so `->` and `hyphens/apostrophes` are left alone, and a line
 *  that opens with a bullet is still a list. */
const DASHED = /(?:^|\s)[-•]\s+/;

/** Reads a schema back into the structure it describes.
 *
 *  **A wall of text is what an AI writes and a `<pre>` preserves.** A generated
 *  page schema arrives as one long line — "Console prompt: 1) Output … 2) On
 *  valid input … Validation rules: - Empty input → … - Special characters → …"
 *  — with all of its structure inside it as punctuation. Shown as it stands, in
 *  a block that does not wrap, it is a paragraph nobody reads to the end of.
 *
 *  The structure is there; this puts it back. Numbered markers make steps,
 *  dashes make rules, and a step that carries its own rules keeps them. Nothing
 *  is invented and nothing is dropped: text that has no markers is text, and
 *  the reader can still see exactly what was written.
 *
 *  **One level of nesting, deliberately.** Steps with rules under them is what
 *  these schemas actually contain; a general markdown parser would be a lot of
 *  machinery for a shape that has not appeared. */
export function readSchema(text: string): SchemaBlock[] {
  const out: SchemaBlock[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;

    const numbered = splitOn(line, NUMBERED);
    if (numbered) {
      out.push({
        kind: "steps",
        lead: numbered.lead,
        items: numbered.items.map((item) => {
          const rules = splitOn(item, DASHED);
          return rules
            ? { text: rules.lead, rules: rules.items }
            : { text: item, rules: [] };
        }),
      });
      continue;
    }

    const dashed = splitOn(line, DASHED);
    if (dashed) {
      out.push({ kind: "rules", lead: dashed.lead, items: dashed.items });
      continue;
    }

    out.push({ kind: "text", text: line });
  }
  return out;
}
