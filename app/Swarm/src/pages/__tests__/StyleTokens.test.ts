/** Colours that were never defined, in rules that therefore did nothing.
 *
 *  **A rule with an undefined variable is silently skipped.** `background:
 *  var(--surface-2)` where nothing defines `--surface-2` is not an error, not a
 *  warning, and not a background — the declaration is dropped and the element
 *  renders as if the line had never been written. The chat between Develop and
 *  Product was styled as bubbles for months and rendered as plain paragraphs
 *  for exactly this reason: `--surface-2` and `--border` did not exist.
 *
 *  Two names for one colour is the cause. The palette is `--raised`, `--sunken`,
 *  `--line`; somebody wrote the names another design system uses and nothing
 *  said no.
 *
 *  Tokens a component sets inline — `--agent-hue` on a lane card, `--tab-color`
 *  on a tab — are defined at the element and cannot be found here, so they are
 *  named. Anything else must exist in the stylesheet. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Set by components through `style={{ "--x": … }}`, not by the stylesheet. */
const SET_INLINE = ["--agent-hue", "--tab-color", "--ring-pct", "--env-color"];

describe("the stylesheet's colour tokens", () => {
  const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

  it("defines every token it uses without a fallback", () => {
    const defined = new Set(
      [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]),
    );
    const missing = new Set<string>();
    for (const use of css.matchAll(/var\((--[a-z0-9-]+)\s*(,)?/gi)) {
      const [, name, fallback] = use;
      // A fallback is a deliberate default, not a mistake.
      if (fallback) continue;
      if (defined.has(name)) continue;
      if (SET_INLINE.includes(name)) continue;
      missing.add(name);
    }

    expect([...missing]).toEqual([]);
  });
});

/** **Styling a shared component means styling what it renders.**
 *
 *  The ship rail used to hand-roll its own tab strip, so its stylesheet spoke
 *  about `.ship-tab` and `.ship-tab.on` — classes the rail itself wrote. Moving
 *  the strip onto `SectionTabs` changed the markup to `button` and
 *  `.view-active` and left those two rules matching nothing at all. The strip
 *  would have gone on rendering, unstyled, with no error anywhere: dead CSS is
 *  as quiet as an undefined token.
 *
 *  So a `className` handed to a shared component may only decorate that
 *  component's own markup. */
describe("styles for shared components", () => {
  const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  it("styles the rail's tab strip through what SectionTabs renders", () => {
    expect(css).toContain(".section-tabs.ship-tabs button");
    expect(css).toContain(".section-tabs.ship-tabs .view-active");
    // The classes the rail used to write for itself.
    expect(css).not.toMatch(/\.ship-tab[\s.,{]/);
  });
});
