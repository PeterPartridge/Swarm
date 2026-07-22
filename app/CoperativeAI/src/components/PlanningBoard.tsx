import { useCallback, useEffect, useState, type FormEvent } from "react";
import AiQuestions from "./AiQuestions";
import WorkItemChanges from "./WorkItemChanges";
import PolicyEditor from "./PolicyEditor";
import { usePermissions } from "../lib/permissions";
import HandoverPanel from "./HandoverPanel";
import {
  createWorkItem,
  deleteWorkItem,
  generateUserStories,
  getPlanningHierarchy,
  listDeliverables,
  listSprints,
  listSolutions,
  listTeamMembers,
  listWorkItems,
  listWorkItemLinks,
  linkWorkItems,
  unlinkWorkItems,
  updateWorkItem,
  updateWorkItemStatus,
  ANY_LEVEL_TYPES,
  STATUSES,
  TYPE_LABELS,
  WORK_ITEM_LINK_KINDS,
  type Deliverable,
  type Solution,
  type Sprint,
  type TeamMember,
  type WorkItem,
  type WorkItemLink,
  type WorkItemLinkKind,
} from "../lib/backend";

interface PlanningBoardProps {
  productId: number;
}

function childTypes(hierarchy: string[], parentType: string | null): string[] {
  const anyLevel = [...ANY_LEVEL_TYPES];
  if (parentType === null) return [...hierarchy, ...anyLevel];
  const parentIndex = hierarchy.indexOf(parentType);
  if (parentIndex === -1) return anyLevel;
  return [...hierarchy.slice(parentIndex + 1), ...anyLevel];
}

/** A blank WorkItem for optimistic inserts — shown instantly, then replaced
 *  by the reconciled server row. */
function optimisticItem(
  id: number,
  title: string,
  itemType: string,
  productId: number,
  parentItemId: number | null,
): WorkItem {
  return {
    id,
    title,
    itemType,
    status: "planned",
    description: null,
    productId,
    parentItemId,
    assigneeId: null,
    sprintId: null,
    startDate: null,
    endDate: null,
    deliverableId: null,
    expectedCost: null,
    estimatedProfit: null,
    chargeable: false,
    customerCoverPct: null,
    risk: "",
    solutionId: null,
  };
}

const LINK_LABELS: Record<WorkItemLinkKind, string> = {
  blocks: "blocks",
  relatesTo: "relates to",
};

/** What a work item waits on and what waits on it. Two items in different
 *  Solutions are a cross-repo dependency, which is the case worth spotting —
 *  so it is labelled rather than left for the reader to work out. */
