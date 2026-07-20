import { useState } from "react";
import PlanningScreen from "./PlanningScreen";
import RoadMap from "./RoadMap";
import ProductOverview from "./ProductOverview";
import MarketingDesign from "./MarketingDesign";
import { openScreenWindow, type Product } from "../lib/backend";
import { usePermissions } from "../lib/permissions";

export const WORKSPACE_SCREENS = [
  { id: "planning", label: "Planning" },
  { id: "roadmap", label: "RoadMap" },
  { id: "marketing", label: "Marketing" },
  { id: "design", label: "Design" },
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
  if (screen === "marketing" || screen === "design")
    return <MarketingDesign productId={productId} area={screen} />;
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

/** The Product workspace: one screen at a time behind a tab row, each still
 *  tear-out-able into its own OS window by dragging its handle — so side-by-side
 *  is a deliberate act (drag it out) rather than the crowded default it became
 *  once the three original panels grew to five.
 *
 *  Marketing and Design have their own role flags — a developer often needs
 *  Planning without campaign drafts — so those two tabs appear only for roles
 *  that hold them. */
export default function ProductWorkspace({ product, onBack }: ProductWorkspaceProps) {
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ScreenId>("planning");
  const { canAccess } = usePermissions();

  const visibleScreens = WORKSPACE_SCREENS.filter(({ id }) =>
    id === "marketing" || id === "design" ? canAccess(id) : true,
  );
  // A role change could hide the tab you were on; fall back to the first
  // visible one rather than showing a blank workspace. Planning is always
  // visible, so this always resolves.
  const current = visibleScreens.some((s) => s.id === active) ? active : visibleScreens[0].id;
  const currentLabel = WORKSPACE_SCREENS.find((s) => s.id === current)!.label;

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

      {/* aria-pressed buttons, not role="tab": the app shell's top TabBar is
          already the page's tablist, and a second one competing with it makes
          "the tabs" ambiguous to a screen reader. */}
      <nav className="workspace-tabs" aria-label="Product screens">
        {visibleScreens.map(({ id, label }) => (
          <button
            key={id}
            aria-pressed={current === id}
            className={current === id ? "workspace-tab-active" : ""}
            onClick={() => setActive(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="workspace-panel" aria-label={currentLabel}>
        <header className="panel-header">
          <h3>{currentLabel}</h3>
          <PopOutHandle label={currentLabel} onPopOut={() => popOut(current)} />
        </header>
        <WorkspaceScreen screen={current} productId={product.id} product={product} />
      </section>
    </div>
  );
}
