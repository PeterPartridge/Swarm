import PlanningBoard from "./PlanningBoard";
import SprintManager from "./SprintManager";

/** The Planning screen: the execution side of the workspace. The hierarchy
 *  board (create and schedule work items) and sprint management (create and
 *  list sprints). Strategy moved to its own tab — planning is what you do
 *  once the strategy exists, not part of setting it. */
export default function PlanningScreen({ productId }: { productId: number }) {
  return (
    <div className="planning-screen">
      <SprintManager productId={productId} />
      <PlanningBoard productId={productId} />
    </div>
  );
}
