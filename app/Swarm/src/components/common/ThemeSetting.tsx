import { useState } from "react";
import {
  applyThemeMode,
  loadThemeMode,
  saveThemeMode,
  type ThemeMode,
} from "../../lib/theme";

/** Light or dark, for the whole app.
 *
 *  A display preference, not a Product setting, so it lives on this machine
 *  (localStorage) rather than in the shared database — two people on one repo
 *  can each read in the surface they prefer. The choice takes effect the moment
 *  it is made: the whole app is expressed in theme variables, so flipping the
 *  root's `data-theme` moves every surface at once. */
export default function ThemeSetting() {
  const [mode, setMode] = useState<ThemeMode>(() => loadThemeMode());

  function choose(next: ThemeMode) {
    setMode(next);
    saveThemeMode(next);
    applyThemeMode(next);
  }

  return (
    <section className="admin-card" aria-label="Theme">
      <h2>Theme</h2>
      <div role="radiogroup" aria-label="Colour theme" className="theme-choice">
        <label>
          <input
            type="radio"
            name="theme"
            checked={mode === "dark"}
            onChange={() => choose("dark")}
          />{" "}
          Dark
        </label>
        <label>
          <input
            type="radio"
            name="theme"
            checked={mode === "light"}
            onChange={() => choose("light")}
          />{" "}
          Light
        </label>
      </div>
      <p className="hint">
        Dark by default — this sits beside an editor and a terminal. The choice is
        remembered on this machine and takes effect at once.
      </p>
    </section>
  );
}
