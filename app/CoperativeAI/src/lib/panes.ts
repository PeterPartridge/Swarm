/** How wide or tall a pane the reader has sized, in pixels. */
export interface PaneSizes {
  /** The agent lane, on the left. */
  lane: number;
  /** The file tree, beside it. */
  tree: number;
  /** The whole Build view, top to bottom. */
  height: number;
}

/** What the panes are before anybody has moved them — the numbers the layout
 *  shipped with, so a first visit looks exactly as it always did. */
export const DEFAULT_PANES: PaneSizes = { lane: 280, tree: 216, height: 0 };

const KEY = "coperativeai.panes";

/** The sizes this machine last chose.
 *
 *  **Remembered because a divider you have to drag on every visit is a divider
 *  nobody drags twice.** Kept in `localStorage` rather than the database: it is
 *  a fact about this screen, not about the work, and a second machine with a
 *  different monitor should not inherit it.
 *
 *  Anything unreadable — no storage, a half-written value, a number somebody
 *  edited by hand — falls back to the defaults rather than throwing, because a
 *  layout preference must never be the reason a view fails to open. */
export function loadPanes(): PaneSizes {
  try {
    const held = localStorage.getItem(KEY);
    if (!held) return DEFAULT_PANES;
    const read = JSON.parse(held) as Partial<PaneSizes>;
    return {
      lane: sane(read.lane, DEFAULT_PANES.lane),
      tree: sane(read.tree, DEFAULT_PANES.tree),
      height: sane(read.height, DEFAULT_PANES.height),
    };
  } catch {
    return DEFAULT_PANES;
  }
}

export function savePanes(sizes: PaneSizes): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sizes));
  } catch {
    // A machine that refuses storage still resizes for this session; the choice
    // just does not survive a reload, which beats throwing on a settings write.
  }
}

/** A number, or the default. Guards against `null`, `NaN` and anything a hand
 *  edit left behind. */
function sane(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
