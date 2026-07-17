import { useState } from "react";
import PlanningScreen from "./PlanningScreen";
import RoadMap from "./RoadMap";
import ProductOverview from "./ProductOverview";
import { openScreenWindow, type Product } from "../lib/backend";

export const WORKSPACE_SCREENS = [
  { id: "planning", label: "Planning" },
  { id: "roadmap", label: "RoadMap" },
  { id: "overview", label: "Overview" },
] as const;

export type ScreenId = (typeof WORKSPACE_SCREENS)[number]["id"];

interface ProductWorkspaceProps {
  product: Product;
  onBack: () => void;
}

export function WorkspaceScreen({
  screen,
  productId,
  product,
}: {
  screen: ScreenId;
  productId: number;
  product?: Product;
}) {
  if (screen === "planning") return <PlanningScreen productId={productId} />;
  if (screen === "roadmap") return <RoadMap productId={productId} />;
  return product ? <ProductOverview product={product} /> : null;
}

/** A drag handle: grab and drag it to tear the panel out into its own OS
 *  window — a real drag gesture, not a button. The browser only fires a drag
 *  on actual dragging, so a plain click never pops out. */
function PopOutHandle({ label, onPopOut }: { label: string; onPopOut: () => void }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`panel-drag${dragging ? " panel-drag-active" : ""}`}
      role="button"
      aria-label={`Drag to pop out ${label}`}
      title="Drag out to open in its own window"
      draggable
      onDragStart={(e) => {
        // Some drag surfaces require data to be set to start a drag.
        e.dataTransfer?.setData("text/plain", label);
        setDragging(true);
      }}
      onDragEnd={() => {
        setDragging(false);
        onPopOut();
      }}
    >
      ⠿ {dragging ? "release to pop out" : label}
    </div>
  );
}

/** The Product workspace: all three panels showing at once, each pulled out
 *  into its own OS window by dragging its handle. */
export default function ProductWorkspace({ product, onBack }: ProductWorkspaceProps) {
  const [error, setError] = useState<string | null>(null);

  async function popOut(screen: ScreenId) {
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
      </header>
      {error && <p role="alert">{error}</p>}
      <div className="workspace-panels">
        {WORKSPACE_SCREENS.map(({ id, label }) => (
          <section key={id} className="workspace-panel" aria-label={label}>
            <header className="panel-header">
              <h3>{label}</h3>
              <PopOutHandle label={label} onPopOut={() => popOut(id)} />
            </header>
            <WorkspaceScreen screen={id} productId={product.id} product={product} />
          </section>
        ))}
      </div>
    </div>
  );
}
