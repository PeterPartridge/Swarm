import type { CSSProperties, ReactNode } from "react";
import type { EnvironmentId, TabColors } from "../lib/theme";

export const ENVIRONMENTS: { id: EnvironmentId; label: string }[] = [
  { id: "product", label: "Product" },
  { id: "develop", label: "Develop" },
  { id: "test", label: "Test" },
  { id: "admin", label: "Admin" },
];

/** One glyph per area, drawn rather than lettered.
 *
 *  An icon rail needs icons; four initials in boxes would read as a list of
 *  abbreviations. Each is inline SVG so nothing is fetched — this is an offline
 *  desktop app — and the colour follows the button. */
const ICONS: Record<EnvironmentId, ReactNode> = {
  // Four panes: a Product is the thing made of parts.
  product: (
    <>
      <rect x="2" y="2" width="7" height="7" rx="1.5" fill="currentColor" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.3" />
    </>
  ),
  // Angle brackets: code.
  develop: (
    <path
      d="M7 5L3 10l4 5M13 5l4 5-4 5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  // A tick: a test that passed.
  test: (
    <path
      d="M4 10.5l4 4 8-9"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  // Sliders: settings.
  admin: (
    <>
      <path d="M3 6h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="6" r="2.4" fill="currentColor" />
      <circle cx="13" cy="14" r="2.4" fill="currentColor" />
    </>
  ),
};

interface TabBarProps {
  active: EnvironmentId;
  colors: TabColors;
  onSelect: (id: EnvironmentId) => void;
  tabs?: { id: EnvironmentId; label: string }[];
}

/** The activity rail: the four areas, down the left.
 *
 *  Icons with the label beneath, rather than a row of text tabs across the top.
 *  The rail is a fixed width whatever the window does, so the areas stay put as
 *  the content beside them changes — which is the point of moving them out of
 *  the flow.
 *
 *  Still `role="tablist"` with the same labels. This is a repaint of the same
 *  navigation, not a new one, so everything that finds these by name keeps
 *  working. */
export default function TabBar({ active, colors, onSelect, tabs = ENVIRONMENTS }: TabBarProps) {
  return (
    <nav className="tab-bar" role="tablist" aria-label="Workspace environments">
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          role="tab"
          aria-selected={active === id}
          className={`tab${active === id ? " tab-active" : ""}`}
          style={{ "--tab-color": colors[id] } as CSSProperties}
          onClick={() => onSelect(id)}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            {ICONS[id]}
          </svg>
          <span className="tab-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
