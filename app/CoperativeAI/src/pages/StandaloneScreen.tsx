import { useEffect, useState } from "react";
import { WorkspaceScreen, type ScreenId } from "../components/ProductWorkspace";
import { getProduct, type Product } from "../lib/backend";

interface StandaloneScreenProps {
  screen: ScreenId;
  productId: number;
}

/** What a pulled-out OS window shows: one workspace screen for one Product,
 *  with the Product's title at the top. */
export default function StandaloneScreen({ screen, productId }: StandaloneScreenProps) {
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProduct(productId).then(setProduct).catch((e) => setError(String(e)));
  }, [productId]);

  if (error) return <p role="alert">{error}</p>;
  if (!product) return <p>Loading…</p>;

  return (
    <div className="standalone-screen">
      <header className="workspace-header">
        <h2>{product.name}</h2>
        <span className="screen-name">{screen}</span>
      </header>
      <WorkspaceScreen screen={screen} productId={productId} product={product} />
    </div>
  );
}
