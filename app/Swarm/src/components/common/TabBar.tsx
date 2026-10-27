import type { CSSProperties, ReactNode } from "react";
import { HIVES } from "@hives/registry";
import type { EnvironmentId, TabColors } from "../../lib/theme";

/** One place on the rail. */
export interface Environment {
  id: EnvironmentId;
  label: string;
  icon: ReactNode;
}

/** The chat is the app's main screen, and the one place everyone sees: it
 *  is where the app opens, and where the AI sets the rest of it up. */
export const CHAT: Environment = {
  id: "chat",
  label: "Chat",
  // A speech bubble.
  icon: (
    <path
      d="M4 4.5h12a1.5 1.5 0 011.5 1.5v6.5a1.5 1.5 0 01-1.5 1.5H9l-4 3v-3H4a1.5 1.5 0 01-1.5-1.5V6A1.5 1.5 0 014 4.5z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      fill="none"
    />
  ),
};

/** Admin is not a Hive: it is this app's settings screen, where Hives are
 *  granted, so it is added here rather than registered beside them. */
const ADMIN: Environment = {
  id: "admin",
  label: "Admin",
  // Sliders: settings.
  icon: (
    <>
      <path d="M3 6h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="6" r="2.4" fill="currentColor" />
      <circle cx="13" cy="14" r="2.4" fill="currentColor" />
    </>
  ),
};

/** The rail: the chat, every Hive in registry order, then Admin.
 *
 *  Each icon is inline SVG drawn rather than lettered — initials in boxes would
 *  read as a list of abbreviations — so nothing is fetched in an offline app,
 *  and the colour follows the button. */
export const ENVIRONMENTS: Environment[] = [
  CHAT,
  ...HIVES.map(({ id, label, icon }) => ({ id, label, icon })),
  ADMIN,
];

/** Each place's colour until the person picks another. */
export const DEFAULT_TAB_COLORS: TabColors = Object.fromEntries([
  [CHAT.id, "#0891b2"],
  ...HIVES.map((h) => [h.id, h.color]),
  [ADMIN.id, "#475569"],
]);

interface TabBarProps {
  active: EnvironmentId;
  colors: TabColors;
  onSelect: (id: EnvironmentId) => void;
  tabs?: Environment[];
}

/** The activity rail: the chat, the Hives and Admin, down the left.
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
      {tabs.map(({ id, label, icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={active === id}
          className={`tab${active === id ? " tab-active" : ""}`}
          style={{ "--tab-color": colors[id] } as CSSProperties}
          onClick={() => onSelect(id)}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            {icon}
          </svg>
          <span className="tab-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
