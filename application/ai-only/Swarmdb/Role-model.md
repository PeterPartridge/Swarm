---
spec: model
from: Swarmdb/Role-model.json
deliverable:
depends-on: []
---
objective: A permission-bearing role. In a no-login app it gates visibility (which areas/fields the active user sees), not security. Seeded with defaults, editable in Admin. [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: name — text, required — unique — Role name, e.g. Admin / Product / Developer / QA [fields.entries.1]
field: canProduct — true/false, required, default false — May access the Product area [fields.entries.2]
field: canDevelop — true/false, required, default false — May access the Develop area [fields.entries.3]
field: canTest — true/false, required, default false — May access the Test area [fields.entries.4]
field: canAdmin — true/false, required, default false — May access the Admin area [fields.entries.5]
field: seeCost — true/false, required, default false — May see the expected-cost field on work items [fields.entries.6]
field: seeProfit — true/false, required, default false — May see the estimated-profit field [fields.entries.7]
field: seeChargeable — true/false, required, default false — May see the chargeable / % customer-covers fields [fields.entries.8]
field: createdAt — date, required, default now — When the role was created [fields.entries.9]
index: name [lookupsAndPerformance.answer.0]
retention: Until removed in Admin; a role in use by a member can't be deleted. [lifecycleAndRules.retention]
sensitive: No — flags are visibility hints, not security. [lifecycleAndRules.sensitiveFields]
invariant: Four roles seeded on first run (Admin all-true, Product, Developer, QA). The Admin role can never be deleted or weakened, so a user can't lock themselves out. [lifecycleAndRules.invariants]

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — Role (database model)

> Produced by `/translate` from [`../../Swarmdb/Role-model.json`](../../Swarmdb/Role-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Permission-bearing roles. In a no-login app they gate visibility (areas + cost/profit/chargeable fields), not security. Seeded with defaults, editable in Admin.

**Data to store**
id · name (unique) · canProduct/canDevelop/canTest/canAdmin · seeCost/seeProfit/seeChargeable · createdAt.

**Invariants / tests**
- [x] Four roles seeded on first run (Admin all-true, Product, Developer, QA); seeding idempotent.
- [x] Admin role can't be deleted or weakened (never lock yourself out).
- [x] A role in use by a member can't be deleted.

**Status:** built (2026-07-17)

## Report back
`src-tauri/src/db/role.rs` (seeded in create_table, read-statements scoped before writes to avoid turso's lost-write trap) + `commands/roles.rs` (list/create/update/delete + active-member + `get_active_permissions`, the gate the shell reads). 5 cargo tests.

**Technical debt:** gating is advisory visibility, not enforced security (anyone can switch the active user) — documented and intended for the single-user local model.
