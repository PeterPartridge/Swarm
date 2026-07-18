import { useCallback, useEffect, useState, type FormEvent } from "react";
import PolicyEditor from "./PolicyEditor";
import { usePermissions } from "../lib/permissions";
import {
  createWorkItem,
  deleteWorkItem,
  generateUserStories,
  getPlanningHierarchy,
  listDeliverables,
  listSprints,
  listTeamMembers,
  listWorkItems,
  updateWorkItem,
  updateWorkItemStatus,
  ANY_LEVEL_TYPES,
  STATUSES,
  TYPE_LABELS,
  type Deliverable,
  type Sprint,
  type TeamMember,
  type WorkItem,
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
  };
}

export default function PlanningBoard({ productId }: PlanningBoardProps) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [hierarchy, setHierarchy] = useState<string[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [itemType, setItemType] = useState<string>("");
  const [subItemParent, setSubItemParent] = useState<number | null>(null);
  const [subTitle, setSubTitle] = useState("");
  const [subType, setSubType] = useState<string>("");
  const [policyItem, setPolicyItem] = useState<number | null>(null);
  const { canSeeField } = usePermissions();

  const refresh = useCallback(async () => {
    try {
      const [loadedItems, loadedHierarchy, loadedMembers, loadedSprints, loadedDeliverables] =
        await Promise.all([
          listWorkItems(productId),
          getPlanningHierarchy(),
          listTeamMembers(),
          listSprints(productId),
          listDeliverables(productId),
        ]);
      setItems(loadedItems);
      setHierarchy(loadedHierarchy);
      setMembers(loadedMembers);
      setSprints(loadedSprints);
      setDeliverables(loadedDeliverables);
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
      }),
    );
  }

  const numberOrNull = (v: string): number | null =>
    v.trim() === "" ? null : Number(v);

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
                  {policyItem === item.id && (
                    <PolicyEditor
                      workItemId={item.id}
                      itemTitle={item.title}
                      onClose={() => setPolicyItem(null)}
                    />
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
