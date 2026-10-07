# Page Spec — Deliverable (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/Deliverable-model.json`](../../CoperativeAIdb/Deliverable-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A Product's strategy deliverable — work items group under it.

**Depends on**
- `CoperativeAIdb/Product-model.json`

**Data to store**
id · productId FK · name (non-empty, unique per Product) · description · createdAt.

**Invariants / tests**
- [x] Requires an existing Product; name unique per Product.
- [x] Deleting a deliverable unlinks its work items (never deletes them).

**Status:** built (2026-07-17)

## Report back
`src-tauri/src/db/deliverable.rs` + `commands/deliverables.rs` (list-by-product/create/delete). WorkItem gained `deliverableId` (validated same-Product). 3 cargo tests. No debt.
