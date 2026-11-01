---
spec: model
from: Swarmdb/TeamMember-model.json
deliverable:
depends-on: []
---
objective: A team member set up in the Developer Area (Develop tab) — a name and role used to assign work items to people. Not a login: the app has no accounts. [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: name — text, required — unique; not empty — The team member's display name [fields.entries.1]
field: role — list, required, default Developer — one of: Developer / QA / Product / Designer — What the person does on the team [fields.entries.2]
field: createdAt — date, required, default now — When the member was added [fields.entries.3]
index: name [lookupsAndPerformance.answer.0]
retention: Until removed in the Developer Area. Removing a member clears (nulls) the assignee on their work items — never deletes the items. [lifecycleAndRules.retention]
sensitive: Only a display name — no contact details, no credentials. [lifecycleAndRules.sensitiveFields]
invariant: name is unique and non-empty; role stays in its list; removing a member never removes work. [lifecycleAndRules.invariants]
> The brief's change rounds record why the model changed; the fields above are
> its answers as they stand, and the rounds are not restated.

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — TeamMember (database model)

> Produced by `/translate` from [`../../Swarmdb/TeamMember-model.json`](../../Swarmdb/TeamMember-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

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
