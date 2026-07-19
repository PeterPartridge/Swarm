import { useCallback, useEffect, useState, type FormEvent } from "react";
import ProductWorkspace from "../components/ProductWorkspace";
import PlanningMethodSetting from "../components/PlanningMethodSetting";
import FolderField from "../components/FolderField";
import {
  createProduct,
  deleteProduct,
  listProducts,
  CREATE_PRODUCT_QUESTIONS,
  type Product,
} from "../lib/backend";

/** The Product environment's home: Products as cards, an "Add a Product"
 *  card asking the Project_brief's Product questions, and the planning
 *  settings. Opening a Product enters its workspace. */
export default function ProductPlanning() {
  const [products, setProducts] = useState<Product[]>([]);
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [scaffoldDir, setScaffoldDir] = useState("");

  const refresh = useCallback(async () => {
    try {
      setProducts(await listProducts());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const id = await createProduct(name, JSON.stringify(answers), scaffoldDir);
      const created = { id, name, answers: JSON.stringify(answers) };
      setName("");
      setAnswers({});
      setScaffoldDir("");
      setCreating(false);
      await refresh();
      // Creating a Product scaffolds its files behind the scenes and opens
      // straight into its three-panel workspace.
      setOpenProduct(created);
    } catch (err) {
      setError(String(err));
    }
  }

  async function onDelete(product: Product) {
    try {
      await deleteProduct(product.id);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  if (openProduct) {
    return (
      <ProductWorkspace product={openProduct} onBack={() => setOpenProduct(null)} />
    );
  }

  return (
    <div className="product-home">
      {error && <p role="alert">{error}</p>}
      <PlanningMethodSetting />

      <div className="product-cards">
        {products.map((product) => (
          <article key={product.id} className="product-card" aria-label={product.name}>
            <strong>{product.name}</strong>
            <button
              aria-label={`Open ${product.name}`}
              onClick={() => setOpenProduct(product)}
            >
              Open
            </button>
            <button
              aria-label={`Delete ${product.name}`}
              onClick={() => onDelete(product)}
            >
              Delete
            </button>
          </article>
        ))}

        {!creating ? (
          <article className="product-card add-card">
            <button aria-label="Add a Product" onClick={() => setCreating(true)}>
              + Add a Product
            </button>
          </article>
        ) : (
          <form
            className="product-card"
            onSubmit={onCreate}
            aria-label="New Product"
          >
            <label>
              Product name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            {/* Only the essentials — the rest of the brief is written in
                Strategy once the Product exists. */}
            {CREATE_PRODUCT_QUESTIONS.map((q) => (
              <label key={q.id}>
                {q.label}
                <textarea
                  value={answers[q.id] ?? ""}
                  onChange={(e) =>
                    setAnswers({ ...answers, [q.id]: e.target.value })
                  }
                />
              </label>
            ))}
            <FolderField
              label="Folder for the Product's files (scaffolded on create)"
              value={scaffoldDir}
              onChange={setScaffoldDir}
            />
            <button type="submit">Create Product</button>
            <button type="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
