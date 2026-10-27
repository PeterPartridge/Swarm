import type { Hive } from "../types";
import ProductPlanning from "./ProductPlanning";

const product: Hive = {
  id: "product",
  label: "Product",
  color: "#7c3aed",
  // Four panes: a Product is the thing made of parts.
  icon: (
    <>
      <rect x="2" y="2" width="7" height="7" rx="1.5" fill="currentColor" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.3" />
    </>
  ),
  Screen: ProductPlanning,
};

export default product;
