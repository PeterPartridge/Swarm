/** The `hidden` attribute versus the stylesheet.
 *
 *  **A pane that would not hide.** The Build view switches between the code
 *  editor and the agent's work item with the `hidden` attribute, mounted rather
 *  than unmounted so a half-typed edit and a running dev server both survive
 *  the switch. It looked right in the code and was wrong on screen: the code
 *  pane sat permanently on top of the work item, whichever tab was chosen.
 *
 *  `hidden` is a *user-agent* style — `[hidden] { display: none }` at the
 *  bottom of the cascade — so any author rule that sets `display` on the same
 *  element wins. `.build-code { display: flex }` is such a rule, and the
 *  attribute did nothing from the moment that class got a layout.
 *
 *  jsdom applies no stylesheet, so no rendering test can catch this: every
 *  assertion about a hidden pane passes while the app shows both. What can be
 *  checked is the rule that makes the attribute mean what it says, so this
 *  reads the stylesheet and the components as text. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("hiding a pane", () => {
  // Comments stripped first: this file explains the rule in prose, and prose
  // about a rule is not a rule — the first draft of this test matched its own
  // documentation and reported a fix that was not there.
  const css = readFileSync(join(root, "src/styles.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  /// **The one rule that makes the attribute mean what it says.** Without it,
  /// `hidden` works only on elements nothing has styled — which is to say, it
  /// works until somebody gives the pane a layout, and then it silently stops.
  /// `!important` rather than specificity: the point is that no class can beat
  /// it, and any rule that could would be the same bug again.
  it("keeps a stylesheet rule that beats any class's display", () => {
    const rule = css.match(/\[hidden\]\s*\{[^}]*\}/)?.[0];
    expect(rule, "styles.css must have a [hidden] rule").toBeDefined();
    expect(rule).toMatch(/display:\s*none\s*!important/);
  });

  /// Every element that carries both a class and `hidden` is one of these
  /// panes. Listing them is not the point — noticing a new one is: each is an
  /// element whose visibility depends on a rule three thousand lines away in
  /// another file, which is worth knowing about.
  it("finds the panes that depend on that rule", () => {
    const withBoth = sourceFiles(join(root, "src"))
      .flatMap((file) => readFileSync(file, "utf8").split("\n"))
      .filter((line) => /className=/.test(line) && /\bhidden=/.test(line));

    // Not an exact count — panes come and go. What matters is that when one
    // exists, the rule above exists too, which the first test pins.
    expect(withBoth.length).toBeGreaterThan(0);
  });
});
