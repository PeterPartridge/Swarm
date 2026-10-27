import type { Hive } from "../types";
import DevelopSolutions from "./DevelopSolutions";

const develop: Hive = {
  id: "develop",
  label: "Develop",
  color: "#2563eb",
  // Angle brackets: code.
  icon: (
    <path
      d="M7 5L3 10l4 5M13 5l4 5-4 5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  Screen: DevelopSolutions,
  // The palette's Develop entries are the Develop tabs, and nothing else: an
  // entry for Tests or Git would now be a destination that no longer exists.
  views: [
    { glyph: "⛨", label: "Rules", id: "strategy" },
    { glyph: "☰", label: "Work", id: "work" },
    { glyph: "‹›", label: "Build", id: "agents" },
    { glyph: "◫", label: "Map", id: "architecture" },
  ],
};

export default develop;
