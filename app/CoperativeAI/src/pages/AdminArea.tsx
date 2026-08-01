import { useCallback, useEffect, useState, type FormEvent } from "react";
import AiConcurrencySetting from "../components/ai/AiConcurrencySetting";
import AiSettings from "../components/ai/AiSettings";
import ClaudeSetup from "../components/ai/ClaudeSetup";
import GithubCard from "../components/product/GithubCard";
import ModelInstalls from "../components/ai/ModelInstalls";
import SshCard from "../components/product/SshCard";
import DeveloperRulesEditor from "../components/ai/DeveloperRulesEditor";
import ProductAiPolicy from "../components/ai/ProductAiPolicy";
import ThemeSetting from "../components/common/ThemeSetting";
import {
  addTeamMember,
  createRole,
  deleteRole,
  listProducts,
  listRoles,
  listTeamMembers,
  removeTeamMember,
  setMemberRole,
  updateRole,
  type Product,
  type Role,
  type TeamMember,
} from "../lib/backend";
import { usePermissions } from "../lib/permissions";

const AREA_FLAGS = [
  ["canProduct", "Product"],
  ["canDevelop", "Develop"],
  ["canTest", "Test"],
  ["canAdmin", "Admin"],
  // Screens inside the Product workspace with flags of their own — a
  // developer often needs Planning without campaign drafts.
  ["canMarketing", "Marketing"],
  ["canDesign", "Design"],
] as const;
const FIELD_FLAGS = [
  ["seeCost", "Cost"],
  ["seeProfit", "Profit"],
  ["seeChargeable", "Chargeable"],
  // Not a field, but it belongs beside them: seeing spend and setting the
  // budget are different powers, and this is where that line is drawn.
  ["canManageBudget", "Manage budget"],
] as const;

/** The four things anyone comes to this page for.
 *
 *  Sections rather than one scroll, and named for the errand rather than the
 *  model: somebody arrives wanting "the AI working" or "GitHub connected", not
 *  "provider rows" or "policies". Develop's own Settings tab folded in here —
 *  settings living in two places meant knowing which before you could look. */
const ADMIN_SECTIONS = [
  { id: "ai", label: "AI" },
  { id: "connections", label: "Connections" },
  { id: "people", label: "People" },
  { id: "appearance", label: "Appearance" },
] as const;

type AdminSection = (typeof ADMIN_SECTIONS)[number]["id"];

/** Admin: the AI, the connections, the people, and how it looks. Every setting
 *  in the app is on this page — including the ones that used to sit in Develop —
 *  because "where is that setting?" should have one answer. */
