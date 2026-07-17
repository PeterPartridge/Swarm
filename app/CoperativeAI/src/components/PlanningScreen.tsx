import ProductStrategy from "./ProductStrategy";
import PlanningBoard from "./PlanningBoard";

/** The Planning screen of the Product workspace: the Strategy section
 *  (deliverables + structured strategy) above the hierarchy board. */
export default function PlanningScreen({ productId }: { productId: number }) {
  return (
    <div className="planning-screen">
      <ProductStrategy productId={productId} />
      <PlanningBoard productId={productId} />
    </div>
  );
}
