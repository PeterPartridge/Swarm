# Page Spec — TeamMember (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/TeamMember-model.json`](../../CoperativeAIdb/TeamMember-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A team member set up in the Developer Area — a name and role used to assign work items. Not a login (the app has no accounts).

**Data to store**
id · name (unique, non-empty) · role (Developer/QA/Product/Designer) · createdAt.

**Invariants / tests**
- [x] Name unique/non-empty; role restricted to its list.
- [x] Removing a member nulls the assignee on their work items — never deletes the items.

**Status:** built (2026-07-16)

## Report back
Implemented as `src-tauri/src/db/team_member.rs` with cargo tests per the invariants (including the unassign-not-delete rule). Command layer: `commands/team_members.rs` (list/add/remove).
