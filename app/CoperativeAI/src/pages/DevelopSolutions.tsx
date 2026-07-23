import { useCallback, useEffect, useState, type FormEvent } from "react";
import AiSettings from "../components/AiSettings";
import CodeEditor from "../components/CodeEditor";
import DeveloperPlanning from "../components/DeveloperPlanning";
import DeveloperRulesEditor from "../components/DeveloperRulesEditor";
import FrameworkFiles from "../components/FrameworkFiles";
import GitExplorer from "../components/GitExplorer";
import InfrastructureDiagrams from "../components/InfrastructureDiagrams";
import GithubCard from "../components/GithubCard";
import ModelInstalls from "../components/ModelInstalls";
import SolutionBox from "../components/SolutionBox";
import SolutionRepo from "../components/SolutionRepo";
import SshCard from "../components/SshCard";
import StrategyEditor from "../components/StrategyEditor";
import TestExplorer from "../components/TestExplorer";
import WorkItemViews from "../components/WorkItemViews";
import {
  createSolutionWithStarter,
  deleteSolution,
  githubStatus,
  listProducts,
  listSolutions,
  listStarters,
  startExistingSolution,
  pickFolder,
  DEVELOP_STRATEGY_FIELDS,
  SOLUTION_QUESTIONS,
  SOLUTION_TYPES,
  type Product,
  type Solution,
  type Starter,
  type StarterRun,
} from "../lib/backend";

/** Which slice of the Develop area is showing. Ten sections in one scrolling
 *  column had stopped being a page, so they are grouped by what a developer is
 *  doing: thinking (Planning), executing (Work), writing code (Workspace), or
 *  wiring things up (Settings). */
type DevelopView =
  | "strategy"
  | "work"
  | "architecture"
  | "code"
  | "tests"
  | "git"
  | "settings";

const DEVELOP_TABS: { id: DevelopView; label: string }[] = [
  { id: "strategy", label: "Strategy and Rules" },
  { id: "work", label: "Work" },
  { id: "architecture", label: "Planning and Architecture" },
  { id: "code", label: "Code" },
  { id: "tests", label: "Tests" },
  { id: "git", label: "Git" },
  { id: "settings", label: "Settings" },
];

/** The Develop environment: pick a Product, then work in one of four tabs —
 *  Planning (strategy, rules, architecture), Work (board/sprint/list),
 *  Workspace (solutions, editor, review), Settings (GitHub, models, AI). */
