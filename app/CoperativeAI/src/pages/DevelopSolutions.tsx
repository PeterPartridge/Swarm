import SectionTabs from "../components/common/SectionTabs";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import DeveloperPlanning from "../components/planning/DeveloperPlanning";
import FrameworkFiles from "../components/product/FrameworkFiles";
import RulesView from "../components/planning/RulesView";
import SolutionBox from "../components/product/SolutionBox";
import SolutionRepo from "../components/vcs/SolutionRepo";
import WorkItemViews from "../components/planning/WorkItemViews";
import AgentWorkspace from "../components/ai/AgentWorkspace";
import {
  createSolutionWithStarter,
  deleteSolution,
  githubStatus,
  listProducts,
  listSolutions,
  listStarters,
  startExistingSolution,
  pickFolder,
  SOLUTION_QUESTIONS,
  SOLUTION_TYPES,
  type Product,
  type Solution,
  type Starter,
  type StarterRun,
} from "../lib/backend";

/** Which slice of the Develop area is showing.
 *
 *  Four, in the order the work runs: the rules everything is built under, the
 *  items waiting to be built, the building itself, and the map it is being built
 *  on. Tests and Git are no longer tabs — they answered across the whole Product
 *  and so could never say which agent an answer belonged to. Both are inside
 *  Build now: per agent in the workbench, and Product-wide under its
 *  "queue, questions and runs" entry. */
type DevelopView = "strategy" | "work" | "agents" | "architecture";

const DEVELOP_TABS: { id: DevelopView; label: string }[] = [
  { id: "strategy", label: "Rules" },
  { id: "work", label: "Work" },
  // One tab, not the four it replaced. "AI" listed the agents but could not show
  // a line of what they wrote; "Code" showed the code but did not know an agent
  // had written it; Tests and Git each knew the Product but not the agent.
  // Following one agent from queued to shipped meant visiting all four and
  // re-finding it in each — so they are one screen now, with the agents down the
  // side and your own working copy still first among them.
  { id: "agents", label: "Build" },
  { id: "architecture", label: "Map" },
  // No Settings tab: GitHub, SSH, models and AI providers all moved to Admin,
  // which is where every other setting already was. Two places to look for a
  // setting meant knowing which before you could look.
];

/** The Develop environment: pick a Product, then work in one of four tabs —
 *  Planning (strategy, rules, architecture), Work (board/sprint/list),
 *  Workspace (solutions, editor, review). Settings of every kind live in
 *  Admin. */
export default function DevelopSolutions({
  requestedView,
}: {
  /** A tab the command palette asked for. Carries a timestamp so asking for
   *  the same tab twice still moves — a bare string would compare equal and
   *  the second request would do nothing. */
  requestedView?: { id: string; at: number } | null;
} = {}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [activeProduct, setActiveProduct] = useState<number | "">("");
  const [view, setView] = useState<DevelopView>("strategy");
  // A tab asked for from the command palette. Checked against the real tab list
  // so a stale entry cannot put this component into a view it cannot render.
  useEffect(() => {
    if (!requestedView) return;
    if (DEVELOP_TABS.some((t) => t.id === requestedView.id)) {
      setView(requestedView.id as DevelopView);
    }
  }, [requestedView]);
  /** Which Solution the Code tab is editing — set by "Open" on the Workspace
   *  tab, so the two tabs are one flow rather than two disconnected screens. */
  const [openSolution, setOpenSolution] = useState<Solution | null>(null);
  /** A work item the Build view's lane asked Work to open. Carries a timestamp
   *  so asking twice for the same item still moves — a bare id would compare
   *  equal and the second press would do nothing. */
  const [openWorkItem, setOpenWorkItem] = useState<{ id: number; at: number } | null>(
    null,
  );
  /** An agent the Map's inspector asked Build to select. */
  const [openAgent, setOpenAgent] = useState<{ workItemId: number; at: number } | null>(
    null,
  );
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

      {/* `as="buttons"`, not a tablist — WorkItemViews already owns real
          Board/Sprint/List tabs inside the Work section, and two tablists on
          one page would make "the tabs" ambiguous to a screen reader. */}
      <SectionTabs
        label="Develop sections"
        className="develop-tabs"
        as="buttons"
        options={DEVELOP_TABS}
        active={view}
        onSelect={(id) => setView(id as DevelopView)}
      />

      {view === "strategy" && activeProduct !== "" && (
        <RulesView productId={Number(activeProduct)} />
      )}

      {view === "work" && activeProduct !== "" && (
        <WorkItemViews
          productId={Number(activeProduct)}
          requestedItem={openWorkItem}
        />
      )}

      {/* The merged panel: agents down the left with their own sub-panels, and
          the plain editor as the first entry for work with no agent in it. */}
      {view === "agents" && activeProduct !== "" && (
        <AgentWorkspace
          productId={Number(activeProduct)}
          solutions={solutions.filter((s) => s.productId === Number(activeProduct))}
          opened={openSolution}
          requestedAgent={openAgent}
          // The lane's link out. Build and Work are two tabs of one flow: an
          // item with no agent on it is answered in Work, not here.
          onOpenWork={(id) => {
            setOpenWorkItem({ id, at: Date.now() });
            setView("work");
          }}
        />
      )}

      {/* A plain function call, not a <Component> — an inner component gets a
          new identity every render, and React would remount the whole subtree
          on each keystroke, dropping the editor's open file and input focus. */}
      {view === "architecture" && workspaceSection()}
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
      {activeProduct !== "" && (
        <DeveloperPlanning
          productId={Number(activeProduct)}
          // The map's inspector links to the agent inside a Solution. Map and
          // Build are two views of one thing: the map says where the work is,
          // Build says what it is doing.
          onOpenAgent={(workItemId) => {
            setOpenAgent({ workItemId, at: Date.now() });
            setView("agents");
          }}
        />
      )}
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
                  // The editor lives inside the merged panel now, as its first
                  // rail entry — so opening a Solution lands there.
                  setView("agents");
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
