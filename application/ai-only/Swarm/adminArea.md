---
spec: page
from: Swarm/adminArea.md
deliverable:
depends-on: ["workspaceShell.md", "Swarmdb/Role-model.json", "Swarmdb/TeamMember-model.json"]
---
objective: set the team up — give each team member a role, and decide which areas each role reaches and which commercial fields it sees; roles gate visibility only [why-exists]
model: mid-range model, medium effort [model-and-effort]
action: add and remove team members, and give each a role [actions]
action: add roles, and edit each role's area access and whether it sees cost, profit and chargeable [actions]
action: choose the active user through the header's "Working as…" picker; their role decides which tabs and cost fields show [actions]
look: a team-members card and a roles table — rows are roles, columns are the access and field-visibility toggles — in the Admin environment's own colour [look]
info: team members and their roles; roles and their permission flags [information]
access: anyone using the app; the Admin role can always reach this area [who-can-use]
store: roles — Swarmdb/Role-model.json; team members reference a role — Swarmdb/TeamMember-model.json; the active user is a system setting [data-stored]
store: the add forms' unsaved input, in memory only [in-memory]
check: C1 members are listed and can be given a role; roles can be added and their flags toggled [tests]
check: C2 the Admin role cannot be deleted or weakened [tests]
check: C3 changing the active user changes which tabs and cost fields the workspace shows [tests]
limit: gating is advisory visibility, not security — anyone can switch the active user [limits]
uses: Swarmdb Role and TeamMember models [data-stored]
> The brief's Part 4 change rounds have no question ID to cite, so what they
> add beyond the answers above is not translated here. Read them in the brief.

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — Admin Area

> Produced by `/translate` from [`../../Swarm/adminArea.md`](../../Swarm/adminArea.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Assign team members roles and control what each role can access (Product/Develop/Test/Admin) and see (cost/profit/chargeable). No login — roles gate visibility only.

**Depends on**
- `Swarm/workspaceShell.md`, `Swarmdb/Role-model.json`, `Swarmdb/TeamMember-model.json`

**Tests**
- [x] Members list + assign a role; roles add + flag toggles save (Vitest).
- [x] Admin role has no delete control; Developer does (Vitest); Admin can't be weakened (cargo).
- [x] The "Working as…" active-user picker drives tab + field visibility (permission-gate cargo + Vitest).

**Status:** built (2026-07-17)

## Report back
New 4th tab (own colour) via `WorkspaceShell.tsx` gating with `lib/permissions.tsx` (`PermissionProvider` + `usePermissions`, full-access safe default). `pages/AdminArea.tsx` (members + roles table), `components/ActiveUserPicker.tsx` ("Working as…" in the header, persisted via `set_active_member`). Team management moved here from Develop. Tabs hide when the active role lacks access; cost/profit/chargeable fields hide per role.

**Technical debt:** visibility is advisory (anyone can switch the active user); a role with `canAdmin=false` can still be re-granted access by switching to "Everyone" — acceptable for a single-user local tool.
