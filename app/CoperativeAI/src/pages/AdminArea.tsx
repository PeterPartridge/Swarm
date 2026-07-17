import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  addTeamMember,
  createRole,
  deleteRole,
  listRoles,
  listTeamMembers,
  removeTeamMember,
  setMemberRole,
  updateRole,
  type Role,
  type TeamMember,
} from "../lib/backend";
import { usePermissions } from "../lib/permissions";

const AREA_FLAGS = [
  ["canProduct", "Product"],
  ["canDevelop", "Develop"],
  ["canTest", "Test"],
  ["canAdmin", "Admin"],
] as const;
const FIELD_FLAGS = [
  ["seeCost", "Cost"],
  ["seeProfit", "Profit"],
  ["seeChargeable", "Chargeable"],
] as const;

/** Admin area: manage team members + their roles, and edit what each role can
 *  access (areas) and see (cost/profit/chargeable fields). */
export default function AdminArea() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [memberName, setMemberName] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const { reload: reloadPermissions } = usePermissions();

  const refresh = useCallback(async () => {
    try {
      const [loadedMembers, loadedRoles] = await Promise.all([
        listTeamMembers(),
        listRoles(),
      ]);
      setMembers(loadedMembers);
      setRoles(loadedRoles);
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
    </div>
  );
}
