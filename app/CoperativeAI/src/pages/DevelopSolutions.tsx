import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  addTeamMember,
  createSolution,
  deleteSolution,
  listProducts,
  listSolutions,
  listTeamMembers,
  removeTeamMember,
  SOLUTION_QUESTIONS,
  SOLUTION_TYPES,
  TEAM_ROLES,
  type Product,
  type Solution,
  type TeamMember,
} from "../lib/backend";

/** The Develop environment: the Developer Area's team list, and Solution
 *  creation linked to a Product. */
export default function DevelopSolutions() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [memberName, setMemberName] = useState("");
  const [memberRole, setMemberRole] = useState<string>(TEAM_ROLES[0]);

  const [solutionName, setSolutionName] = useState("");
  const [solutionProduct, setSolutionProduct] = useState<number | "">("");
  const [solutionType, setSolutionType] = useState<string>("application");
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const [loadedMembers, loadedProducts, loadedSolutions] = await Promise.all([
        listTeamMembers(),
        listProducts(),
        listSolutions(),
      ]);
      setMembers(loadedMembers);
      setProducts(loadedProducts);
      setSolutions(loadedSolutions);
      setSolutionProduct((current) =>
        current === "" && loadedProducts.length > 0 ? loadedProducts[0].id : current,
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

  async function onAddMember(e: FormEvent) {
    e.preventDefault();
    if (!memberName.trim()) return;
    await run(() => addTeamMember(memberName, memberRole));
    setMemberName("");
  }

  async function onCreateSolution(e: FormEvent) {
    e.preventDefault();
    if (!solutionName.trim() || solutionProduct === "") return;
    await run(() =>
      createSolution({
        name: solutionName,
        productId: Number(solutionProduct),
        solutionType,
        answers: JSON.stringify(answers),
      }),
    );
    setSolutionName("");
    setAnswers({});
  }

  const productName = (id: number) =>
    products.find((p) => p.id === id)?.name ?? `Product ${id}`;

  return (
    <div className="develop-area">
      {error && <p role="alert">{error}</p>}

      <section className="develop-card" aria-label="Developer Area">
        <h2>Developer Area — team</h2>
        <form onSubmit={onAddMember} aria-label="Add team member">
          <input
            aria-label="Member name"
            placeholder="Name"
            value={memberName}
            onChange={(e) => setMemberName(e.target.value)}
          />
          <select
            aria-label="Member role"
            value={memberRole}
            onChange={(e) => setMemberRole(e.target.value)}
          >
            {TEAM_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button type="submit">Add member</button>
        </form>
        <ul>
          {members.map((m) => (
            <li key={m.id}>
              {m.name} — {m.role}{" "}
              <button
                aria-label={`Remove ${m.name}`}
                onClick={() => run(() => removeTeamMember(m.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="develop-card" aria-label="Create a Solution">
        <h2>Create a Solution</h2>
        {products.length === 0 ? (
          <p>Solutions link to a Product — create a Product first (Product tab).</p>
        ) : (
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
            {SOLUTION_QUESTIONS.map((q) => (
              <label key={q.id}>
                {q.label}
                <textarea
                  value={answers[q.id] ?? ""}
                  onChange={(e) =>
                    setAnswers({ ...answers, [q.id]: e.target.value })
                  }
                />
              </label>
            ))}
            <button type="submit">Create Solution</button>
          </form>
        )}
        <ul>
          {solutions.map((s) => (
            <li key={s.id}>
              <strong>{s.name}</strong> ({s.solutionType}) — {productName(s.productId)}{" "}
              <button
                aria-label={`Delete solution ${s.name}`}
                onClick={() => run(() => deleteSolution(s.id))}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
