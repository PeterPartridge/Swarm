# Page Spec — Developer Area

> Produced by `/translate` from [`../../CoperativeAI/developerArea.md`](../../CoperativeAI/developerArea.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
The Develop tab's team list: add/remove team members (name + role) that Planning assigns work to. Names, not accounts — the app has no logins.

**Depends on**
- `CoperativeAI/workspaceShell.md`, `CoperativeAIdb/TeamMember-model.json`

**Tests**
- [x] Adding a member (name + role) shows them in the list (persisted via the TeamMember table).
- [x] Duplicate names rejected (backend rule, surfaced as the error alert).
- [x] Removing a member unassigns their items without deleting them (backend-tested; UI calls remove).

**Status:** built (2026-07-16)

## Report back
Implemented inside `src/pages/DevelopSolutions.tsx` (Developer Area section) over `commands/team_members.rs`. Vitest covers add (with role) and remove; the unassign-not-delete rule is enforced and tested at the db layer.
