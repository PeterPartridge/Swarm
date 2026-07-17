# Page Spec — Role (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/Role-model.json`](../../CoperativeAIdb/Role-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

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
