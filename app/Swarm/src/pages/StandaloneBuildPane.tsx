import { useEffect, useState } from "react";
import BuildFileEditor from "../components/code/BuildFileEditor";
import WorkItemBuildPlan from "../components/planning/WorkItemBuildPlan";
import {
  getWorkItem,
  listSolutions,
  type Solution,
  type WorkItem,
} from "../lib/backend";
import { PermissionProvider } from "../lib/permissions";

/** A Build pane pulled out into its own OS window.
 *
 *  **Two panes, one page.** The Build view's middle column holds a work item's
 *  plan, a file, and the debug output, and all three are things somebody wants
 *  on the other monitor while looking at the first. The console already had its
 *  own window; these two are the same idea with different arguments, and one
 *  page because both do exactly the same three things: read the id from the
 *  URL, look the record up, and render the panel the main window renders.
 *
 *  **Read rather than handed over.** A window is opened by URL and has no
 *  props, so the alternative was encoding a Solution's name and folder, or a
 *  work item's title and description, in query parameters — copies of facts the
 *  database already holds, stale the moment anybody edits them.
 *
 *  Wrapped in its own `PermissionProvider` because a pop-out renders outside
 *  the main shell's tree, and the panels inside ask what the role may see. */
export default function StandaloneBuildPane(
  props:
    | { pane: "workItem"; workItemId: number }
    | { pane: "file"; solutionId: number; path: string },
) {
  return (
    <PermissionProvider>
      <div className="standalone-screen">
        {props.pane === "workItem" ? (
          <PulledWorkItem workItemId={props.workItemId} />
        ) : (
          <PulledFile solutionId={props.solutionId} path={props.path} />
        )}
      </div>
    </PermissionProvider>
  );
}

function PulledWorkItem({ workItemId }: { workItemId: number }) {
  const [item, setItem] = useState<WorkItem | null>(null);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        // One read for the item, one for the Solutions its panel offers. It
        // used to walk every Product's work items looking for this id, because
        // there was no way to ask for one — which meant a window that knew
        // exactly what it wanted read the whole workspace to find it.
        const [found, all] = await Promise.all([getWorkItem(workItemId), listSolutions()]);
        if (!found) {
          setError("That work item is not in this workspace any more.");
          return;
        }
        setItem(found);
        setSolutions(all.filter((s) => s.productId === found.productId));
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [workItemId]);

  if (error) return <p role="alert">{error}</p>;
  if (!item) return <p>Loading…</p>;
  return (
    <>
      <header className="workspace-header">
        <h2>{item.title}</h2>
        <span className="screen-name">build plan</span>
      </header>
      <WorkItemBuildPlan item={item} solutions={solutions} />
    </>
  );
}

function PulledFile({ solutionId, path }: { solutionId: number; path: string }) {
  const [solution, setSolution] = useState<Solution | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const found = (await listSolutions()).find((s) => s.id === solutionId);
        if (!found) {
          setError("That Solution is not in this workspace any more.");
          return;
        }
        setSolution(found);
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [solutionId]);

  if (error) return <p role="alert">{error}</p>;
  if (!solution) return <p>Loading…</p>;
  return (
    <>
      <header className="workspace-header">
        <h2>{solution.name}</h2>
        <span className="screen-name">{path}</span>
      </header>
      {/* Closing a pulled-out file closes the window it is in — there is no
          pane behind it to put back. */}
      <BuildFileEditor
        solution={solution}
        path={path}
        onClose={() => window.close()}
      />
    </>
  );
}
