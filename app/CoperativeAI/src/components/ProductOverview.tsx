import { useEffect, useState } from "react";
import { getProductScaffold, PRODUCT_QUESTIONS, type Product } from "../lib/backend";

interface ProductOverviewProps {
  product: Product;
}

/** The workspace's Overview panel: the Product's brief answers and where
 *  its scaffolded framework files live on disk. */
export default function ProductOverview({ product }: ProductOverviewProps) {
  const [scaffoldPath, setScaffoldPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProductScaffold(product.name)
      .then(setScaffoldPath)
      .catch((e) => setError(String(e)));
  }, [product.name]);

  let answers: Record<string, string> = {};
  try {
    answers = JSON.parse(product.answers) as Record<string, string>;
  } catch {
    // an unreadable answers blob just renders as empty answers
  }

  return (
    <div className="product-overview">
      {error && <p role="alert">{error}</p>}
      <section aria-label="Scaffolded files">
        <h3>Files</h3>
        {scaffoldPath ? (
          <p>
            Scaffolded at <code>{scaffoldPath}</code> — the Project brief was
            generated from the answers below; developers complete Part 2 there.
          </p>
        ) : (
          <p>No folder was chosen when this Product was created, so no files were scaffolded.</p>
        )}
      </section>
      <section aria-label="Brief answers">
        <h3>Brief</h3>
        <dl>
          {PRODUCT_QUESTIONS.map((q) => (
            <div key={q.id}>
              <dt>{q.label}</dt>
              <dd>{answers[q.id]?.trim() || "—"}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
