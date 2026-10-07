# Page Spec — Solution (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/Solution-model.json`](../../CoperativeAIdb/Solution-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A Solution created in the Develop tab, linked to a Product and filled from the solution-spec questions. Distinct from SolutionManagement (file tracking for the Creation Page).

**Depends on**
- `CoperativeAIdb/Product-model.json`

**Data to store**
id · name (non-empty, unique within its Product) · productId FK → Product · solutionType (website/api/database/application) · answers (JSON: purpose, hosting, language, frameworks) · **origin (created/imported)** · **githubUrl** · **githubVisibility (private/public, null when unknown)** · createdAt/updatedAt.

**Invariants / tests**
- [x] Requires an existing Product, a valid type, valid JSON answers.
- [x] Name unique per Product (same name under another Product is fine).
- [x] Deleting a Solution never touches the Product or its work items.
- [x] A new Solution defaults to origin `created` with no repository.
- [x] `set_github` links a repo and rejects an unknown origin or a missing Solution.
- [x] A round-1 table (no `origin`) migrates and the table is usable afterwards.

**Status:** built (2026-07-16), round 2 (2026-07-18)

## Report back
Implemented as `src-tauri/src/db/solution.rs` (composite UNIQUE(productId, name) + code validation) with cargo tests per the invariants. Command layer: `commands/solutions.rs` (list/create/delete).

## Round 2 — GitHub link fields
Added `origin`, `githubUrl`, `githubVisibility` plus `set_github()` and `find_by_id()`; the SELECT column list is now a single `SELECT` const shared by the list/find queries with one `row_to_solution` mapper, so a future column change touches one place. `SolutionDto` carries the three new fields to the frontend.

**Technical debt:** the migration detects a round-1 table by the missing `origin` column and **drops and recreates** it — the pre-release pattern used across this DB, and the standing debt to replace with data-preserving migrations before real use. The GitHub token is deliberately absent from this table (OS credential store only); see `CoperativeAI/solutionCreation.md` round 2 for the integration's debt list.