export default function AdminArea() {
  const [section, setSection] = useState<AdminSection>("ai");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [memberName, setMemberName] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  // Development policies are per-Product, so Admin has to say which one.
  const [products, setProducts] = useState<Product[]>([]);
  const [policyProduct, setPolicyProduct] = useState<number | "">("");
  const { reload: reloadPermissions } = usePermissions();

  const refresh = useCallback(async () => {
    try {
      const [loadedMembers, loadedRoles, loadedProducts] = await Promise.all([
        listTeamMembers(),
        listRoles(),
        listProducts(),
      ]);
      setMembers(loadedMembers);
      setRoles(loadedRoles);
      setProducts(loadedProducts);
      setPolicyProduct((cur) =>
        cur === "" && loadedProducts.length > 0 ? loadedProducts[0].id : cur,
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
      await reloadPermissions(); // a role/member change may change what you see
    } catch (e) {
      setError(String(e));
    }
  }

  async function onAddMember(e: FormEvent) {
    e.preventDefault();
    if (!memberName.trim()) return;
    await run(() => addTeamMember(memberName, null));
    setMemberName("");
  }

  async function onAddRole(e: FormEvent) {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    await run(() => createRole(newRoleName));
    setNewRoleName("");
  }

  const roleName = (id: number | null) =>
    id === null ? "(no role)" : roles.find((r) => r.id === id)?.name ?? "(unknown)";

  return (
    <div className="admin-area">
      {error && <p role="alert">{error}</p>}

      {/* Four sections rather than one long scroll. Everything that was in
          Develop → Settings is here too: settings were in two places, which
          meant knowing which before you could look. */}
      <nav role="tablist" aria-label="Settings sections" className="admin-tabs">
        {ADMIN_SECTIONS.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={section === s.id}
            className={section === s.id ? "view-active" : ""}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* One picker for every per-Product setting on this page, at the top
          rather than repeated inside each card. */}
      {section === "ai" && products.length > 0 && (
        <label className="develop-product-picker">
          Product
          <select
            aria-label="Policy product"
            value={policyProduct}
            onChange={(e) => setPolicyProduct(Number(e.target.value))}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {section === "ai" && (
        <>
          {/* Setting Claude up comes first: a policy permitting the AI to do
              something is no use until there is an AI it can reach. */}
          {policyProduct !== "" && <ClaudeSetup productId={Number(policyProduct)} />}
          <AiSettings />
          <ModelInstalls productId={policyProduct === "" ? null : Number(policyProduct)} />
          <AiConcurrencySetting />
          {products.length === 0 ? (
            <p className="hint">
              No Products yet — the per-Product AI policies appear once there is
              one.
            </p>
          ) : (
            policyProduct !== "" && (
              <>
                {/* Deny-by-default: what lets the AI read a Product and generate
                    its work, for Product, Development and Testing alike. Set by
                    Admin rather than by whoever is doing the planning. */}
                <ProductAiPolicy productId={Number(policyProduct)} />
                <DeveloperRulesEditor productId={Number(policyProduct)} />
              </>
            )
          )}
        </>
      )}

      {section === "connections" && (
        <>
          <GithubCard onChange={refresh} />
          <SshCard />
        </>
      )}

      {section === "appearance" && <ThemeSetting />}

      {section === "people" && (
        <>
      <section className="admin-card" aria-label="Team members">
        <h2>Team members</h2>
        <form onSubmit={onAddMember} aria-label="Add team member">
          <input
            aria-label="Member name"
            placeholder="Name"
            value={memberName}
            onChange={(e) => setMemberName(e.target.value)}
          />
          <button type="submit">Add member</button>
        </form>
        <ul>
          {members.map((m) => (
            <li key={m.id}>
              {m.name} — {roleName(m.roleId)}{" "}
              <select
                aria-label={`Role of ${m.name}`}
                value={m.roleId ?? ""}
                onChange={(e) =>
                  run(() =>
                    setMemberRole(m.id, e.target.value === "" ? null : Number(e.target.value)),
                  )
                }
              >
                <option value="">No role</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button aria-label={`Remove ${m.name}`} onClick={() => run(() => removeTeamMember(m.id))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-card" aria-label="Roles">
        <h2>Roles — access &amp; field visibility</h2>
        <form onSubmit={onAddRole} aria-label="Add role">
          <input
            aria-label="Role name"
            placeholder="New role name"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
          />
          <button type="submit">Add role</button>
        </form>
        <table className="roles-table">
          <thead>
            <tr>
              <th>Role</th>
              {AREA_FLAGS.map(([, label]) => (
                <th key={label}>{label}</th>
              ))}
              {FIELD_FLAGS.map(([, label]) => (
                <th key={label}>See {label}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id} aria-label={`Role ${role.name}`}>
                <td>{role.name}</td>
                {AREA_FLAGS.map(([flag, label]) => (
                  <td key={flag}>
                    <input
                      type="checkbox"
                      aria-label={`${role.name} ${label}`}
                      checked={role[flag]}
                      onChange={(e) =>
                        run(() => updateRole({ ...role, [flag]: e.target.checked }))
                      }
                    />
                  </td>
                ))}
                {FIELD_FLAGS.map(([flag, label]) => (
                  <td key={flag}>
                    <input
                      type="checkbox"
                      aria-label={`${role.name} see ${label}`}
                      checked={role[flag]}
                      onChange={(e) =>
                        run(() => updateRole({ ...role, [flag]: e.target.checked }))
                      }
                    />
                  </td>
                ))}
                <td>
                  {role.name !== "Admin" && (
                    <button
                      aria-label={`Delete role ${role.name}`}
                      onClick={() => run(() => deleteRole(role.id))}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
        </>
      )}
    </div>
  );
}