export default function DevelopSolutions() {
  const [products, setProducts] = useState<Product[]>([]);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [activeProduct, setActiveProduct] = useState<number | "">("");
  const [view, setView] = useState<DevelopView>("strategy");
  /** Which Solution the Code tab is editing — set by "Open" on the Workspace
   *  tab, so the two tabs are one flow rather than two disconnected screens. */
  const [openSolution, setOpenSolution] = useState<Solution | null>(null);
  const [githubConnected, setGithubConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [solutionName, setSolutionName] = useState("");
  const [solutionProduct, setSolutionProduct] = useState<number | "">("");
  const [solutionType, setSolutionType] = useState<string>("application");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [starters, setStarters] = useState<Starter[]>([]);
  const [starterId, setStarterId] = useState("");
  /// The command is editable before it runs, so the button press is the
  /// confirmation — nothing is run that could not be read first.
  const [starterCommand, setStarterCommand] = useState("");
  /// The name for "something else" — recorded as the Solution's language, so a
  /// year later it says "Elixir" rather than "custom".
  const [customLanguage, setCustomLanguage] = useState("");
  const [starterParent, setStarterParent] = useState("");
  const [starterRun, setStarterRun] = useState<StarterRun | null>(null);
  /// Kept so a failed starter can be retried against the Solution that was
  /// created anyway — the decision is worth more than the folder.
  const [lastCreatedId, setLastCreatedId] = useState<number | null>(null);

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

  useEffect(() => {
    void (async () => {
      try {
        setStarters(await listStarters());
      } catch {
        // Starters are an offer, not a requirement: a Solution can still be
        // created without one, so a failure here must not block the form.
      }
    })();
  }, []);

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
    setStarterRun(null);
    // The picked language is the answer to the language question, so it is
    // stored with the other answers rather than only as a starter id — the
    // brief that reaches the AI reads "Rust (cargo)", not "rust".
    const languageAnswer =
      starterId === "custom"
        ? customLanguage.trim()
        : (starters.find((s) => s.id === starterId)?.label ?? "");
    try {
      const created = await createSolutionWithStarter({
        name: solutionName,
        productId: Number(solutionProduct),
        solutionType,
        answers: JSON.stringify({ ...answers, language: languageAnswer }),
        starterId: starterId || null,
        command: starterCommand || null,
        parentDir: starterParent || null,
        languageName: starterId === "custom" ? customLanguage.trim() : null,
      });
      // Kept whether it worked or not: when a generator fails, its own words
      // are the only thing that says which toolchain is missing.
      setStarterRun(created.started);
      setLastCreatedId(created.solutionId);
      setError(null);
      setSolutionName("");
      setAnswers({});
      setSolutions(await listSolutions());
    } catch (e) {
      setError(String(e));
    }
  }

  function onStarterChange(id: string) {
    setStarterId(id);
    setStarterCommand(starters.find((s) => s.id === id)?.command ?? "");
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

      {view === "strategy" && activeProduct !== "" && (
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
        </>
      )}

      {view === "work" && activeProduct !== "" && (
        <WorkItemViews productId={Number(activeProduct)} />
      )}

      {/* A plain function call, not a <Component> — an inner component gets a
          new identity every render, and React would remount the whole subtree
          on each keystroke, dropping the editor's open file and input focus. */}
      {view === "architecture" && workspaceSection()}

      {/* The explorer can hold several of this Product's Solutions at once —
          a change spanning an API and the app in front of it is one job. */}
      {view === "code" && (
        <CodeEditor
          solutions={
            activeProduct === ""
              ? []
              : solutions.filter((s) => s.productId === Number(activeProduct))
          }
          opened={openSolution}
        />
      )}

      {view === "tests" && activeProduct !== "" && (
        <TestExplorer productId={Number(activeProduct)} />
      )}

      {view === "git" && activeProduct !== "" && (
        <GitExplorer productId={Number(activeProduct)} />
      )}

      {view === "settings" && (
        <>
          <GithubCard onChange={refresh} />
          <SshCard />
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
      {/* Architecture and infrastructure sit at the top of this tab, because
          they are what someone comes here to think about — the Solution list
          below is where that thinking gets built. */}
      {activeProduct !== "" && <DeveloperPlanning productId={Number(activeProduct)} />}
      {activeProduct !== "" && <InfrastructureDiagrams productId={Number(activeProduct)} />}
      {activeProduct !== "" && <FrameworkFiles productId={Number(activeProduct)} />}
      <section className="develop-card" aria-label="Create a Solution">
        <h2>Create a Solution</h2>
        {products.length === 0 ? (
          <p>Solutions link to a Product — create a Product first (Product tab).</p>
        ) : (
          <>
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
            {SOLUTION_QUESTIONS.map((q) =>
              // The language question *is* the starter picker. Asking it twice
              // — once as prose and once as a dropdown — invites two different
              // answers, and the one the generator uses would not be the one
              // anybody read.
              q.id === "language" ? (
                <label key={q.id}>
                  {q.label}
                  <select
                    aria-label="Starter language"
                    value={starterId}
                    onChange={(e) => onStarterChange(e.target.value)}
                  >
                    <option value="">Not sure yet / already have the code</option>
                    {starters.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label key={q.id}>
                  {q.label}
                  <textarea
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                  />
                </label>
              ),
            )}
            {starterId !== "" && (
              <div className="starter-detail">
                <p className="hint">
                  Needs {starters.find((s) => s.id === starterId)?.needs}.
                </p>
                {/* "Something else" has no name and no command of its own, so
                    both are asked for. Without the name the Solution would be
                    recorded as having been started in "custom", which tells
                    nobody anything a year later. */}
                {starterId === "custom" && (
                  <label>
                    Language name
                    <input
                      aria-label="Language name"
                      value={customLanguage}
                      placeholder="Elixir, Kotlin, Zig…"
                      onChange={(e) => setCustomLanguage(e.target.value)}
                    />
                  </label>
                )}
                <label>
                  Command to run
                  <input
                    aria-label="Starter command"
                    value={starterCommand}
                    placeholder="the command that creates the project"
                    onChange={(e) => setStarterCommand(e.target.value)}
                  />
                </label>
                <p className="hint">
                  This runs in a new folder named after the Solution. It is shown
                  here so you can read it before pressing Create — and it is only
                  ever run in an empty folder.
                </p>
                <label>
                  Create it in
                  <input
                    aria-label="Folder to create the project in"
                    value={starterParent}
                    placeholder="where the new project folder goes"
                    onChange={(e) => setStarterParent(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={async () => {
                    const chosen = await pickFolder();
                    if (chosen) setStarterParent(chosen);
                  }}
                >
                  Choose folder…
                </button>
              </div>
            )}

            <button type="submit">
              {starterId === "" ? "Create Solution" : "Create Solution and start it"}
            </button>
          </form>

          {/* The generator's own words, kept whether it worked or not. */}
          {starterRun && (
            <div
              className={starterRun.succeeded ? "starter-run pass" : "starter-run fail"}
              role="status"
            >
              <p>
                {starterRun.succeeded
                  ? `Started in ${starterRun.directory}.`
                  : `The starter did not finish. The Solution was still created — the folder can be pointed at or retried.`}
              </p>
              <code>{starterRun.command}</code>
              <pre>{starterRun.output}</pre>
              {/* A failed starter used to be a dead end: the only ways out were
                  pointing the Solution at a folder by hand or deleting and
                  recreating it, which meant retyping the answers just to find
                  out whether a toolchain had been installed since. */}
              {!starterRun.succeeded && lastCreatedId !== null && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setStarterRun(
                        await startExistingSolution({
                          solutionId: lastCreatedId,
                          starterId,
                          command: starterCommand || null,
                          parentDir: starterParent,
                        }),
                      );
                      setError(null);
                      setSolutions(await listSolutions());
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  Try the starter again
                </button>
              )}
            </div>
          )}
          </>
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
