import { useCallback, useEffect, useState } from "react";
import {
  addWorkItemChange,
  assignWorkItemChange,
  changeKindsForSolution,
  createSolution,
  listSolutions,
  deleteWorkItemChange,
  listWorkItemChanges,
  setChangeMockup,
  solutionCatalogue,
  CHANGE_KIND_LABELS,
  type ChangeAction,
  type ChangeKind,
  type Solution,
  type WorkItemChange,
} from "../../lib/backend";
import { track } from "../../lib/saving";

/** What a work item changes: screens, APIs and database tables.
 *
 *  **Product mode** adds screens with no Solution against them. That is the
 *  ask — they know what they want to see, not which repository grows it — and
 *  it has to be a legitimate state, or Product cannot record anything until a
 *  developer has done their part.
 *
 *  **Developer mode** picks up the same rows, points them at Solutions, and
 *  adds the APIs and tables that serving them needs. Same rows, later stage:
 *  copying Product's ask into a second record would mean keeping two things in
 *  step, and they would drift the first time somebody renamed a screen.
 *
 *  Which kinds a Solution can carry comes from the backend, not from a list
 *  here — two copies of that rule would drift, and the drift would only show
 *  as a rejected save. */
export default function WorkItemChanges({
  workItemId,
  mode,
  solutions,
  mockups = [],
  productId,
}: {
  workItemId: number;
  mode: "product" | "developer";
  /** The Product's Solutions, for assigning. Empty in Product mode. */
  solutions: Solution[];
  /** The pictures already on this work item's plans, so a screen can say which
   *  one shows it. Pairing them here means the model is told "this picture is
   *  the Basket screen" rather than being handed a pile and a list. */
  mockups?: string[];
  /** The Product these belong to, which is what a new Solution needs.
   *
   *  **Absent means no create form.** That is the Product-side view: a Solution
   *  is a developer's decision about how the work gets built, and offering it
   *  where nobody can act on it would mislead rather than help. */
  productId?: number;
}) {
  const [changes, setChanges] = useState<WorkItemChange[]>([]);
  const [error, setError] = useState<string | null>(null);
  /// The Solutions this panel knows about.
  ///
  /// **Seeded from the prop and re-read after making one.** The list is owned
  /// three components up, so a Solution created here would not reach the
  /// dropdown that needed it until something else happened to refresh — which
  /// is exactly what made an add button pointless.
  const [known, setKnown] = useState<Solution[]>(solutions);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("api");
  const [kind, setKind] = useState<ChangeKind>("screen");
  const [action, setAction] = useState<ChangeAction>("add");
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [target, setTarget] = useState<number | "">("");
  const [allowed, setAllowed] = useState<ChangeKind[]>(["screen", "api", "table"]);
  /// What is already recorded against the chosen Solution — the list to tick
  /// from, so an endpoint that exists is not typed in again slightly
  /// differently and treated as a second endpoint.
  const [catalogue, setCatalogue] = useState<{ kind: ChangeKind; name: string }[]>([]);

  const refresh = useCallback(async () => {
    try {
      setChanges(await listWorkItemChanges(workItemId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [workItemId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Ask the backend what this Solution's type can carry, and keep the chosen
  // kind inside that set so the form cannot offer a save that will be refused.
  useEffect(() => {
    if (mode === "product" || target === "") {
      setAllowed(["screen"]);
      setKind("screen");
      setCatalogue([]);
      return;
    }
    void solutionCatalogue(Number(target))
      .then(setCatalogue)
      .catch(() => setCatalogue([]));
    let cancelled = false;
    void (async () => {
      try {
        const kinds = await changeKindsForSolution(Number(target));
        if (cancelled) return;
        setAllowed(kinds);
        setKind((current) => (kinds.includes(current) ? current : kinds[0]));
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, target]);

  async function add() {
    try {
      await addWorkItemChange({
        workItemId,
        solutionId: mode === "product" || target === "" ? null : Number(target),
        kind,
        action,
        name,
        detail,
      });
      setName("");
      setDetail("");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function assign(id: number, solutionId: number | null) {
    try {
      await assignWorkItemChange(id, solutionId);
      setError(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function linkMockup(id: number, path: string | null) {
    try {
      await setChangeMockup(id, path);
      setError(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function remove(id: number) {
    try {
      await deleteWorkItemChange(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  /// Makes a Solution and puts it straight in the dropdown.
  ///
  /// **Re-read rather than appended.** The backend decides the id and may tidy
  /// the name, so guessing the row would show something subtly different from
  /// what was saved — and this dropdown is about to be used to assign work to
  /// it.
  async function addSolution() {
    if (productId === undefined) return;
    const wanted = newName.trim();
    if (wanted === "") return;
    try {
      const id = await track("Solution", () =>
        createSolution({ name: wanted, productId, solutionType: newType, answers: "{}" }),
      );
      const all = await listSolutions();
      setKnown(all.filter((s) => s.productId === productId));
      // Selected at once: somebody who made one here meant to assign this to it.
      setTarget(id);
      setAdding(false);
      setNewName("");
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  const unassigned = changes.filter((c) => c.solutionId === null);
  const nameFor = (id: number) =>
    known.find((s) => s.id === id)?.name ?? `Solution ${id}`;

  return (
    <section
      className="work-item-changes"
      aria-label={mode === "product" ? "Screens wanted" : "What this changes"}
    >
      <h3>{mode === "product" ? "Screens wanted" : "What this changes"}</h3>
      <p className="hint">
        {mode === "product"
          ? "The screens this work item needs. You do not have to know which Solution builds them — a developer assigns that."
          : "Screens, APIs and database tables, per Solution. What you can add depends on the Solution's type: a website has screens, an API has endpoints and the tables behind them."}
      </p>

      {error && <p role="alert">{error}</p>}

      {/* **The empty case is the common one**, and it used to be silent: a work
          item arrives from Product with screens on it, the Solution dropdown
          offers only "not assigned", and what to do about that was something
          you had to already know. */}
      {mode === "developer" && productId !== undefined && (
        <div className="add-solution">
          {known.length === 0 && (
            <p className="hint">
              This Product has no Solutions yet, so there is nothing to assign
              these to.
            </p>
          )}
          {adding ? (
            <form
              className="add-solution-form"
              onSubmit={(e) => {
                e.preventDefault();
                void addSolution();
              }}
            >
              <input
                type="text"
                aria-label="New Solution name"
                placeholder="Solution name"
                value={newName}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
              />
              <select
                aria-label="New Solution type"
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
              >
                <option value="api">API</option>
                <option value="website">Website</option>
                <option value="service">Service</option>
                <option value="library">Library</option>
                <option value="other">Other</option>
              </select>
              <button type="submit" disabled={newName.trim() === ""}>
                Create
              </button>
              <button type="button" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setAdding(true)}>
              Add a Solution
            </button>
          )}
        </div>
      )}

      <div className="change-form">
        {mode === "developer" && (
          <label>
            Solution
            <select
              aria-label="Solution this belongs to"
              value={target}
              onChange={(e) => setTarget(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">Not assigned yet</option>
              {known.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.solutionType})
                </option>
              ))}
            </select>
          </label>
        )}

        {mode === "developer" && (
          <label>
            Kind
            <select
              aria-label="Kind of change"
              value={kind}
              onChange={(e) => setKind(e.target.value as ChangeKind)}
            >
              {allowed.map((k) => (
                <option key={k} value={k}>
                  {CHANGE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          Add or change
          <select
            aria-label="Add or change"
            value={action}
            onChange={(e) => setAction(e.target.value as ChangeAction)}
          >
            <option value="add">New</option>
            <option value="change">Change an existing one</option>
          </select>
        </label>

        <label>
          Name
          <input
            aria-label="Name"
            value={name}
            placeholder={
              kind === "screen"
                ? "Basket"
                : kind === "api"
                  ? "POST /checkout"
                  : "orders"
            }
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label>
          Detail
          <input
            aria-label="Detail"
            value={detail}
            placeholder="what it shows, does, or holds"
            onChange={(e) => setDetail(e.target.value)}
          />
        </label>

        <button onClick={add} disabled={name.trim() === ""}>
          Add
        </button>
      </div>

      {/* Tick what already exists rather than retyping it. An endpoint typed
          in again slightly differently becomes a second endpoint that nobody
          notices until two of them are built. */}
      {mode === "developer" && target !== "" && catalogue.length > 0 && (
        <div className="change-catalogue">
          <p className="hint">
            Already in this Solution — tick what this work touches:
          </p>
          <ul>
            {catalogue
              .filter((entry) => allowed.includes(entry.kind))
              .map((entry) => {
                const already = changes.some(
                  (c) =>
                    c.solutionId === Number(target) &&
                    c.kind === entry.kind &&
                    c.name.toLowerCase() === entry.name.toLowerCase(),
                );
                return (
                  <li key={`${entry.kind}-${entry.name}`}>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`${entry.name} is affected`}
                        checked={already}
                        disabled={already}
                        onChange={() =>
                          void addWorkItemChange({
                            workItemId,
                            solutionId: Number(target),
                            kind: entry.kind,
                            // Ticking something that exists is a change to it,
                            // not an addition — that is what makes it worth
                            // ticking rather than adding.
                            action: "change",
                            name: entry.name,
                            detail: "",
                          })
                            .then(refresh)
                            .catch((e) => setError(String(e)))
                        }
                      />{" "}
                      <span className="change-kind">
                        {CHANGE_KIND_LABELS[entry.kind]}
                      </span>{" "}
                      {entry.name}
                    </label>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {mode === "developer" && unassigned.length > 0 && (
        <p className="hint change-waiting">
          {unassigned.length} of these {unassigned.length === 1 ? "is" : "are"} still
          waiting to be assigned to a Solution.
        </p>
      )}

      {changes.length === 0 && <p className="hint">Nothing recorded yet.</p>}

      <ul className="change-list">
        {changes.map((change) => (
          <li key={change.id} className={`change change-${change.kind}`}>
            <span className="change-kind">{CHANGE_KIND_LABELS[change.kind]}</span>
            <span className={`change-action ${change.action}`}>
              {change.action === "add" ? "new" : "change"}
            </span>
            <strong>{change.name}</strong>
            {change.detail && <span className="change-detail">{change.detail}</span>}

            {mode === "developer" ? (
              <select
                aria-label={`Solution for ${change.name}`}
                value={change.solutionId ?? ""}
                onChange={(e) =>
                  assign(change.id, e.target.value === "" ? null : Number(e.target.value))
                }
              >
                <option value="">Not assigned</option>
                {known.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              change.solutionId !== null && (
                <span className="change-assigned">→ {nameFor(change.solutionId)}</span>
              )
            )}

            {/* Only screens have pictures, and only once some exist. */}
            {mode === "developer" && change.kind === "screen" && mockups.length > 0 && (
              <select
                aria-label={`Mockup for ${change.name}`}
                value={change.mockupPath ?? ""}
                onChange={(e) => linkMockup(change.id, e.target.value || null)}
              >
                <option value="">No picture</option>
                {mockups.map((path) => (
                  <option key={path} value={path}>
                    {path.split(/[\\/]/).pop()}
                  </option>
                ))}
              </select>
            )}

            <button aria-label={`Remove ${change.name}`} onClick={() => remove(change.id)}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
