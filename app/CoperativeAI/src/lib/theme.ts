import { useEffect, useState } from "react";

export type EnvironmentId = "product" | "develop" | "test" | "admin";

export type TabColors = Record<EnvironmentId, string>;

export const DEFAULT_TAB_COLORS: TabColors = {
  product: "#7c3aed",
  develop: "#2563eb",
  test: "#16a34a",
  admin: "#475569",
};

const STORAGE_KEY = "coperativeai.tabColors";

export function loadTabColors(): TabColors {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TAB_COLORS };
    const parsed = JSON.parse(raw) as Partial<TabColors>;
    return { ...DEFAULT_TAB_COLORS, ...parsed };
  } catch {
    return { ...DEFAULT_TAB_COLORS };
  }
}

export function saveTabColors(colors: TabColors): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
}

export function applyTabColors(colors: TabColors): void {
  const root = document.documentElement;
  root.style.setProperty("--tab-product", colors.product);
  root.style.setProperty("--tab-develop", colors.develop);
  root.style.setProperty("--tab-test", colors.test);
  root.style.setProperty("--tab-admin", colors.admin);
}

/** Light or dark surfaces. Dark is the default — this is an editor that sits
 *  beside VS Code and a terminal — but it is a preference, chosen in Admin. */
export type ThemeMode = "dark" | "light";

const THEME_KEY = "coperativeai.theme";

export function loadThemeMode(): ThemeMode {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // A machine that refuses localStorage still themes for this session; the
    // choice just does not survive a reload, which is a better failure than
    // throwing on a settings write.
  }
}

/** Stamps the choice on the root, where the CSS `:root[data-theme="light"]`
 *  overrides hang off it. Applied at startup and on every change. */
export function applyThemeMode(mode: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", mode);
}

/** The theme as it is now, and again whenever it changes.
 *
 *  **For the surfaces CSS cannot reach.** Every panel in this app is themed by
 *  variables hanging off `:root[data-theme]`, so nothing else needs to know
 *  which mode is on. The code editor is the exception: Monaco paints itself and
 *  takes a theme name, so it has to be told — and a white editor in a dark app
 *  is the one surface that glares.
 *
 *  Watches the attribute rather than the stored value, because the attribute is
 *  what the rest of the app already treats as the truth. */
export function useThemeMode(): ThemeMode {
  const read = (): ThemeMode =>
    document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const [mode, setMode] = useState<ThemeMode>(read);

  useEffect(() => {
    const watch = new MutationObserver(() => setMode(read()));
    watch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    // The attribute may have been stamped between the first read and this
    // subscription — a startup race that would leave one panel in the old mode.
    setMode(read());
    return () => watch.disconnect();
  }, []);

  return mode;
}
