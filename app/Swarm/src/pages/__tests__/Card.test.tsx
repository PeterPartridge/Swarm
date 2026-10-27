import { render, screen, within } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import Card from "../../components/common/Card";

describe("the panel card", () => {
  /// **The answer on the right is what makes a column of these readable.**
  /// "3 files", "written", "not planned" — read down the asides and you know
  /// which card to open without reading a body.
  it("puts the card's own answer beside its title", () => {
    render(
      <Card title="Solutions affected" aside="none" tone="warn">
        <p>Nothing attached yet.</p>
      </Card>,
    );

    const head = screen.getByText("Solutions affected").parentElement;
    expect(head).not.toBeNull();
    expect(within(head as HTMLElement).getByText("none")).toHaveClass("warn");
  });

  /// A body that names itself needs no label above it — an inspector showing a
  /// file's own name does not want "File" written over it.
  it("leaves the head out entirely when there is no title", () => {
    const { container } = render(
      <Card>
        <strong>Greeting.cs</strong>
      </Card>,
    );
    expect(container.querySelector(".panel-card-head")).toBeNull();
    expect(screen.getByText("Greeting.cs")).toBeInTheDocument();
  });
});

/** Every `.tsx` under `src`. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("one card, not several", () => {
  /// **Two areas looked *almost* alike in a way nobody could name.** The ship
  /// rail wrote `.ship-card` and the Work area's briefing wrote
  /// `.briefing-block`: the same raised surface and border, differing by
  /// 0.05rem of padding and a pixel of radius. Nothing said no, because nothing
  /// was looking.
  ///
  /// This is what looks. A panel that wants a card uses the component; a new
  /// class named for one panel is how the divergence started last time.
  it("has no panel-specific card classes left", () => {
    const root = process.cwd();
    const offenders: string[] = [];
    for (const file of sourceFiles(join(root, "src"))) {
      // This file names them in order to forbid them.
      if (file.endsWith("Card.test.tsx")) continue;
      // Comments stripped: `Card.tsx` names both classes to explain why it
      // exists, and a doc comment is history, not a class on an element.
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const dead of ["ship-card", "briefing-block"]) {
        if (text.includes(dead)) offenders.push(`${file.replace(root, "")}: ${dead}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
