import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createWorkItem,
  deleteWorkItem,
  listRepositories,
  listWorkItems,
  updateWorkItemStatus,
  addRepository,
  ITEM_TYPES,
  STATUSES,
  type Repository,
  type WorkItem,
} from "../lib/backend";

export default function ProductPlanning() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [itemType, setItemType] = useState<string>(ITEM_TYPES[0]);
  const [repositoryId, setRepositoryId] = useState<number | "">("");
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoPath, setNewRepoPath] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [loadedItems, loadedRepos] = await Promise.all([
        listWorkItems(),
        listRepositories(),
      ]);
      setItems(loadedItems);
      setRepos(loadedRepos);
      setRepositoryId((current) =>
        current === "" && loadedRepos.length > 0 ? loadedRepos[0].id : current,
      );
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

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || repositoryId === "") return;
    await run(() =>
      createWorkItem({ title, itemType, repositoryId: Number(repositoryId) }),
    );
    setTitle("");
  }

  async function onAddRepository(e: FormEvent) {
    e.preventDefault();
    if (!newRepoName.trim() || !newRepoPath.trim()) return;
    await run(() => addRepository(newRepoName, newRepoPath));
    setNewRepoName("");
    setNewRepoPath("");
  }

  return (
    <div className="product-planning">
      {error && <p role="alert">{error}</p>}

      {repos.length === 0 ? (
        <form onSubmit={onAddRepository} aria-label="Register first repository">
          <p>
            Work items belong to a repository. Register your first repository
            to start planning (full repository management lives in Develop).
          </p>
          <label>
            Repository name
            <input
              value={newRepoName}
              onChange={(e) => setNewRepoName(e.target.value)}
            />
          </label>
          <label>
            Local folder
            <input
              value={newRepoPath}
              onChange={(e) => setNewRepoPath(e.target.value)}
            />
          </label>
          <button type="submit">Register repository</button>
        </form>
      ) : (
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
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            aria-label="Repository"
            value={repositoryId}
            onChange={(e) => setRepositoryId(Number(e.target.value))}
          >
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button type="submit">Create</button>
        </form>
      )}

      <div className="board">
        {STATUSES.map((status) => (
          <section key={status} className="board-column" aria-label={status}>
            <h2>{status}</h2>
            {items
              .filter((item) => item.status === status)
              .map((item) => (
                <article key={item.id} className="card" aria-label={item.title}>
                  <strong>{item.title}</strong>
                  <span className="card-type">{item.itemType}</span>
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
                  <button
                    aria-label={`Delete ${item.title}`}
                    onClick={() => run(() => deleteWorkItem(item.id))}
                  >
                    Delete
                  </button>
                </article>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
