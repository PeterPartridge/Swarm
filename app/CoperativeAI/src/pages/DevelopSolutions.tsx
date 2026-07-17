import { useCallback, useEffect, useState, type FormEvent } from "react";
import AiSettings from "../components/AiSettings";
import GithubCard from "../components/GithubCard";
import SolutionRepo from "../components/SolutionRepo";
import StrategyEditor from "../components/StrategyEditor";
import WorkItemViews from "../components/WorkItemViews";
import {
  createSolution,
  deleteSolution,
  githubStatus,
  listProducts,
  listSolutions,
  DEVELOP_STRATEGY_FIELDS,
  SOLUTION_QUESTIONS,
  SOLUTION_TYPES,
  type Product,
  type Solution,
} from "../lib/backend";

/** The Develop environment: pick a Product to see its Technical Strategy and
 *  Board/Sprint/List views, then create Solutions and configure AI. */
export default function DevelopSolutions() {
  const [products, setProducts] = useState<Product[]>([]);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [activeProduct, setActiveProduct] = useState<number | "">("");
  const [githubConnected, setGithubConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [solutionName, setSolutionName] = useState("");
  const [solutionProduct, setSolutionProduct] = useState<number | "">("");
  const [solutionType, setSolutionType] = useState<string>("application");
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const [loadedProducts, loadedSolutions] = await Promise.all([
        listProducts(),
        listSolutions(),
      ]);
      setProducts(loadedProducts);
      setSolutions(loadedSolutions);
      const firstId = loadedProducts.length > 0 ? loadedProducts[0].id : "";
      setActiveProduct((cur) => (cur === "" ? firstId : cur));
      setSolutionProduct((cur) => (cur === "" ? firstId : cur));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function onCreateSolution(e: FormEvent) {
    e.preventDefault();
    if (!solutionName.trim() || solutionProduct === "") return;
    await run(() =>
      createSolution({
        name: solutionName,
        productId: Number(solutionProduct),
        solutionType,
        answers: JSON.stringify(answers),
      }),
    );
    setSolutionName("");
    setAnswers({});
  }

  const productName = (id: number) =>
    products.find((p) => p.id === id)?.name ?? `Product ${id}`;

  return (
    <div className="develop-area">
      {error && <p role="alert">{error}</p>}

      {products.length === 0 ? (
        <p>No Products yet — create one in the Product tab to develop against it.</p>
      ) : (
        <>
          <label className="develop-product-picker">
            Product
            <select
              aria-label="Develop product"
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
                area="develop"
                title="Technical Strategy"
                fields={DEVELOP_STRATEGY_FIELDS}
              />
              <WorkItemViews productId={Number(activeProduct)} />
            </>
          )}
        </>
      )}

      <section className="develop-card" aria-label="Create a Solution">
        <h2>Create a Solution</h2>
        {products.length === 0 ? (
          <p>Solutions link to a Product — create a Product first (Product tab).</p>
        ) : (
          <form onSubmit={onCreateSolution} aria-label="New Solution">
            <input
              aria-label="Solution name"
              placeholder="Solution name"
              value={solutionName}
              onChange={(e) => setSolutionName(e.target.value)}
            />
            <select
              aria-label="Product"
              value={solutionProduct}
              onChange={(e) => setSolutionProduct(Number(e.target.value))}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Solution type"
              value={solutionType}
              onChange={(e) => setSolutionType(e.target.value)}
            >
              {SOLUTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {SOLUTION_QUESTIONS.map((q) => (
              <label key={q.id}>
                {q.label}
                <textarea
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                />
              </label>
            ))}
            <button type="submit">Create Solution</button>
          </form>
        )}
        <ul>
          {solutions.map((s) => (
            <li key={s.id}>
              <strong>{s.name}</strong> ({s.solutionType}) — {productName(s.productId)}{" "}
              <button
                aria-label={`Delete solution ${s.name}`}
                onClick={() => run(() => deleteSolution(s.id))}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>

      <AiSettings />
    </div>
  );
}
