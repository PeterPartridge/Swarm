---
spec: model
from: Swarmdb/Deliverable-model.json
deliverable:
depends-on: [Swarmdb/Product-model.json]
---
objective: A Product's strategy deliverable — work items group under it so work can be seen by what it delivers. [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: productId — id / key, required — must reference a Product row — The Product this deliverable belongs to [fields.entries.1]
field: name — text, required — not empty; unique within its Product — The deliverable's name [fields.entries.2]
field: description — text, required — What the deliverable is [fields.entries.3]
field: createdAt — date, required, default now — When it was created [fields.entries.4]
rel: productId — many-to-one to Product.id (FK_Deliverable_Product) [relationships.entries.0]
index: productId [lookupsAndPerformance.answer.0]
retention: Deleted with its Product, or when removed — removing a deliverable unlinks its work items (never deletes them). [lifecycleAndRules.retention]
sensitive: No. [lifecycleAndRules.sensitiveFields]
invariant: A deliverable belongs to an existing Product; name unique per Product. [lifecycleAndRules.invariants]

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — Deliverable (database model)

> Produced by `/translate` from [`../../Swarmdb/Deliverable-model.json`](../../Swarmdb/Deliverable-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A Product's strategy deliverable — work items group under it.

**Depends on**
- `Swarmdb/Product-model.json`

**Data to store**
id · productId FK · name (non-empty, unique per Product) · description · createdAt.

**Invariants / tests**
- [x] Requires an existing Product; name unique per Product.
- [x] Deleting a deliverable unlinks its work items (never deletes them).

**Status:** built (2026-07-17)

## Report back
`src-tauri/src/db/deliverable.rs` + `commands/deliverables.rs` (list-by-product/create/delete). WorkItem gained `deliverableId` (validated same-Product). 3 cargo tests. No debt.
