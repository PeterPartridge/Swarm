# Page Spec — WorkItem (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/WorkItem-model.json`](../../CoperativeAIdb/WorkItem-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest. **Round 2**: planning attaches to Products, not repositories.

**Objective** _(unchanging)_
A unit of planned work on a Product's board — epic, feature, user story, task, bug, or test — arranged in a hierarchy, optionally assigned and scheduled.

**Depends on**
- `CoperativeAIdb/Product-model.json`, `CoperativeAIdb/TeamMember-model.json`, `CoperativeAIdb/Sprint-model.json`

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
