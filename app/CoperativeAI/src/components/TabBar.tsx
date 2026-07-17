import type { CSSProperties } from "react";
import type { EnvironmentId, TabColors } from "../lib/theme";

export const ENVIRONMENTS: { id: EnvironmentId; label: string }[] = [
  { id: "product", label: "Product" },
  { id: "develop", label: "Develop" },
  { id: "test", label: "Test" },
  { id: "admin", label: "Admin" },
];

interface TabBarProps {
  active: EnvironmentId;
  colors: TabColors;
  onSelect: (id: EnvironmentId) => void;
  tabs?: { id: EnvironmentId; label: string }[];
}

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
          {label}
        </button>
      ))}
    </nav>
  );
}
