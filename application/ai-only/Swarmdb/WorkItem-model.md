---
spec: model
from: Swarmdb/WorkItem-model.json
deliverable:
depends-on: [Swarmdb/Product-model.json, Swarmdb/TeamMember-model.json, Swarmdb/Sprint-model.json]
---
objective: A unit of planned work on a Product's planning board — an epic, feature, user story, task, bug, or test — arranged in a hierarchy, optionally assigned to a team member and scheduled into a sprint or dates. [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: title — text, required — not empty — Short title of the work item [fields.entries.1]
field: itemType — list, required, default feature — one of: epic / feature / userStory / task / bug / test — What kind of work item this is. epic/feature/userStory/task form the planning hierarchy (which levels exist comes from the planningHierarchy setting); bug and test may attach at any level [fields.entries.2]
field: status — list, required, default planned — one of: planned / designing / building / testing / done — Where the item is in the workflow [fields.entries.3]
field: description — text, optional — Plain-English description of the work [fields.entries.4]
field: productId — id / key, required — must reference a Product row — The Product this work belongs to [fields.entries.5]
field: parentItemId — id / key, optional — must reference a WorkItem row when set; a hierarchy child's type must sit deeper in the active planning hierarchy than its parent's type (bug/test attach anywhere) — The parent work item [fields.entries.6]
field: assigneeId — id / key, optional — must reference a TeamMember row when set — The team member the work is assigned to [fields.entries.7]
field: sprintId — id / key, optional — must reference a Sprint row of the same Product when set — The sprint the item is scheduled into [fields.entries.8]
field: startDate — date, optional — Optional start date — teams that don't set times leave this empty [fields.entries.9]
field: endDate — date, optional — must not be before startDate when both are set — Optional target date [fields.entries.10]
field: risk — text, required — What could go wrong with this piece of work, in the planner's own words. Free text on purpose — a risk that has to be picked from a dropdown is a risk nobody writes down [fields.entries.11]
field: solutionId — id / key, optional — must reference a Solution of the same Product when set — The Solution this work touches, and so the repository it lands in. Nullable because plenty of work is not code [fields.entries.12]
field: createdAt — date, required, default now — When the item was created [fields.entries.13]
field: updatedAt — date, required, default now — updated on every change — When the item last changed [fields.entries.14]
rel: productId — many-to-one to Product.id (FK_WorkItem_Product) [relationships.entries.0]
rel: parentItemId — many-to-one to WorkItem.id (FK_WorkItem_Parent) [relationships.entries.1]
rel: assigneeId — many-to-one to TeamMember.id (FK_WorkItem_Assignee) [relationships.entries.2]
rel: sprintId — many-to-one to Sprint.id (FK_WorkItem_Sprint) [relationships.entries.3]
rel: solutionId — many-to-one to Solution.id (FK_WorkItem_Solution) [relationships.entries.4]
index: productId [lookupsAndPerformance.answer.0]
index: status [lookupsAndPerformance.answer.1]
index: itemType [lookupsAndPerformance.answer.2]
index: parentItemId [lookupsAndPerformance.answer.3]
index: sprintId [lookupsAndPerformance.answer.4]
index: assigneeId [lookupsAndPerformance.answer.5]
retention: Until the user deletes the item or its Product. Removing a team member or sprint clears the reference — never deletes the item. [lifecycleAndRules.retention]
sensitive: No. [lifecycleAndRules.sensitiveFields]
invariant: A work item always has a title, a type, and a Product. A hierarchy child sits deeper in the active planning hierarchy than its parent (bug/test attach anywhere). A work item with no WorkItemPolicy row is completely closed to AI (deny-by-default). Dates are optional; when both are set, endDate is not before startDate. [lifecycleAndRules.invariants]
> The brief's change rounds record why the model changed; the fields above are
> its answers as they stand, and the rounds are not restated.

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — WorkItem (database model)

