# Page Spec — Strategy (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/Strategy-model.json`](../../CoperativeAIdb/Strategy-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
One structured strategy document per (Product, area: product/develop/test); `content` is JSON of that section's named fields.

**Depends on**
- `CoperativeAIdb/Product-model.json`

**Data to store**
id · productId FK · area (product/develop/test) · content (valid JSON) · updatedAt; one row per (product, area).

**Invariants / tests**
- [x] Unset → "{}"; save replaces the area's document.
- [x] Bad area / non-JSON rejected.

**Status:** built (2026-07-17) — the Product-area strategy is wired to the Product Strategy section; the develop/test areas exist in the model and land with the developer-technical-strategy and testing-strategy follow-ups.

## Report back
`src-tauri/src/db/strategy.rs` (get/save, UNIQUE(productId, area)) + `commands/strategy.rs`. 4 cargo tests. Frontend `ProductStrategy.tsx` uses area `product`.

**Technical debt:** the field shape per area is app-defined (not enforced beyond valid-JSON) — the develop/test structured fields formalise in their own rounds.
