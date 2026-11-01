---
spec: model
from: Swarmdb/Sprint-model.json
deliverable:
depends-on: [Swarmdb/Product-model.json]
---
objective: A sprint belonging to a Product — a named block of time work items can be scheduled into. Dates are optional: teams that don't plan with dates still get named sprints, and teams that don't use sprints at all simply never create one. [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: productId — id / key, required — must reference a Product row — The Product this sprint belongs to [fields.entries.1]
field: name — text, required — not empty; unique within its Product — The sprint's name, e.g. Sprint 1 [fields.entries.2]
field: startDate — date, optional — Optional start date [fields.entries.3]
field: endDate — date, optional — must not be before startDate when both are set — Optional end date [fields.entries.4]
field: createdAt — date, required, default now — When the sprint was created [fields.entries.5]
rel: productId — many-to-one to Product.id (FK_Sprint_Product) [relationships.entries.0]
index: productId [lookupsAndPerformance.answer.0]
retention: Deleted with its Product, or when the user removes the sprint — removing a sprint clears (nulls) the sprint on its work items, never deletes them. [lifecycleAndRules.retention]
sensitive: No. [lifecycleAndRules.sensitiveFields]
invariant: A sprint always belongs to an existing Product; when both dates are set, endDate is not before startDate; deleting a sprint never deletes work items. [lifecycleAndRules.invariants]

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — Sprint (database model)

> Produced by `/translate` from [`../../Swarmdb/Sprint-model.json`](../../Swarmdb/Sprint-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A Product's sprint — a named block of time work can be scheduled into. Dates are optional so teams that don't plan with times are supported.

**Depends on**
- `Swarmdb/Product-model.json`

**Data to store**
id · productId FK → Product · name (non-empty, unique per Product) · startDate/endDate (nullable millis; end ≥ start when both set) · createdAt.

**Invariants / tests**
- [x] Requires an existing Product; name unique per Product; fully dateless sprints allowed.
- [x] end before start rejected.
- [x] Removing a sprint nulls sprintId on its items — never deletes them.

**Status:** built (2026-07-16)

## Report back
Implemented as `src-tauri/src/db/sprint.rs` with cargo tests per the invariants. Command layer: `commands/sprints.rs` (list-by-product/create/remove).
