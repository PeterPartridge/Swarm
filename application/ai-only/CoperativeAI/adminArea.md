# Page Spec — Admin Area

> Produced by `/translate` from [`../../CoperativeAI/adminArea.md`](../../CoperativeAI/adminArea.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Assign team members roles and control what each role can access (Product/Develop/Test/Admin) and see (cost/profit/chargeable). No login — roles gate visibility only.

**Depends on**
- `CoperativeAI/workspaceShell.md`, `CoperativeAIdb/Role-model.json`, `CoperativeAIdb/TeamMember-model.json`

**Tests**
- [x] Members list + assign a role; roles add + flag toggles save (Vitest).
- [x] Admin role has no delete control; Developer does (Vitest); Admin can't be weakened (cargo).
- [x] The "Working as…" active-user picker drives tab + field visibility (permission-gate cargo + Vitest).

**Status:** built (2026-07-17)

## Report back
New 4th tab (own colour) via `WorkspaceShell.tsx` gating with `lib/permissions.tsx` (`PermissionProvider` + `usePermissions`, full-access safe default). `pages/AdminArea.tsx` (members + roles table), `components/ActiveUserPicker.tsx` ("Working as…" in the header, persisted via `set_active_member`). Team management moved here from Develop. Tabs hide when the active role lacks access; cost/profit/chargeable fields hide per role.

**Technical debt:** visibility is advisory (anyone can switch the active user); a role with `canAdmin=false` can still be re-granted access by switching to "Everyone" — acceptable for a single-user local tool.
