import { useState } from "react";
import PlanningBoard from "./PlanningBoard";
import RoadMap from "./RoadMap";
import { openScreenWindow, type Product } from "../lib/backend";

export const WORKSPACE_SCREENS = [
  { id: "planning", label: "Planning" },
  { id: "roadmap", label: "RoadMap" },
] as const;

export type ScreenId = (typeof WORKSPACE_SCREENS)[number]["id"];

interface ProductWorkspaceProps {
  product: Product;
  onBack: () => void;
}

export function WorkspaceScreen({
  screen,
  productId,
}: {
  screen: ScreenId;
  productId: number;
}) {
  return screen === "planning" ? (
    <PlanningBoard productId={productId} />
  ) : (
    <RoadMap productId={productId} />
  );
}

export default function ProductWorkspace({ product, onBack }: ProductWorkspaceProps) {
  const [screen, setScreen] = useState<ScreenId>("planning");
  const [error, setError] = useState<string | null>(null);

  async function popOut() {
    try {
      await openScreenWindow(screen, product.id, product.name);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="product-workspace">
      <header className="workspace-header">
        <button aria-label="Back to Products" onClick={onBack}>
          ← Products
        </button>
        <h2>{product.name}</h2>
        <nav aria-label="Workspace screens">
          {WORKSPACE_SCREENS.map(({ id, label }) => (
            <button
              key={id}
              aria-pressed={screen === id}
              className={screen === id ? "screen-active" : ""}
              onClick={() => setScreen(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button aria-label="Open in its own window" onClick={popOut}>
          ⧉ Pop out
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      <WorkspaceScreen screen={screen} productId={product.id} />
    </div>
  );
}
