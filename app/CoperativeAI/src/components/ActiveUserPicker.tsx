import { useCallback, useEffect, useState } from "react";
import {
  getActiveMember,
  listTeamMembers,
  setActiveMember,
  type TeamMember,
} from "../lib/backend";
import { usePermissions } from "../lib/permissions";

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

  return (
    <label className="active-user">
      Working as
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
