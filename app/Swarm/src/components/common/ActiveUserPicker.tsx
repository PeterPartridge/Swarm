import { useCallback, useEffect, useState } from "react";
import {
  getActiveMember,
  listTeamMembers,
  setActiveMember,
  type TeamMember,
} from "../../lib/backend";
import { usePermissions } from "../../lib/permissions";

/** "Working as…" — picks the active team member; their role gates the tabs
 *  and cost fields. Persisted; no passwords. */
export default function ActiveUserPicker() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [active, setActive] = useState<number | "">("");
  const { reload } = usePermissions();

  const refresh = useCallback(async () => {
    try {
      const [loadedMembers, activeId] = await Promise.all([
        listTeamMembers(),
        getActiveMember(),
      ]);
      setMembers(loadedMembers);
      setActive(activeId ?? "");
    } catch {
      // ignore outside Tauri
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onChange(value: string) {
    const id = value === "" ? null : Number(value);
    setActive(value === "" ? "" : Number(value));
    await setActiveMember(id);
    await reload();
  }

  const activeName =
    active === "" ? null : members.find((m) => m.id === active)?.name ?? null;

  return (
    <label className="active-user">
      {/* The avatar the redesign puts in the topbar. Who you are working as
          changes what the app shows, so it is worth seeing at a glance rather
          than reading out of a dropdown — but the dropdown stays, because
          switching member is the actual mechanism and it is not a login. */}
      <span className="active-user-avatar" aria-hidden="true">
        {initialsOf(activeName)}
      </span>
      <span className="active-user-label">Working as</span>
      <select
        aria-label="Working as"
        value={active}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Everyone (full access)</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Up to two initials — "Alex Chen" → "AC". Everyone (no member chosen) is a
 *  dot rather than letters, because there is no one to initial. */
function initialsOf(name: string | null): string {
  if (!name) return "•";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
