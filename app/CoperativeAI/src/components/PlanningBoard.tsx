import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createWorkItem,
  deleteWorkItem,
  generateUserStories,
  getPlanningHierarchy,
  listSprints,
  listTeamMembers,
  listWorkItems,
  updateWorkItem,
  updateWorkItemStatus,
  ANY_LEVEL_TYPES,
  STATUSES,
  TYPE_LABELS,
  type Sprint,
  type TeamMember,
  type WorkItem,
} from "../lib/backend";

interface PlanningBoardProps {
  productId: number;
}

/** Types allowed under a parent: hierarchy levels deeper than the parent's,
 *  plus bug/test which attach anywhere. Top level offers every level. */
function childTypes(hierarchy: string[], parentType: string | null): string[] {
  const anyLevel = [...ANY_LEVEL_TYPES];
  if (parentType === null) return [...hierarchy, ...anyLevel];
  const parentIndex = hierarchy.indexOf(parentType);
  if (parentIndex === -1) return anyLevel;
  return [...hierarchy.slice(parentIndex + 1), ...anyLevel];
}

export default function PlanningBoard({ productId }: PlanningBoardProps) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [hierarchy, setHierarchy] = useState<string[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [itemType, setItemType] = useState<string>("");
  const [subItemParent, setSubItemParent] = useState<number | null>(null);
  const [subTitle, setSubTitle] = useState("");
  const [subType, setSubType] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      const [loadedItems, loadedHierarchy, loadedMembers, loadedSprints] =
        await Promise.all([
          listWorkItems(productId),
          getPlanningHierarchy(),
          listTeamMembers(),
          listSprints(productId),
        ]);
      setItems(loadedItems);
      setHierarchy(loadedHierarchy);
      setMembers(loadedMembers);
      setSprints(loadedSprints);
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
    if (!title.trim() || !itemType) return;
    await run(() => createWorkItem({ title, itemType, productId }));
    setTitle("");
  }

  async function onCreateSubItem(e: FormEvent, parent: WorkItem) {
    e.preventDefault();
    if (!subTitle.trim() || !subType) return;
    await run(() =>
      createWorkItem({
        title: subTitle,
        itemType: subType,
        productId,
        parentItemId: parent.id,
      }),
    );
    setSubItemParent(null);
    setSubTitle("");
    setSubType("");
  }

  async function onGenerateStories(item: WorkItem) {
    setNotice(null);
    try {
      await generateUserStories(item.id);
      await refresh();
    } catch (e) {
      setNotice(String(e));
    }
  }

  function schedule(item: WorkItem, changes: Partial<WorkItem>) {
    return run(() =>
      updateWorkItem({
        id: item.id,
        assigneeId: changes.assigneeId !== undefined ? changes.assigneeId : item.assigneeId,
        sprintId: changes.sprintId !== undefined ? changes.sprintId : item.sprintId,
        startDate: changes.startDate !== undefined ? changes.startDate : item.startDate,
        endDate: changes.endDate !== undefined ? changes.endDate : item.endDate,
      }),
    );
  }

  const showAiButton = hierarchy.includes("userStory");
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
        <select
          aria-label="Type"
          value={itemType}
          onChange={(e) => setItemType(e.target.value)}
        >
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
                <article
                  key={item.id}
                  className={`card type-${item.itemType}`}
                  aria-label={item.title}
                >
                  <span className="card-type">{TYPE_LABELS[item.itemType] ?? item.itemType}</span>
                  <strong>{item.title}</strong>
                  {item.parentItemId !== null && (
                    <span className="card-parent">in {parentTitle(item)}</span>
                  )}
                  <select
                    aria-label={`Status of ${item.title}`}
                    value={item.status}
                    onChange={(e) =>
                      run(() => updateWorkItemStatus(item.id, e.target.value))
                    }
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
                      schedule(item, {
                        assigneeId: e.target.value === "" ? null : Number(e.target.value),
                      })
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
                      schedule(item, {
                        sprintId: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  >
                    <option value="">No sprint</option>
                    {sprints.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
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
                    aria-label={`Delete ${item.title}`}
                    onClick={() => run(() => deleteWorkItem(item.id))}
                  >
                    Delete
                  </button>
                  {subItemParent === item.id && (
                    <form
                      onSubmit={(e) => onCreateSubItem(e, item)}
                      aria-label={`New sub-item of ${item.title}`}
                    >
                      <input
                        aria-label="Sub-item title"
                        value={subTitle}
                        onChange={(e) => setSubTitle(e.target.value)}
                      />
                      <select
                        aria-label="Sub-item type"
                        value={subType}
                        onChange={(e) => setSubType(e.target.value)}
                      >
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
