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
