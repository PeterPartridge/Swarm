---
spec: model
from: Swarmdb/Solution-model.json
deliverable:
depends-on: [Swarmdb/Product-model.json]
---
objective: A Solution created in the Develop tab — linked to a Product and filled in from the solution-spec questions (what kind of solution, its purpose, hosting, language, frameworks). [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: name — text, required — not empty; unique within its Product — The Solution's name [fields.entries.1]
field: productId — id / key, required — must reference a Product row — The Product this Solution belongs to [fields.entries.2]
field: solutionType — list, required, default application — one of: website / api / database / application — What kind of solution it is (same list as the framework's solution spec) [fields.entries.3]
field: answers — text, required, default {} — valid JSON keyed by solution-spec question ids (purpose, hosting, language, frameworks) — The developer's plain-English solution-spec answers [fields.entries.4]
field: origin — list, required, default created — one of: created / imported — Whether we created this Solution's repository or imported (linked) an existing one [fields.entries.5]
field: githubUrl — text, optional — the repository's web URL when one is linked — The GitHub repository linked to this Solution [fields.entries.6]
field: githubVisibility — list, optional — one of: private / public; unknown (null) for imported repos — Whether the linked repository is private or public [fields.entries.7]
field: createdAt — date, required, default now — When the Solution was created [fields.entries.8]
field: updatedAt — date, required, default now — updated on every change — When the Solution last changed [fields.entries.9]
rel: productId — many-to-one to Product.id (FK_Solution_Product) [relationships.entries.0]
index: productId [lookupsAndPerformance.answer.0]
retention: Deleted with its Product, or when the user removes the Solution. [lifecycleAndRules.retention]
sensitive: No. The GitHub repository URL is not sensitive; the GitHub token that creates repositories is never stored in this table — it lives in the OS credential store, like the AI provider keys. [lifecycleAndRules.sensitiveFields]
invariant: A Solution always belongs to an existing Product; solutionType stays in its list; answers always parses as JSON; origin is 'created' or 'imported', and githubVisibility (when set) is 'private' or 'public'. [lifecycleAndRules.invariants]
> The brief's change rounds record why the model changed; the fields above are
> its answers as they stand, and the rounds are not restated.

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — Solution (database model)

> Produced by `/translate` from [`../../Swarmdb/Solution-model.json`](../../Swarmdb/Solution-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A Solution created in the Develop tab, linked to a Product and filled from the solution-spec questions. Distinct from SolutionManagement (file tracking for the Creation Page).

**Depends on**
- `Swarmdb/Product-model.json`

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

**Technical debt:** the migration detects a round-1 table by the missing `origin` column and **drops and recreates** it — the pre-release pattern used across this DB, and the standing debt to replace with data-preserving migrations before real use. The GitHub token is deliberately absent from this table (OS credential store only); see `Swarm/solutionCreation.md` round 2 for the integration's debt list.
