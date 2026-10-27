import { useState } from "react";
import { handOverProduct, type Product, type ProductArea } from "../../lib/backend";

/** Send to Product: a Project started in Develop or Test stays there until
 *  somebody presses this, and then joins the Product area marked with where it
 *  came from.
 *
 *  **Offered only by the area that made it, and only until it is sent.** Every
 *  area still lists every Product; this is the one place a Project changes
 *  hands, so it sits with the people it belongs to. */
export default function SendToProduct({
  product,
  area,
  onSent,
}: {
  product: Product;
  area: Exclude<ProductArea, "product">;
  /** Called once the hand-over is saved, so the area can reload. */
  onSent: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  if (product.origin !== area || product.inProductArea) return null;

  async function send() {
    try {
      await handOverProduct(product.id);
      setError(null);
      onSent();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <span className="send-to-product">
      <button type="button" onClick={send}>
        Send to Product
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
