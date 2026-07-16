import { useEffect, useState, type CSSProperties } from "react";
import TabBar, { ENVIRONMENTS } from "../components/TabBar";
import ProductPlanning from "./ProductPlanning";
import {
  applyTabColors,
  loadTabColors,
  saveTabColors,
  type EnvironmentId,
  type TabColors,
} from "../lib/theme";

const ENVIRONMENT_PLACEHOLDERS: Record<EnvironmentId, string> = {
  product: "Plan products: work items, feature designs, and specifications.",
  develop: "Build developments: repositories, code editor, terminal, and AI.",
  test: "Design QA tests around work items for the AI to implement.",
};

export default function WorkspaceShell() {
  const [active, setActive] = useState<EnvironmentId>("product");
  const [colors, setColors] = useState<TabColors>(() => loadTabColors());

  useEffect(() => {
    applyTabColors(colors);
  }, [colors]);

  function updateColor(id: EnvironmentId, value: string) {
    const next = { ...colors, [id]: value };
    setColors(next);
    saveTabColors(next);
  }

  const activeLabel = ENVIRONMENTS.find((e) => e.id === active)!.label;

  return (
    <div className="workspace-shell">
      <TabBar active={active} colors={colors} onSelect={setActive} />
      <main
        className="environment"
        role="tabpanel"
        aria-label={`${activeLabel} environment`}
        style={{ "--env-color": colors[active] } as CSSProperties}
      >
        <h1>{activeLabel}</h1>
        {active === "product" ? (
          <ProductPlanning />
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
  );
}
