# Page Spec — Solution (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/Solution-model.json`](../../CoperativeAIdb/Solution-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A Solution created in the Develop tab, linked to a Product and filled from the solution-spec questions. Distinct from SolutionManagement (file tracking for the Creation Page).

**Depends on**
- `CoperativeAIdb/Product-model.json`

**Data to store**
id · name (non-empty, unique within its Product) · productId FK → Product · solutionType (website/api/database/application) · answers (JSON: purpose, hosting, language, frameworks) · createdAt/updatedAt.

**Invariants / tests**
- [x] Requires an existing Product, a valid type, valid JSON answers.
- [x] Name unique per Product (same name under another Product is fine).
- [x] Deleting a Solution never touches the Product or its work items.

**Status:** built (2026-07-16)

## Report back
Implemented as `src-tauri/src/db/solution.rs` (composite UNIQUE(productId, name) + code validation) with cargo tests per the invariants. Command layer: `commands/solutions.rs` (list/create/delete).