> Produced by `/translate` from [`../../Swarmdb/WorkItem-model.json`](../../Swarmdb/WorkItem-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest. **Round 2**: planning attaches to Products, not repositories.

**Objective** _(unchanging)_
A unit of planned work on a Product's board — epic, feature, user story, task, bug, or test — arranged in a hierarchy, optionally assigned and scheduled.

**Depends on**
- `Swarmdb/Product-model.json`, `Swarmdb/TeamMember-model.json`, `Swarmdb/Sprint-model.json`

**Data to store**
id · title (non-empty) · itemType (epic/feature/userStory/task/bug/test) · status (planned/designing/building/testing/done) · description? · productId FK → Product · parentItemId? FK → WorkItem · assigneeId? FK → TeamMember · sprintId? FK → Sprint (same Product) · startDate?/endDate? (end ≥ start) · createdAt/updatedAt.

**Invariants / tests**
- [x] Title/type/Product required; types outside the active planning hierarchy rejected (bug/test always allowed).
- [x] Hierarchy children sit deeper than their parent (skipping levels downward allowed; upward/same-level rejected); sub-items stay in their parent's Product.
- [x] Assignee/sprint validated; a sprint must belong to the item's own Product; end-before-start rejected.
- [x] No policy row → closed to AI (deny-by-default, enforced by work_item_policy).
- [x] Round-2 migration: a legacy repositoryId table is dropped and recreated.

**Status:** built — round 2 (2026-07-16)

## Report back
Rewrote `src-tauri/src/db/work_item.rs`: productId + hierarchy invariant against `system_setting::get_planning_hierarchy`, `update_item` (assignee/sprint/dates), `list_by_product`, and a create_table migration that drops the legacy repository-based table (pre-release data; exercised at startup against a real old database file). 8 cargo tests cover the invariants above. Commands: create/list-by-product/update_status/update_item/delete + `generate_user_stories` (see productPlanning report-back).

**Technical debt:** migration is drop-and-recreate — acceptable only while pre-release; once real users exist, schema changes need proper data-preserving migrations. Noted as the standing pattern to replace.

## Round 8 — risk, and which repository the work lands in

**Behaviour:** a work item gains **`risk`** (free text) and **`solutionId`** (nullable FK → a Solution of the same Product). Dependencies between work items live in the new [`WorkItemLink`](WorkItemLink-model.md) table.

**Why free text for risk.** Every alternative considered — a severity dropdown, a likelihood/impact grid, a fixed category list — asks the planner to classify before they can record. A risk that has to be picked from a dropdown is a risk nobody writes down. The field takes whatever was typed and gives it back unchanged; a test asserts exactly that, including that emptying it clears it, because a risk that has passed must be removable.

**Why `solutionId` is nullable.** Plenty of planned work is not code. A required Solution would force a lie on every piece of copywriting, research and design on the board.

**The migration is the notable part.** Every other table in this project uses drop-and-recreate, which is honest pre-release: the app regenerates that data. Work items are different — they are a team's actual plan, the one thing in this database nobody could reconstruct. So these two columns are added with `ALTER TABLE ADD COLUMN` behind a `pragma_table_info` check, and a test drops the columns and re-runs `create_table` to prove an existing row survives.

**Tests:** cargo 276 (risk stored verbatim and clearable, Solution must belong to the item's own Product, unknown Solution rejected, existing rows survive the migration) + Vitest 99 (risk saves on blur; the Solution choice is hidden when the Product has none and lists only its own; dependency add/remove; a cross-repo dependency names the other repository; no crossing claimed when either side has no Solution; a refused blocking loop reaches the user).

**Technical debt:**
- **Risk is unstructured, so nothing can aggregate it.** No "show me every at-risk item", no severity sort, no rollup to the deliverable. That was the trade for getting it written down at all, and it is the right trade first — but a Product owner asking "what is at risk this sprint?" gets no answer from this field.
- **Risk commits on blur, like the cost fields.** No debounce and no undo: navigating away mid-sentence saves the half-sentence.
- The board loads every Solution in the app and filters client-side, because `list_solutions` takes no Product. Harmless at this size, wrong in principle — the filter belongs in the query.

**Found while writing this up:** `solution::delete` removed the row and left `work_items.solutionId` pointing at nothing. Fixed in the same round rather than filed — deleting a Solution now nulls the link, matching how deliverables already behave. The work still needs doing; it just no longer knows where it lands.
