import { useCallback, useEffect, useState, type FormEvent } from "react";
import AiSettings from "../components/AiSettings";
import CodeEditor from "../components/CodeEditor";
import DeveloperPlanning from "../components/DeveloperPlanning";
import DeveloperRulesEditor from "../components/DeveloperRulesEditor";
import FrameworkFiles from "../components/FrameworkFiles";
import GithubCard from "../components/GithubCard";
import ModelInstalls from "../components/ModelInstalls";
import SolutionBox from "../components/SolutionBox";
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

/** Which slice of the Develop area is showing. Ten sections in one scrolling
 *  column had stopped being a page, so they are grouped by what a developer is
 *  doing: thinking (Planning), executing (Work), writing code (Workspace), or
 *  wiring things up (Settings). */
type DevelopView = "planning" | "work" | "workspace" | "code" | "settings";

const DEVELOP_TABS: { id: DevelopView; label: string }[] = [
  { id: "planning", label: "Planning" },
  { id: "work", label: "Work" },
  { id: "workspace", label: "Workspace" },
  { id: "code", label: "Code" },
  { id: "settings", label: "Settings" },
];

/** The Develop environment: pick a Product, then work in one of four tabs —
 *  Planning (strategy, rules, architecture), Work (board/sprint/list),
 *  Workspace (solutions, editor, review), Settings (GitHub, models, AI). */
export default function DevelopSolutions() {
  const [products, setProducts] = useState<Product[]>([]);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [activeProduct, setActiveProduct] = useState<number | "">("");
  const [view, setView] = useState<DevelopView>("planning");
  /** Which Solution the Code tab is editing — set by "Open" on the Workspace
   *  tab, so the two tabs are one flow rather than two disconnected screens. */
  const [openSolution, setOpenSolution] = useState<Solution | null>(null);
  const [githubConnected, setGithubConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [solutionName, setSolutionName] = useState("");
  const [solutionProduct, setSolutionProduct] = useState<number | "">("");
  const [solutionType, setSolutionType] = useState<string>("application");
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const [loadedProducts, loadedSolutions, github] = await Promise.all([
        listProducts(),
        listSolutions(),
        githubStatus(),
      ]);
      setProducts(loadedProducts);
      setSolutions(loadedSolutions);
      setGithubConnected(github.connected);
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
      )}

      {/* Plain buttons, not role="tab" — WorkItemViews already owns real
          Board/Sprint/List tabs inside the Work section, and two tablists on
          one page would make "the tabs" ambiguous to a screen reader. */}
      <nav className="develop-tabs" aria-label="Develop sections">
        {DEVELOP_TABS.map((t) => (
          <button
            key={t.id}
            aria-pressed={view === t.id}
            className={view === t.id ? "develop-tab-active" : ""}
            onClick={() => setView(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {view === "planning" && activeProduct !== "" && (
        <>
          <StrategyEditor
            productId={Number(activeProduct)}
            area="develop"
            title="Technical Strategy"
            fields={DEVELOP_STRATEGY_FIELDS}
          />
          {/* Read-only here — these are set in Admin. Two editors for one
              set of rules would drift, and the drift would be invisible
              until the AI obeyed the wrong copy. */}
          <DeveloperRulesEditor productId={Number(activeProduct)} readOnly />
          <DeveloperPlanning productId={Number(activeProduct)} />
        </>
      )}

      {view === "work" && activeProduct !== "" && (
        <WorkItemViews productId={Number(activeProduct)} />
      )}

      {/* A plain function call, not a <Component> — an inner component gets a
          new identity every render, and React would remount the whole subtree
          on each keystroke, dropping the editor's open file and input focus. */}
      {view === "workspace" && workspaceSection()}

      {view === "code" &&
        (openSolution ? (
          <CodeEditor solution={openSolution} />
        ) : (
          <p className="hint">
            No Solution open. Pick one on the Workspace tab and press Open.
          </p>
        ))}

      {view === "settings" && (
        <>
          <GithubCard onChange={refresh} />
          <ModelInstalls productId={activeProduct === "" ? null : Number(activeProduct)} />
          <AiSettings />
        </>
      )}
    </div>
  );

  /** Solutions and the code around them: create, link to GitHub, open the
   *  working copy, and the framework files the handover feeds on. */
  function workspaceSection() {
    return (
      <>
      {activeProduct !== "" && <FrameworkFiles productId={Number(activeProduct)} />}
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
        <ul className="solution-list">
          {solutions.map((s) => (
            <li key={s.id}>
              <strong>{s.name}</strong> ({s.solutionType}) — {productName(s.productId)}{" "}
              <button
                aria-label={`Delete solution ${s.name}`}
                onClick={() => run(() => deleteSolution(s.id))}
              >
                Delete
              </button>
              <SolutionRepo
                solution={s}
                githubConnected={githubConnected}
                onChange={refresh}
              />
              <SolutionBox
                solution={s}
                onPathChanged={refresh}
                onOpenInEditor={(sol) => {
                  setOpenSolution(sol);
                  setView("code");
                }}
              />
            </li>
          ))}
        </ul>
      </section>
      </>
    );
  }
}
