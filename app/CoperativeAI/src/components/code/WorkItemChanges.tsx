import { useCallback, useEffect, useState } from "react";
import NewSolutionForm from "../product/NewSolutionForm";
import {
  addWorkItemChange,
  addWorkItemChanges,
  assignWorkItemChange,
  attachSolutionToWorkItem,
  changeKinds,
  changeKindsForSolution,
  detachWorkItemPlan,
  listSolutions,
  listWorkItemPlans,
  deleteWorkItemChange,
  kindLabel,
  listWorkItemChanges,
  pickImages,
  saveWorkItemPlan,
  setChangeMockup,
  setPlanApproval,
  setWorkItemChangeDetail,
  suggestChangeNames,
  type ChangeAction,
  type ChangeKind,
  type ChangeKindInfo,
  type Solution,
  type Suggestion,
  type WorkItemChange,
  type WorkItemPlan,
} from "../../lib/backend";

/** The dropdown value that opens the create-a-Solution form. Not an id, and
 *  not "" — both are real answers already. */
const MAKE_ONE = "__new__";

/** The kinds a picture can be a picture of. A mockup is a shot of something
 *  somebody looks at; there is no picture of a database table. */
const VISUAL: ChangeKind[] = ["screen", "component", "route", "style"];

function parseMockups(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** What is being said about one Solution, over and above what is already
 *  saved: which families are being looked at, whether the things are new, and
 *  the names typed but not yet committed. */
interface Draft {
  kinds: ChangeKind[];
  /** Names typed, per kind, one per line. */
  typed: Record<string, string>;
  /** The rows this pass put in, so the detail box writes to those and not to
   *  everything that happens to share a Solution and a kind. */
  touched: number[];
  /** Anything the backend refused, named. */
  refused: string[];
}

const emptyDraft = (): Draft => ({
  kinds: [],
  typed: {},
  touched: [],
  refused: [],
});

/** What a work item changes, per Solution — and everything else about that
 *  Solution's part of the work.
 *
 *  **Product mode** adds screens with no Solution against them. That is the
 *  ask — they know what they want to see, not which repository grows it — and
 *  it has to be a legitimate state, or Product cannot record anything until a
 *  developer has done their part.
 *
 *  **Developer mode is the whole per-Solution plan.** It was three sections:
 *  a ticklist of affected Solutions, this list of changes, and a block of
 *  branch/tests/notes per Solution further down. Three places to say something
 *  about one Solution, and the ticklist existed only to make the third appear.
 *  A Solution is affected because somebody said what changes in it, so picking
 *  it here attaches it, and everything about it — the things, the sentence, the
 *  tests, the branch, the pictures and the approval — is in the one block.
 *
 *  Ticking is the save and the boxes save on leaving them; there is no save
 *  button, because a form where a button is the only thing that commits is a
 *  form somebody walks away from mid-thought and loses.
 *
 *  Which kinds a Solution can carry, and what they are called, comes from the
 *  backend — two copies of that vocabulary would drift, and the drift would
 *  only show as a rejected save. */
export default function WorkItemChanges({
  workItemId,
  mode,
  solutions,
  productId,
  reloadAt,
  onSaved,
  onNote,
}: {
  workItemId: number;
  mode: "product" | "developer";
  /** The Product's Solutions, for assigning. Empty in Product mode. */
  solutions: Solution[];
  /** The Product these belong to, which is what a new Solution needs.
   *
   *  **Absent means no create form.** That is the Product-side view: a Solution
   *  is a developer's decision about how the work gets built, and offering it
   *  where nobody can act on it would mislead rather than help. */
  productId?: number;
  /** Bumped when something outside this panel has changed the plans — the
   *  generate step writes the schemas that are drawn in each block, and this
   *  panel would otherwise go on showing the ones it last read. A timestamp
   *  rather than a flag, so asking twice still moves. */
  reloadAt?: number;
  /** Fired after anything is written, so the owner can put the work item's
   *  `.md` and `.json` back on disk. */
  onSaved?: () => void;
  /** One entry of "what needs to change", already worded — the owner appends
   *  it to the work item's development details as a new set. */
  onNote?: (note: string) => void;
}) {
  const [changes, setChanges] = useState<WorkItemChange[]>([]);
  const [plans, setPlans] = useState<WorkItemPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  /// The whole vocabulary, for labelling every row — including rows against a
  /// Solution nobody has selected, whose allowed kinds were never fetched.
  const [vocabulary, setVocabulary] = useState<ChangeKindInfo[]>([]);
  /// The Solutions this panel knows about.
  ///
  /// **Seeded from the prop and re-read after making one.** The list is owned
  /// three components up, so a Solution created here would not reach the
  /// dropdown that needed it until something else happened to refresh.
  const [known, setKnown] = useState<Solution[]>(solutions);
  /// Per Solution, which kinds its type can carry.
  const [allowed, setAllowed] = useState<Record<number, ChangeKind[]>>({});
  /// What appears to exist already, per Solution and kind — the team's recorded
  /// names, plus whatever is in the folder the Develop rules put that kind in.
  /// Fetched per kind as it is ticked, because scanning a folder for a kind
  /// nobody is looking at is work nobody asked for.
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion[]>>({});
  /// The unsaved half, per Solution.
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  /// The Solution the "and also" row is pointed at before it is attached, and
  /// whether the create-a-Solution form is open under it.
  const [adding, setAdding] = useState<number | "">("");
  const [making, setMaking] = useState(false);

  /// Product's half stays one thing at a time: a screen, named, with a line
  /// about what it shows. There is no Solution to pick and no families to
  /// tick, so the composite form would be four controls asking nothing.
  const [askName, setAskName] = useState("");
  const [askDetail, setAskDetail] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [loadedChanges, loadedPlans] = await Promise.all([
        listWorkItemChanges(workItemId),
        mode === "developer" ? listWorkItemPlans(workItemId) : Promise.resolve([]),
      ]);
      setChanges(loadedChanges);
      setPlans(loadedPlans);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [workItemId, mode]);

  useEffect(() => {
    void refresh();
  }, [refresh, reloadAt]);

  // The list is owned three components up and only reaches here as a prop, so
  // a Solution added anywhere else has to be picked up when it arrives.
  useEffect(() => {
    setKnown(solutions);
  }, [solutions]);

  useEffect(() => {
    void changeKinds()
      .then(setVocabulary)
      .catch((e) => setError(String(e)));
  }, []);

  /// Loads which kinds a Solution's type can carry.
  const learn = useCallback(async (solutionId: number) => {
    try {
      const kinds = await changeKindsForSolution(solutionId);
      setAllowed((current) => ({ ...current, [solutionId]: kinds }));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Every attached Solution needs its vocabulary and its catalogue, whether it
  // was attached just now or three days ago — a block that came back from the
  // database with no kinds to tick would look broken.
  useEffect(() => {
    for (const p of plans) {
      if (allowed[p.solutionId] === undefined) void learn(p.solutionId);
    }
  }, [plans, allowed, learn]);

  /// Asks what already exists of one kind, once per Solution and kind.
  const suggest = useCallback(async (solutionId: number, kind: ChangeKind) => {
    const key = `${solutionId}:${kind}`;
    try {
      const found = await suggestChangeNames(solutionId, kind);
      setSuggestions((current) => ({ ...current, [key]: found }));
    } catch {
      // A suggestion list is help, not the feature. A Solution whose folder has
      // gone still gets a box to type in rather than an error over the form.
      setSuggestions((current) => ({ ...current, [key]: [] }));
    }
  }, []);

  const draftFor = (solutionId: number): Draft => drafts[solutionId] ?? emptyDraft();

  function edit(solutionId: number, changed: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [solutionId]: { ...draftFor(solutionId), ...changed },
    }));
  }

  /// Runs a write, refreshes, and tells the owner something was saved — which
  /// is what puts the `.md` and `.json` back on disk. One place, so nothing can
  /// be saved without the files following it.
  async function save(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
      setError(null);
      onSaved?.();
    } catch (e) {
      setError(String(e));
    }
  }

  /// Whether this exact thing is already on the work item for that Solution.
  /// The tick reflects the database rather than a local note of what was
  /// clicked, so it is still right after a refresh.
  const recorded = (solutionId: number, kind: ChangeKind, name: string) =>
    changes.find(
      (c) =>
        c.solutionId === solutionId &&
        c.kind === kind &&
        c.name.toLowerCase() === name.toLowerCase(),
    );

  /// Whether naming this is adding something or changing something that is
  /// already there.
  ///
  /// **Worked out, not asked.** There was a New-or-existing dropdown, and it
  /// was a question the app can already answer: a name that appears in the
  /// Solution — recorded against it before, or sitting in the folder the rules
  /// put that kind in — is being changed; anything else is new. Asking meant a
  /// wrong answer was one mis-click away, and "add the Basket screen" against a
  /// Basket screen that exists is a plan that gets estimated wrong.
  function actionFor(solutionId: number, kind: ChangeKind, name: string): ChangeAction {
    const known = suggestions[`${solutionId}:${kind}`] ?? [];
    return known.some((s) => s.name.toLowerCase() === name.toLowerCase())
      ? "change"
      : "add";
  }

  async function toggle(solutionId: number, kind: ChangeKind, name: string) {
    const draft = draftFor(solutionId);
    const existing = recorded(solutionId, kind, name);
    if (existing) {
      await save(() => deleteWorkItemChange(existing.id));
      edit(solutionId, { touched: draft.touched.filter((id) => id !== existing.id) });
      return;
    }
    await save(async () => {
      const [outcome] = await addWorkItemChanges(workItemId, [
        { solutionId, kind, action: actionFor(solutionId, kind, name), name, detail: "" },
      ]);
      edit(solutionId, {
        touched: outcome.id === null ? draft.touched : [...draft.touched, outcome.id],
        refused:
          outcome.refused === null
            ? draft.refused
            : [...draft.refused, `${name}: ${outcome.refused}`],
      });
    });
  }

  /// Commits the names typed for one kind — one per line, blanks dropped.
  ///
  /// Runs on leaving the box, so five screens are five lines and nothing else.
  /// Names already recorded are left alone rather than re-sent, so coming back
  /// to the box does not produce a list of duplicate complaints.
  async function commitTyped(solutionId: number, kind: ChangeKind) {
    const draft = draftFor(solutionId);
    const wanted = (draft.typed[kind] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && recorded(solutionId, kind, line) === undefined);
    if (wanted.length === 0) return;

    await save(async () => {
      const outcomes = await addWorkItemChanges(
        workItemId,
        wanted.map((name) => ({
          solutionId,
          kind,
          action: actionFor(solutionId, kind, name),
          name,
          detail: "",
        })),
      );
      edit(solutionId, {
        touched: [
          ...draft.touched,
          ...outcomes.flatMap((o) => (o.id === null ? [] : [o.id])),
        ],
        refused: [
          ...draft.refused,
          ...outcomes.flatMap((o) => (o.refused === null ? [] : [`${o.name}: ${o.refused}`])),
        ],
      });
      // What is recorded against a Solution is half of what is suggested, so
      // naming something new grows the list — and a stale copy here would
      // offer the same name to be typed a second time.
      await suggest(solutionId, kind);
    });
  }

  /** Saves one field of a Solution's plan, keeping the rest. */
  async function savePlan(plan: WorkItemPlan, changed: Partial<WorkItemPlan>) {
    const next = { ...plan, ...changed };
    await save(() =>
      saveWorkItemPlan({
        id: plan.id,
        changesRequired: next.changesRequired,
        unitTests: next.unitTests,
        branchName: next.branchName,
        cloneFrom: next.cloneFrom,
        mockups: next.mockups,
      }),
    );
  }

  /// The one sentence about this Solution, written once and landing everywhere
  /// it was ever asked for.
  ///
  /// **Three boxes asked this same question**: the plan's "what has to change
  /// here", the detail against each screen, and the work item's development
  /// details. Somebody answering all three wrote it three times; somebody
  /// answering one left the other two looking unanswered. It is one box now,
  /// and it fills all three.
  async function commitDetail(plan: WorkItemPlan, text: string) {
    const draft = draftFor(plan.solutionId);
    await savePlan(plan, { changesRequired: text });
    if (draft.touched.length > 0) {
      await save(() => setWorkItemChangeDetail(draft.touched, text));
    }
    if (text.trim() === "" || text.trim() === plan.changesRequired.trim()) return;
    const affected = changes
      .filter((c) => c.solutionId === plan.solutionId)
      .map((c) => `${kindLabel(vocabulary, c.kind)} ${c.name}`)
      .join(", ");
    onNote?.(`${plan.solutionName} — ${affected || "nothing named yet"}\n${text.trim()}`);
  }

  async function addPictures(plan: WorkItemPlan) {
    try {
      const picked = await pickImages();
      if (picked.length === 0) return;
      const merged = [...new Set([...parseMockups(plan.mockups), ...picked])];
      await savePlan(plan, { mockups: JSON.stringify(merged) });
    } catch (e) {
      setError(String(e));
    }
  }

  async function addAsk() {
    await save(async () => {
      await addWorkItemChange({
        workItemId,
        solutionId: null,
        kind: "screen",
        action: "add",
        name: askName,
        detail: askDetail,
      });
      setAskName("");
      setAskDetail("");
    });
  }

  /// Attaching is how a Solution becomes affected. There is no separate
  /// ticklist any more: a Solution is affected because somebody came here to
  /// say what changes in it.
  async function attach(solutionId: number) {
    await save(() => attachSolutionToWorkItem(workItemId, solutionId));
    await learn(solutionId);
    setAdding("");
    setMaking(false);
  }

  /// Made and attached in one move: somebody who created a Solution here meant
  /// to point this work at it.
  async function afterCreated(solutionId: number) {
    try {
      const all = await listSolutions();
      setKnown(all.filter((s) => s.productId === productId));
      setError(null);
      await attach(solutionId);
    } catch (e) {
      setError(String(e));
    }
  }

  const unassigned = changes.filter((c) => c.solutionId === null);
  const nameFor = (id: number) => known.find((s) => s.id === id)?.name ?? `Solution ${id}`;
  /// The families, in the order the backend gives them, with only the kinds
  /// this Solution can carry under each. A family none of whose kinds it
  /// carries is left out rather than shown empty.
  const families = (ids: ChangeKind[]) => {
    const mine = vocabulary.filter((k) => ids.includes(k.id));
    const order: string[] = [];
    for (const k of mine) if (!order.includes(k.group)) order.push(k.group);
    return order.map((group) => ({
      group,
      label: mine.find((k) => k.group === group)?.groupLabel ?? group,
      kinds: mine.filter((k) => k.group === group),
    }));
  };
  const unattached = known.filter((s) => !plans.some((p) => p.solutionId === s.id));

  return (
    <section
      className="work-item-changes"
      aria-label={mode === "product" ? "Screens wanted" : "What this changes"}
    >
      <h3>{mode === "product" ? "Screens wanted" : "What this changes"}</h3>
      <p className="hint">
        {mode === "product"
          ? "The screens this work item needs. You do not have to know which Solution builds them — a developer assigns that."
          : "One block per Solution this touches: what changes inside it, what has to happen, what proves it, and where it lands. Every tick and every box saves as you leave it, and the .md and .json are rewritten each time — there is nothing to press."}
      </p>

      {error && <p role="alert">{error}</p>}

      {mode === "product" && (
        <div className="change-form">
          <label>
            Screen
            <input
              aria-label="Name"
              value={askName}
              placeholder="Basket"
              onChange={(e) => setAskName(e.target.value)}
            />
          </label>
          <label>
            Detail
            <input
              aria-label="Detail"
              value={askDetail}
              placeholder="what it shows"
              onChange={(e) => setAskDetail(e.target.value)}
            />
          </label>
          <button onClick={addAsk} disabled={askName.trim() === ""}>
            Add
          </button>
        </div>
      )}

      {mode === "developer" &&
        plans.map((plan) => {
          const solutionId = plan.solutionId;
          const draft = draftFor(solutionId);
          const ids = allowed[solutionId] ?? [];
          const mine = changes.filter((c) => c.solutionId === solutionId);
          const pictures = parseMockups(plan.mockups);
          /// Pictures belong to a block once it is about something somebody
          /// looks at — a screen or a component. Not on a block of endpoints
          /// and tables, where "add a picture" is a question with no answer.
          const visual =
            draft.kinds.some((k) => VISUAL.includes(k)) ||
            mine.some((c) => VISUAL.includes(c.kind));
          return (
            <div className="change-block" key={plan.id}>
              <div className="change-block-head">
                <strong>{plan.solutionName}</strong>
                {/* Approval sits with the text rather than beside the Start
                    button, because it is a statement about *this* — you approve
                    what you have just read. Editing any box below clears it. */}
                <span
                  className={`plan-approval ${plan.approvedAt > 0 ? "approved" : "pending"}`}
                >
                  {plan.approvedAt > 0 ? "Approved" : "Not approved"}
                </span>
                <button
                  type="button"
                  aria-label={
                    plan.approvedAt > 0
                      ? `Withdraw approval for ${plan.solutionName}`
                      : `Approve the plan for ${plan.solutionName}`
                  }
                  onClick={() =>
                    void save(() =>
                      setPlanApproval(workItemId, solutionId, plan.approvedAt === 0),
                    )
                  }
                >
                  {plan.approvedAt > 0 ? "Withdraw approval" : "Approve"}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${plan.solutionName} from this work item`}
                  onClick={() => void save(() => detachWorkItemPlan(plan.id))}
                >
                  Remove
                </button>
              </div>

              {plan.approvedAt === 0 && (
                <p className="hint">
                  A run for this Solution will not start until the plan is
                  approved — it makes a checkout and hands an agent a brief, so
                  it waits on somebody having read what it says.
                </p>
              )}

              {ids.length > 0 && (
                <>
                  {/* Not one dropdown of three words. What "UI", "logic" and
                      "models" mean depends on what is being built: a front end
                      has services and view models, an API has incoming models,
                      outgoing models and the data models behind them. The
                      backend says which of those this Solution can carry. */}
                  <fieldset className="change-kinds">
                    <legend>What changes in it</legend>
                    {families(ids).map((family) => (
                      <div className="change-family" key={family.group}>
                        <span className="change-family-name">{family.label}</span>
                        {family.kinds.map((k) => (
                          <label key={k.id} className="change-kind-tick">
                            <input
                              type="checkbox"
                              aria-label={`${k.label} changes in ${plan.solutionName}`}
                              checked={draft.kinds.includes(k.id)}
                              onChange={(e) => {
                                edit(solutionId, {
                                  kinds: e.target.checked
                                    ? [...draft.kinds, k.id]
                                    : draft.kinds.filter((id) => id !== k.id),
                                });
                                // Asked for when the kind is ticked, not on
                                // arrival: scanning a folder for a kind nobody
                                // is looking at is work nobody asked for.
                                if (e.target.checked) void suggest(solutionId, k.id);
                              }}
                            />{" "}
                            {k.label}
                          </label>
                        ))}
                      </div>
                    ))}
                  </fieldset>

                  {draft.kinds.map((kindId) => {
                    const info = vocabulary.find((k) => k.id === kindId);
                    const found = suggestions[`${solutionId}:${kindId}`];
                    return (
                      <div className="change-picker" key={kindId}>
                        <span className="change-picker-head">
                          {info?.heading ?? kindId}
                        </span>
                        {/* One box, and the app works out whether each name is
                            new or something that already exists — see
                            `actionFor`. A dropdown asking which was a question
                            the app could already answer, and a wrong answer was
                            one mis-click away. */}
                        <textarea
                          rows={3}
                          aria-label={`${info?.heading ?? kindId} in ${plan.solutionName}`}
                          placeholder={`one per line — ${info?.example ?? "a name"}`}
                          value={draft.typed[kindId] ?? ""}
                          onChange={(e) =>
                            edit(solutionId, {
                              typed: { ...draft.typed, [kindId]: e.target.value },
                            })
                          }
                          onBlur={() => void commitTyped(solutionId, kindId)}
                        />

                        {/* **Suggestions, and where each came from.** A name
                            recorded before is the team's own word for it; a
                            name read off the disk is this app's guess at what
                            they call that file. Presenting the second as the
                            first is how a plan ends up naming a file rather
                            than a feature. */}
                        {found === undefined ? (
                          <p className="hint">Looking for what is already there…</p>
                        ) : found.length === 0 ? (
                          <p className="hint">
                            Nothing found to suggest. Say where{" "}
                            {(info?.heading ?? kindId).toLowerCase()} live in the
                            Develop rules and this reads the folder.
                          </p>
                        ) : (
                          <ul className="change-suggestions">
                            {found.map((s) => {
                              const already =
                                recorded(solutionId, kindId, s.name) !== undefined;
                              return (
                                <li key={s.name}>
                                  <button
                                    type="button"
                                    className={already ? "suggestion on" : "suggestion"}
                                    aria-pressed={already}
                                    aria-label={`${s.name} is affected`}
                                    title={
                                      s.foundIn === "recorded"
                                        ? "Planned against this Solution before"
                                        : `Found in ${s.foundIn}`
                                    }
                                    onClick={() => void toggle(solutionId, kindId, s.name)}
                                  >
                                    {s.name}
                                    <em>
                                      {s.foundIn === "recorded" ? "recorded" : s.foundIn}
                                    </em>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              {/* The pictures come out when the block is about something
                  somebody looks at. They used to sit in a separate section
                  further down, which meant attaching a shot of the Basket
                  screen happened nowhere near the row that says the Basket
                  screen is changing — so nothing paired them and the model got
                  a pile of images and a list of names. */}
              {visual && (
                <div className="plan-mockups">
                  <button
                    type="button"
                    aria-label={`Add UI pictures for ${plan.solutionName}`}
                    onClick={() => void addPictures(plan)}
                  >
                    Add UI pictures
                  </button>
                  {pictures.length > 0 && (
                    <ul aria-label={`UI pictures for ${plan.solutionName}`}>
                      {pictures.map((path) => (
                        <li key={path}>
                          <span>{path.split(/[\\/]/).pop()}</span>
                          <button
                            type="button"
                            aria-label={`Remove picture ${path}`}
                            onClick={() =>
                              void savePlan(plan, {
                                mockups: JSON.stringify(
                                  pictures.filter((m) => m !== path),
                                ),
                              })
                            }
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Which picture is which screen. Without this the model has
                      a pile of images and a list of names and has to guess. */}
                  {pictures.length > 0 &&
                    mine
                      .filter((c) => VISUAL.includes(c.kind))
                      .map((c) => (
                        <label key={c.id} className="mockup-pair">
                          {c.name}
                          <select
                            aria-label={`Mockup for ${c.name}`}
                            value={c.mockupPath ?? ""}
                            onChange={(e) =>
                              void save(() =>
                                setChangeMockup(c.id, e.target.value || null),
                              )
                            }
                          >
                            <option value="">No picture</option>
                            {pictures.map((path) => (
                              <option key={path} value={path}>
                                {path.split(/[\\/]/).pop()}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                </div>
              )}

              {/* One box, three destinations: this Solution's plan, the detail
                  against each thing just ticked, and a new dated set on the
                  work item's development details. */}
              <div className="field">
                <span>What needs to change</span>
                <textarea
                  rows={3}
                  aria-label={`What needs to change in ${plan.solutionName}`}
                  placeholder="what has to happen to the things ticked above"
                  defaultValue={plan.changesRequired}
                  onBlur={(e) => void commitDetail(plan, e.target.value)}
                />
              </div>

              <div className="field">
                <span>Unit tests — what must be proved</span>
                <textarea
                  rows={2}
                  aria-label={`Unit tests for ${plan.solutionName}`}
                  defaultValue={plan.unitTests}
                  onBlur={(e) => void savePlan(plan, { unitTests: e.target.value })}
                />
              </div>

              <div className="plan-branch">
                <div className="field">
                  <span>Branch name</span>
                  <input
                    aria-label={`Branch name for ${plan.solutionName}`}
                    defaultValue={plan.branchName}
                    onBlur={(e) => void savePlan(plan, { branchName: e.target.value })}
                  />
                </div>
                <div className="field">
                  <span>Branch from</span>
                  <input
                    aria-label={`Clone from for ${plan.solutionName}`}
                    defaultValue={plan.cloneFrom}
                    onBlur={(e) => void savePlan(plan, { cloneFrom: e.target.value })}
                  />
                </div>
              </div>

              {draft.refused.length > 0 && (
                <ul className="change-refused" aria-label="Not recorded">
                  {draft.refused.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}

              {(plan.apiSchema || plan.pageSchema || plan.filesToChange) && (
                // <section>, not <div>: an aria-label on a div is not a region.
                <section
                  className="plan-generated"
                  aria-label={`Schemas for ${plan.solutionName}`}
                >
                  {[
                    ["API schema", plan.apiSchema],
                    ["Page schema", plan.pageSchema],
                    ["Files expected to change", plan.filesToChange],
                  ]
                    .filter(([, body]) => body !== "")
                    .map(([heading, body]) => (
                      <div key={heading}>
                        <span className="plan-generated-head">{heading}</span>
                        <pre>{body}</pre>
                      </div>
                    ))}
                </section>
              )}
            </div>
          );
        })}

      {/* Picking a Solution here attaches it — that is what "affected" means,
          and a ticklist whose only job was to make this block appear was a
          second place to say the same thing. */}
      {mode === "developer" && (
        <div className="change-block adding">
          <label>
            {plans.length === 0 ? "This changes" : "and also"}
            <select
              aria-label="Add a Solution to this work item"
              value={making ? MAKE_ONE : adding}
              onChange={(e) => {
                const picked = e.target.value;
                if (picked === MAKE_ONE) {
                  setMaking(true);
                  return;
                }
                setMaking(false);
                setAdding(picked === "" ? "" : Number(picked));
                if (picked !== "") void attach(Number(picked));
              }}
            >
              <option value="">Pick a Solution…</option>
              {unattached.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.solutionType})
                </option>
              ))}
              {/* Making one is the answer often enough that it belongs in the
                  list of answers. */}
              {productId !== undefined && (
                <option value={MAKE_ONE}>＋ New Solution…</option>
              )}
            </select>
          </label>

          {making && productId !== undefined && (
            <NewSolutionForm
              productId={productId}
              onCreated={(id) => void afterCreated(id)}
              onCancel={() => setMaking(false)}
            />
          )}

          {known.length === 0 && !making && (
            <p className="hint">
              This Product has no Solutions yet — make one from the dropdown.
            </p>
          )}
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
            <span className="change-kind">{kindLabel(vocabulary, change.kind)}</span>
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
                  void save(() =>
                    assignWorkItemChange(
                      change.id,
                      e.target.value === "" ? null : Number(e.target.value),
                    ),
                  )
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

            <button
              aria-label={`Remove ${change.name}`}
              onClick={() => void save(() => deleteWorkItemChange(change.id))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