function WorkItemDependencies({
  item,
  items,
  links,
  solutionOf,
  isCrossRepo,
  open,
  onOpen,
  onLink,
  onUnlink,
}: {
  item: WorkItem;
  items: WorkItem[];
  links: WorkItemLink[];
  solutionOf: (id: number | null) => Solution | undefined;
  isCrossRepo: (link: WorkItemLink) => boolean;
  open: boolean;
  onOpen: () => void;
  onLink: (toWorkItemId: number, kind: WorkItemLinkKind) => void;
  onUnlink: (id: number) => void;
}) {
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<WorkItemLinkKind>("blocks");

  const outgoing = links.filter((l) => l.fromWorkItemId === item.id);
  const incoming = links.filter((l) => l.toWorkItemId === item.id);
  const titleOf = (id: number) => items.find((i) => i.id === id)?.title ?? `#${id}`;
  const candidates = items.filter(
    (other) =>
      other.id !== item.id &&
      other.id > 0 &&
      !outgoing.some((l) => l.toWorkItemId === other.id && l.kind === kind),
  );

  function describe(link: WorkItemLink, otherId: number) {
    const other = solutionOf(items.find((i) => i.id === otherId)?.solutionId ?? null);
    return isCrossRepo(link) && other ? ` (in ${other.name})` : "";
  }

  return (
    <section className="card-dependencies" aria-label={`Dependencies of ${item.title}`}>
      {outgoing.length + incoming.length > 0 && (
        <ul>
          {outgoing.map((l) => (
            <li key={l.id} className={isCrossRepo(l) ? "cross-repo" : ""}>
              <span>
                {LINK_LABELS[l.kind]} {titleOf(l.toWorkItemId)}
                {describe(l, l.toWorkItemId)}
              </span>
              <button
                aria-label={`Remove dependency on ${titleOf(l.toWorkItemId)} from ${item.title}`}
                onClick={() => onUnlink(l.id)}
              >
                ×
              </button>
            </li>
          ))}
          {/* What waits on you matters as much as what you wait on, but it is
              not yours to remove — the other item owns that link. */}
          {incoming.map((l) => (
            <li key={l.id} className={isCrossRepo(l) ? "cross-repo" : ""}>
              <span className="incoming">
                {titleOf(l.fromWorkItemId)} {LINK_LABELS[l.kind]} this
                {describe(l, l.fromWorkItemId)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button aria-label={`Add dependency to ${item.title}`} onClick={onOpen}>
        {open ? "Cancel" : "Add dependency"}
      </button>
      {open && (
        <div className="dependency-form">
          <select
            aria-label={`Dependency kind for ${item.title}`}
            value={kind}
            onChange={(e) => setKind(e.target.value as WorkItemLinkKind)}
          >
            {WORK_ITEM_LINK_KINDS.map((k) => (
              <option key={k} value={k}>
                {LINK_LABELS[k]}
              </option>
            ))}
          </select>
          <select
            aria-label={`Dependency target for ${item.title}`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Choose a work item</option>
            {candidates.map((c) => {
              const s = solutionOf(c.solutionId);
              return (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {s ? ` — ${s.name}` : ""}
                </option>
              );
            })}
          </select>
          <button
            aria-label={`Save dependency for ${item.title}`}
            disabled={target === ""}
            onClick={() => {
              onLink(Number(target), kind);
              setTarget("");
            }}
          >
            Link
          </button>
        </div>
      )}
    </section>
  );
}

export default function PlanningBoard({ productId }: PlanningBoardProps) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [hierarchy, setHierarchy] = useState<string[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [links, setLinks] = useState<WorkItemLink[]>([]);
  const [linkFrom, setLinkFrom] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [itemType, setItemType] = useState<string>("");
  const [subItemParent, setSubItemParent] = useState<number | null>(null);
  const [subTitle, setSubTitle] = useState("");
  const [subType, setSubType] = useState<string>("");
  const [policyItem, setPolicyItem] = useState<number | null>(null);
  const [screensItem, setScreensItem] = useState<number | null>(null);
  const { canSeeField } = usePermissions();

  const refresh = useCallback(async () => {
    try {
      const [
        loadedItems,
        loadedHierarchy,
        loadedMembers,
        loadedSprints,
        loadedDeliverables,
        loadedSolutions,
        loadedLinks,
      ] = await Promise.all([
        listWorkItems(productId),
        getPlanningHierarchy(),
        listTeamMembers(),
        listSprints(productId),
        listDeliverables(productId),
        listSolutions(),
        listWorkItemLinks(productId),
      ]);
      setItems(loadedItems);
      setHierarchy(loadedHierarchy);
      setMembers(loadedMembers);
      setSprints(loadedSprints);
      setDeliverables(loadedDeliverables);
      // Solutions are listed app-wide; work can only land in one of its own
      // Product's, and the backend refuses anything else.
      setSolutions(loadedSolutions.filter((s) => s.productId === productId));
      setLinks(loadedLinks);
      setItemType((t) => (t === "" ? loadedHierarchy[0] : t));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

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

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || !itemType) return;
    // Optimistic: show the card immediately, then reconcile with the server.
    const temp = optimisticItem(-Date.now(), t, itemType, productId, null);
    setItems((prev) => [...prev, temp]);
    setTitle("");
    try {
      await createWorkItem({ title: t, itemType, productId });
      await refresh();
    } catch (err) {
      setError(String(err));
      setItems((prev) => prev.filter((i) => i.id !== temp.id));
    }
  }

  async function onCreateSubItem(e: FormEvent, parent: WorkItem) {
    e.preventDefault();
    const t = subTitle.trim();
    if (!t || !subType) return;
    const temp = optimisticItem(-Date.now(), t, subType, productId, parent.id);
    setItems((prev) => [...prev, temp]);
    setSubItemParent(null);
    setSubTitle("");
    setSubType("");
    try {
      await createWorkItem({ title: t, itemType: subType, productId, parentItemId: parent.id });
      await refresh();
    } catch (err) {
      setError(String(err));
      setItems((prev) => prev.filter((i) => i.id !== temp.id));
    }
  }

  async function onGenerateStories(item: WorkItem) {
    setNotice(`Asking the AI to write user stories for "${item.title}"…`);
    try {
      const result = await generateUserStories(item.id);
      if (result.blocked) {
        // Not a failure — the AI declining a vague item is the framework
        // working. The question is now on the card, waiting for an answer.
        setNotice(
          `The AI stopped rather than guessing at "${item.title}": ` +
            `${result.blocked.reason} Answer its question on the card to try again.`,
        );
        await refresh();
        return;
      }
      const n = result.created.length;
      setNotice(
        `AI created ${n} user ${n === 1 ? "story" : "stories"} under "${item.title}" ` +
          `(${result.provider} · ${result.reason}).`,
      );
      await refresh();
    } catch (e) {
      setNotice(String(e));
    }
  }

  /** Save an edit to a work item, preserving its other fields. */
  function commit(item: WorkItem, changes: Partial<WorkItem>) {
    const m = { ...item, ...changes };
    return run(() =>
      updateWorkItem({
        id: item.id,
        assigneeId: m.assigneeId,
        sprintId: m.sprintId,
        startDate: m.startDate,
        endDate: m.endDate,
        deliverableId: m.deliverableId,
        expectedCost: m.expectedCost,
        estimatedProfit: m.estimatedProfit,
        chargeable: m.chargeable,
        customerCoverPct: m.customerCoverPct,
        risk: m.risk,
        solutionId: m.solutionId,
      }),
    );
  }

  const numberOrNull = (v: string): number | null =>
    v.trim() === "" ? null : Number(v);

  const solutionOf = (id: number | null) =>
    solutions.find((s) => s.id === id);
  const itemById = (id: number) => items.find((i) => i.id === id);

  /** A link is cross-repo when the two items sit in different Solutions, and
   *  so in different repositories. Derived, never stored — one fact, held once. */
  function isCrossRepo(link: WorkItemLink): boolean {
    const from = itemById(link.fromWorkItemId)?.solutionId ?? null;
    const to = itemById(link.toWorkItemId)?.solutionId ?? null;
    return from !== null && to !== null && from !== to;
  }

  const showAiButton = hierarchy.includes("userStory");
  const showCommercial =
    canSeeField("cost") || canSeeField("profit") || canSeeField("chargeable");
  const parentTitle = (item: WorkItem) =>
    items.find((p) => p.id === item.parentItemId)?.title;

  return (
    <div className="planning-board">
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <form onSubmit={onCreate} aria-label="Create work item">
        <input
          aria-label="Title"
          placeholder="What needs doing?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select aria-label="Type" value={itemType} onChange={(e) => setItemType(e.target.value)}>
          {childTypes(hierarchy, null).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
        <button type="submit">Create</button>
      </form>

      <div className="board">
        {STATUSES.map((status) => (
          <section key={status} className="board-column" aria-label={status}>
            <h2>{status}</h2>
            {items
              .filter((item) => item.status === status)
              .map((item) => (
                <article key={item.id} className={`card type-${item.itemType}`} aria-label={item.title}>
                  <span className="card-type">{TYPE_LABELS[item.itemType] ?? item.itemType}</span>
                  <strong>{item.title}</strong>
                  {item.parentItemId !== null && (
                    <span className="card-parent">in {parentTitle(item)}</span>
                  )}
                  <select
                    aria-label={`Status of ${item.title}`}
                    value={item.status}
                    onChange={(e) => run(() => updateWorkItemStatus(item.id, e.target.value))}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Assignee of ${item.title}`}
                    value={item.assigneeId ?? ""}
                    onChange={(e) =>
                      commit(item, { assigneeId: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Sprint of ${item.title}`}
                    value={item.sprintId ?? ""}
                    onChange={(e) =>
                      commit(item, { sprintId: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  >
                    <option value="">No sprint</option>
                    {sprints.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Deliverable of ${item.title}`}
                    value={item.deliverableId ?? ""}
                    onChange={(e) =>
                      commit(item, { deliverableId: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  >
                    <option value="">No deliverable</option>
                    {deliverables.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  {solutions.length > 0 && (
                    <select
                      aria-label={`Solution of ${item.title}`}
                      value={item.solutionId ?? ""}
                      onChange={(e) =>
                        commit(item, {
                          solutionId: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    >
                      {/* Plenty of work is not code, so no Solution is a real answer. */}
                      <option value="">No Solution</option>
                      {solutions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}

                  <div className="field card-risk">
                    <span>Risk</span>
                    <textarea
                      rows={2}
                      aria-label={`Risk of ${item.title}`}
                      placeholder="What could go wrong?"
                      defaultValue={item.risk}
                      onBlur={(e) => commit(item, { risk: e.target.value })}
                    />
                  </div>

                  {/* Only work that has somewhere to land can be handed over. */}
                  {item.solutionId !== null && <HandoverPanel item={item} />}

                  <WorkItemDependencies
                    item={item}
                    items={items}
                    links={links}
                    solutionOf={solutionOf}
                    isCrossRepo={isCrossRepo}
                    open={linkFrom === item.id}
                    onOpen={() => setLinkFrom(linkFrom === item.id ? null : item.id)}
                    onLink={(to, kind) =>
                      run(async () => {
                        await linkWorkItems(item.id, to, kind);
                        setLinkFrom(null);
                      })
                    }
                    onUnlink={(id) => run(() => unlinkWorkItems(id))}
                  />

                  {showCommercial && (
                    <div className="card-commercial">
                      {canSeeField("cost") && (
                        <label>
                          Cost
                          <input
                            type="number"
                            aria-label={`Expected cost of ${item.title}`}
                            defaultValue={item.expectedCost ?? ""}
                            onBlur={(e) => commit(item, { expectedCost: numberOrNull(e.target.value) })}
                          />
                        </label>
                      )}
                      {canSeeField("profit") && (
                        <label>
                          Profit
                          <input
                            type="number"
                            aria-label={`Estimated profit of ${item.title}`}
                            defaultValue={item.estimatedProfit ?? ""}
                            onBlur={(e) => commit(item, { estimatedProfit: numberOrNull(e.target.value) })}
                          />
                        </label>
                      )}
                      {canSeeField("chargeable") && (
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`Chargeable: ${item.title}`}
                            checked={item.chargeable}
                            onChange={(e) => commit(item, { chargeable: e.target.checked })}
                          />
                          Chargeable to customer
                        </label>
                      )}
                      {canSeeField("chargeable") && item.chargeable && (
                        <label>
                          % covered
                          <input
                            type="number"
                            aria-label={`Customer cover percent of ${item.title}`}
                            defaultValue={item.customerCoverPct ?? ""}
                            onBlur={(e) => commit(item, { customerCoverPct: numberOrNull(e.target.value) })}
                          />
                        </label>
                      )}
                    </div>
                  )}

                  {childTypes(hierarchy, item.itemType).length > 0 && (
                    <button
                      aria-label={`Add sub-item to ${item.title}`}
                      onClick={() => {
                        setSubItemParent(item.id);
                        setSubType(childTypes(hierarchy, item.itemType)[0]);
                      }}
                    >
                      Add sub-item
                    </button>
                  )}
                  {showAiButton && item.itemType === "feature" && (
                    <button
                      aria-label={`AI: create user stories for ${item.title}`}
                      onClick={() => onGenerateStories(item)}
                    >
                      AI: create user stories
                    </button>
                  )}
                  <button
                    aria-label={`AI policy for ${item.title}`}
                    onClick={() => setPolicyItem(policyItem === item.id ? null : item.id)}
                  >
                    AI policy
                  </button>
                  <button
                    aria-label={`Delete ${item.title}`}
                    onClick={() => run(() => deleteWorkItem(item.id))}
                  >
                    Delete
                  </button>
                  <button
                    aria-label={`Screens for ${item.title}`}
                    onClick={() =>
                      setScreensItem(screensItem === item.id ? null : item.id)
                    }
                  >
                    Screens
                  </button>
                  {policyItem === item.id && (
                    <PolicyEditor
                      workItemId={item.id}
                      itemTitle={item.title}
                      onClose={() => setPolicyItem(null)}
                    />
                  )}
                  {/* Renders nothing unless the AI has asked something. */}
                  <AiQuestions workItemId={item.id} />
                  {/* Product's half: the screens this work needs, recorded
                      before anyone knows which Solution grows them. */}
                  {screensItem === item.id && (
                    <WorkItemChanges workItemId={item.id} mode="product" solutions={[]} />
                  )}
                  {subItemParent === item.id && (
                    <form onSubmit={(e) => onCreateSubItem(e, item)} aria-label={`New sub-item of ${item.title}`}>
                      <input
                        aria-label="Sub-item title"
                        value={subTitle}
                        onChange={(e) => setSubTitle(e.target.value)}
                      />
                      <select aria-label="Sub-item type" value={subType} onChange={(e) => setSubType(e.target.value)}>
                        {childTypes(hierarchy, item.itemType).map((t) => (
                          <option key={t} value={t}>
                            {TYPE_LABELS[t] ?? t}
                          </option>
                        ))}
                      </select>
                      <button type="submit">Add</button>
                    </form>
                  )}
                </article>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
