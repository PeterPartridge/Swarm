---
spec: model
from: Swarmdb/Strategy-model.json
deliverable:
depends-on: [Swarmdb/Product-model.json]
---
objective: One structured strategy document per (Product, area). area = product / develop / test; content is JSON of that section's named fields (vision/goals for product; infrastructure/architecture for develop; plans/tooling for test). [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: productId — id / key, required — must reference a Product row — The Product this strategy belongs to [fields.entries.1]
field: area — list, required, default product — one of: product / develop / test — Which area's strategy this is [fields.entries.2]
field: content — text, required, default {} — valid JSON of the area's named fields — The structured strategy fields [fields.entries.3]
field: updatedAt — date, required, default now — updated on every save — When it last changed [fields.entries.4]
rel: productId — many-to-one to Product.id (FK_Strategy_Product) [relationships.entries.0]
index: productId [lookupsAndPerformance.answer.0]
index: area [lookupsAndPerformance.answer.1]
retention: One row per (product, area), replaced on save; deleted with its Product. [lifecycleAndRules.retention]
sensitive: No. [lifecycleAndRules.sensitiveFields]
invariant: One row per (product, area); area in its list; content always parses as JSON. [lifecycleAndRules.invariants]

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — Strategy (database model)

> Produced by `/translate` from [`../../Swarmdb/Strategy-model.json`](../../Swarmdb/Strategy-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
One structured strategy document per (Product, area: product/develop/test); `content` is JSON of that section's named fields.

**Depends on**
- `Swarmdb/Product-model.json`

**Data to store**
id · productId FK · area (product/develop/test) · content (valid JSON) · updatedAt; one row per (product, area).

**Invariants / tests**
- [x] Unset → "{}"; save replaces the area's document.
- [x] Bad area / non-JSON rejected.

**Status:** built (2026-07-17) — the Product-area strategy is wired to the Product Strategy section; the develop/test areas exist in the model and land with the developer-technical-strategy and testing-strategy follow-ups.

## Report back
`src-tauri/src/db/strategy.rs` (get/save, UNIQUE(productId, area)) + `commands/strategy.rs`. 4 cargo tests. Frontend `ProductStrategy.tsx` uses area `product`.

**Technical debt:** the field shape per area is app-defined (not enforced beyond valid-JSON) — the develop/test structured fields formalise in their own rounds.
