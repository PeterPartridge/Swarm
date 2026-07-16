# Page Spec — Product (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/Product-model.json`](../../CoperativeAIdb/Product-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A Product being planned in the app — created from the Project_brief's Product questions; work items, sprints, feature designs, and Solutions all attach to one.

**Data to store**
id (auto) · name (unique, non-empty — the workspace title) · answers (JSON keyed by brief question ids: purpose, problem, users, appsYouLike, appsToAvoid, designs) · createdAt/updatedAt (millis).

**Invariants / tests**
- [x] name unique and non-empty; answers valid JSON.
- [x] Deleting a Product removes its work items (cascading their policies/designs), sprints, and solutions.

**Status:** built (2026-07-16)

## Report back
Implemented as `src-tauri/src/db/product.rs` (`create_table/create/list_all/find_by_id/delete`); delete cascades in code via `work_item::delete` per item then sprints/solutions/product. cargo tests: listing, name rules, JSON rule, full cascade. Command layer: `commands/products.rs` (list/create/get/delete).
