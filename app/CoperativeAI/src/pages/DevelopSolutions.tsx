import SectionTabs from "../components/common/SectionTabs";
import { useCallback, useEffect, useState } from "react";

import DeveloperPlanning from "../components/planning/DeveloperPlanning";
import FrameworkFiles from "../components/product/FrameworkFiles";
import NewSolutionForm from "../components/product/NewSolutionForm";
import RulesView from "../components/planning/RulesView";
import SolutionBox from "../components/product/SolutionBox";
import SolutionRepo from "../components/vcs/SolutionRepo";
import WorkItemViews from "../components/planning/WorkItemViews";
import AgentWorkspace from "../components/ai/AgentWorkspace";
import {
  deleteSolution,
  githubStatus,
  listProducts,
  listSolutions,
  type Product,
  type Solution,
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

  /// Which Product the create-a-Solution form is making one for. Its own
  /// state, not the tabs' Product: somebody can be looking at one Product's
  /// map while adding a Solution to another.
  const [solutionProduct, setSolutionProduct] = useState<number | "">("");

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

  const productName = (id: number) =>
    products.find((p) => p.id === id)?.name ?? `Product ${id}`;

  return (
    <div className="develop-area">
      {error && <p role="alert">{error}</p>}

      {/* One bar, not two rows. The Product picker sat on a line of its own
          above the tabs, which cost a whole row to a control that changes about
          once a session — it belongs beside the tabs, on the right, where it
          reads as the scope the tabs are showing rather than a setting. */}
      <div className="develop-bar">
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

        {products.length === 0 ? (
          <p className="develop-no-product">
            No Products yet — create one in the Product tab to develop against it.
          </p>
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
      </div>

      {view === "strategy" && activeProduct !== "" && (
        <RulesView productId={Number(activeProduct)} />
      )}

      {view === "work" && activeProduct !== "" && (
        <WorkItemViews
          productId={Number(activeProduct)}
          requestedItem={openWorkItem}
          // Ready's link back the other way: an item that already has an agent
          // is answered in Build, not by scoping it again.
          onOpenAgent={(workItemId) => {
            setOpenAgent({ workItemId, at: Date.now() });
            setView("agents");
          }}
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
        {products.length === 0 || solutionProduct === "" ? (
          <p>Solutions link to a Product — create a Product first (Product tab).</p>
        ) : (
          // The same form the build plan opens from its Solution dropdown.
          // Two copies were two answers to "which types are there".
          <NewSolutionForm
            productId={Number(solutionProduct)}
            products={products}
            onProductChange={setSolutionProduct}
            askBrief
            onCreated={() => void refresh()}
          />
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
