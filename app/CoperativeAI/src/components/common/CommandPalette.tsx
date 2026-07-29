import { useEffect, useMemo, useRef, useState } from "react";

/** One thing the palette can do. */
export interface PaletteItem {
  /** The little square glyph in front of the label. */
  glyph: string;
  label: string;
  /** The shortcut or verb shown on the right — "⌘1", "run". Blank is fine. */
  hint: string;
  run: () => void;
}

export interface PaletteGroup {
  name: string;
  items: PaletteItem[];
}

/** Go anywhere, run anything, from the keyboard.
 *
 *  ⌘K (Ctrl+K) opens it, typing filters, ↑↓ moves, ⏎ runs, Esc closes — the
 *  shape from the redesign, and the one every editor this sits beside already
 *  uses, so it needs no learning.
 *
 *  **Every entry does something real.** A palette listing destinations that do
 *  not exist teaches people not to trust it, so the entries are built by the
 *  shell from the areas and tabs it can actually reach.
 *
 *  Filtering matches the group name as well as the label, so "test" finds both
 *  the Test area and a command that mentions tests. */
export default function CommandPalette({
  open,
  groups,
  onClose,
}: {
  open: boolean;
  groups: PaletteGroup[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);

  // Opening is always a fresh start: a palette that reopens holding the last
  // search makes the first keystroke destructive.
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      input.current?.focus();
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) =>
            i.label.toLowerCase().includes(q) || g.name.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);

  /// Flattened, because ↑↓ crosses group boundaries — the groups are headings,
  /// not separate lists.
  const flat = useMemo(() => filtered.flatMap((g) => g.items), [filtered]);

  useEffect(() => {
    if (cursor >= flat.length) setCursor(0);
  }, [flat.length, cursor]);

  if (!open) return null;

  function choose(item: PaletteItem) {
    onClose();
    item.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (flat.length === 0 ? 0 : (c + 1) % flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (flat.length === 0 ? 0 : (c - 1 + flat.length) % flat.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[cursor];
      if (item) choose(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  let index = -1;

  return (
    // The scrim closes on click, the way every dialog like this does.
    <div className="palette-scrim" onClick={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="palette-search">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="4.3" />
            <line x1="10.3" y1="10.3" x2="14" y2="14" />
          </svg>
          <input
            ref={input}
            aria-label="Search or run"
            placeholder="Search or run…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
          />
          <button className="palette-esc" onClick={onClose}>
            esc
          </button>
        </div>

        <div className="palette-results">
          {flat.length === 0 && <p className="hint palette-empty">Nothing matches that.</p>}
          {filtered.map((group) => (
            <div key={group.name} className="palette-group">
              <div className="palette-group-name">{group.name}</div>
              {group.items.map((item) => {
                index += 1;
                const selected = index === cursor;
                const at = index;
                return (
                  <button
                    key={`${group.name}-${item.label}`}
                    className={`palette-item${selected ? " palette-item-active" : ""}`}
                    // aria-selected tells a screen reader which row ⏎ will run,
                    // which the highlight only says visually.
                    aria-selected={selected}
                    onMouseEnter={() => setCursor(at)}
                    onClick={() => choose(item)}
                  >
                    <span className="palette-glyph" aria-hidden="true">
                      {item.glyph}
                    </span>
                    <span className="palette-label">{item.label}</span>
                    {item.hint && <span className="palette-hint">{item.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="palette-foot">
          <span>↑↓ navigate</span>
          <span>⏎ select</span>
        </div>
      </div>
    </div>
  );
}
