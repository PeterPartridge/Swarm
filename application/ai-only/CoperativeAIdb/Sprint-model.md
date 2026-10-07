# Page Spec — Sprint (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/Sprint-model.json`](../../CoperativeAIdb/Sprint-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A Product's sprint — a named block of time work can be scheduled into. Dates are optional so teams that don't plan with times are supported.

**Depends on**
- `CoperativeAIdb/Product-model.json`

**Data to store**
id · productId FK → Product · name (non-empty, unique per Product) · startDate/endDate (nullable millis; end ≥ start when both set) · createdAt.

**Invariants / tests**
- [x] Requires an existing Product; name unique per Product; fully dateless sprints allowed.
- [x] end before start rejected.
- [x] Removing a sprint nulls sprintId on its items — never deletes them.

**Status:** built (2026-07-16)

## Report back
Implemented as `src-tauri/src/db/sprint.rs` with cargo tests per the invariants. Command layer: `commands/sprints.rs` (list-by-product/create/remove).
