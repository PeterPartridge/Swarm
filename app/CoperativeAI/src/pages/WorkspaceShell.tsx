import { useEffect, useMemo, useState, type CSSProperties } from "react";
import TabBar, { ENVIRONMENTS } from "../components/common/TabBar";
import CommandPalette, { type PaletteGroup } from "../components/common/CommandPalette";
import ProductPlanning from "./ProductPlanning";
import DevelopSolutions from "./DevelopSolutions";
import TestArea from "./TestArea";
import AdminArea from "./AdminArea";
import ActiveUserPicker from "../components/common/ActiveUserPicker";
import NotificationsBell from "../components/common/NotificationsBell";
import { usePermissions, type Area } from "../lib/permissions";
import {
  applyTabColors,
  applyThemeMode,
  loadTabColors,
  loadThemeMode,
  saveTabColors,
  saveThemeMode,
  type EnvironmentId,
  type TabColors,
} from "../lib/theme";

const ENVIRONMENT_PLACEHOLDERS: Record<EnvironmentId, string> = {
  product: "Plan products: work items, feature designs, and specifications.",
  develop: "Build developments: repositories, code editor, terminal, and AI.",
  test: "Design QA tests around work items for the AI to implement.",
  admin: "Manage team members, roles, and what each role can see.",
};

export default function WorkspaceShell() {
  const [active, setActive] = useState<EnvironmentId>("product");
  const [colors, setColors] = useState<TabColors>(() => loadTabColors());
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** The Develop tab the palette asked for, bumped so asking for the same tab
   *  twice still moves. Null means "leave Develop where it was". */
  const [developView, setDevelopView] = useState<{ id: string; at: number } | null>(null);
  const { canAccess } = usePermissions();

  useEffect(() => {
    applyTabColors(colors);
  }, [colors]);

  // The saved light/dark choice, stamped on the root before anything is read,
  // so the app opens in the theme that was chosen rather than flashing dark.
  useEffect(() => {
    applyThemeMode(loadThemeMode());
  }, []);

  // ⌘K anywhere opens the palette, Esc closes it — the shortcut every editor
  // this sits beside already uses, so it needs no learning.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visibleTabs = ENVIRONMENTS.filter((e) => canAccess(e.id as Area));

  // If the active user's role hides the current tab, fall back to the first
  // one they can see.
  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.some((t) => t.id === active)) {
      setActive(visibleTabs[0].id);
    }
  }, [visibleTabs, active]);

  function updateColor(id: EnvironmentId, value: string) {
    const next = { ...colors, [id]: value };
    setColors(next);
    saveTabColors(next);
  }

  const activeLabel = ENVIRONMENTS.find((e) => e.id === active)!.label;

  /** What the palette can reach. Built from the areas this user can actually
   *  see — offering a destination their role hides would be a dead end — and
   *  from Develop's real tabs, so every entry lands somewhere. */
  const paletteGroups: PaletteGroup[] = useMemo(() => {
    const goToArea = (id: EnvironmentId) => () => setActive(id);
    const goToDevelop = (view: string) => () => {
      setActive("develop");
      setDevelopView({ id: view, at: Date.now() });
    };
    const areas: PaletteGroup = {
      name: "Go to",
      items: visibleTabs.map((t, i) => ({
        glyph: t.label.charAt(0),
        label: t.label,
        hint: `⌘${i + 1}`,
        run: goToArea(t.id),
      })),
    };
    const develop: PaletteGroup = {
      name: "Develop",
      items: canAccess("develop" as Area)
        ? [
            // The palette's Develop entries are the Develop tabs, and nothing
            // else: an entry for Tests or Git would now be a destination that
            // no longer exists, which is the one thing a palette must never be.
            { glyph: "⛨", label: "Rules", hint: "", run: goToDevelop("strategy") },
            { glyph: "☰", label: "Work", hint: "", run: goToDevelop("work") },
            { glyph: "‹›", label: "Build", hint: "", run: goToDevelop("agents") },
            { glyph: "◫", label: "Map", hint: "", run: goToDevelop("architecture") },
          ]
        : [],
    };
    // Actions rather than destinations — what `>` narrows to. Kept to things
    // the shell can genuinely do from here; a command that only pretends to
    // work is worse than one that is missing.
    const commands: PaletteGroup = {
      name: "Commands",
      commands: true,
      items: [
        {
          glyph: "◐",
          label: "Switch to dark theme",
          hint: "",
          run: () => {
            saveThemeMode("dark");
            applyThemeMode("dark");
          },
        },
        {
          glyph: "◑",
          label: "Switch to light theme",
          hint: "",
          run: () => {
            saveThemeMode("light");
            applyThemeMode("light");
          },
        },
      ],
    };
    return [areas, develop, commands].filter((g) => g.items.length > 0);
  }, [visibleTabs, canAccess]);

  return (
    <div className="workspace-shell">
      {/* The rail is a sibling of the whole main column now, not a bar above
          it — so the areas stay put while the content beside them changes. */}
      <TabBar active={active} colors={colors} onSelect={setActive} tabs={visibleTabs} />
      <div className="shell-main">
      <div className="shell-topbar">
        {/* The search box is the palette's visible door: people who never learn
            the shortcut still find it, and it teaches ⌘K by showing it. */}
        <button className="palette-trigger" onClick={() => setPaletteOpen(true)}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="4.3" />
            <line x1="10.3" y1="10.3" x2="14" y2="14" />
          </svg>
          <span className="palette-trigger-text">Search or run…</span>
          <span className="palette-trigger-key">⌘K</span>
        </button>
        <NotificationsBell />
        <ActiveUserPicker />
      </div>

      <CommandPalette
        open={paletteOpen}
        groups={paletteGroups}
        onClose={() => setPaletteOpen(false)}
      />
      <main
        className="environment"
        role="tabpanel"
        aria-label={`${activeLabel} environment`}
        style={{ "--env-color": colors[active] } as CSSProperties}
      >
        <h1>{activeLabel}</h1>
        {active === "product" ? (
          <ProductPlanning />
        ) : active === "develop" ? (
          <DevelopSolutions requestedView={developView} />
        ) : active === "test" ? (
          <TestArea />
        ) : active === "admin" ? (
          <AdminArea />
        ) : (
          <p>{ENVIRONMENT_PLACEHOLDERS[active]}</p>
        )}
      </main>
      <footer className="colour-settings" aria-label="Colour settings">
        {ENVIRONMENTS.map(({ id, label }) => (
          <label key={id}>
            {label} colour
            <input
              type="color"
              value={colors[id]}
              onChange={(e) => updateColor(id, e.target.value)}
            />
          </label>
        ))}
      </footer>
      </div>
    </div>
  );
}
