import { useCallback, useEffect, useState } from "react";
import StrategyEditor from "../components/StrategyEditor";
import TestCases from "../components/TestCases";
import { listProducts, TEST_STRATEGY_FIELDS, type Product } from "../lib/backend";

/** The Test environment: pick a Product to see its Testing Strategy and the
 *  test cases designed against its deliverables and work items. */
export default function TestArea() {
  const [products, setProducts] = useState<Product[]>([]);
  const [activeProduct, setActiveProduct] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const loaded = await listProducts();
      setProducts(loaded);
      setActiveProduct((cur) => (cur === "" && loaded.length > 0 ? loaded[0].id : cur));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="test-area">
      {error && <p role="alert">{error}</p>}

      {products.length === 0 ? (
        <p>No Products yet — create one in the Product tab to design tests against it.</p>
      ) : (
        <>
          <label className="develop-product-picker">
            Product
            <select
              aria-label="Test product"
              value={activeProduct}
              onChange={(e) => setActiveProduct(Number(e.target.value))}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          {activeProduct !== "" && (
            <>
              <StrategyEditor
                productId={Number(activeProduct)}
                area="test"
                title="Testing Strategy"
                fields={TEST_STRATEGY_FIELDS}
              />
              <TestCases productId={Number(activeProduct)} />
            </>
          )}
        </>
      )}
    </div>
  );
}
