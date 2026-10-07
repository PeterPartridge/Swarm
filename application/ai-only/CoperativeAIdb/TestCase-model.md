# Page Spec — TestCase (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/TestCase-model.json`](../../CoperativeAIdb/TestCase-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A plain-English test scenario QA designs in the Test area, optionally associated with a Deliverable or a Work Item.

**Depends on**
- `CoperativeAIdb/Product-model.json`, `CoperativeAIdb/Deliverable-model.json`, `CoperativeAIdb/WorkItem-model.json`

**Data to store**
id · productId FK → Product · title (non-empty) · scenario (free text) · state (designed/implemented) · testPath (nullable) · deliverableId FK → Deliverable (nullable) · workItemId FK → WorkItem (nullable) · createdAt/updatedAt.

**Invariants / tests**
- [x] A new case defaults to `designed` with no test path.
- [x] Title and an existing Product are required.
- [x] A case can be associated with a Deliverable *or* a Work Item — or neither.
- [x] Associations must reference rows that exist.
- [x] Deleting the Deliverable or Work Item unlinks the case without deleting it.
- [x] Marking a case implemented records where the test lives.
- [x] Update rejects a bad state, an empty title, or an unknown id.
- [x] Delete removes only that case.

**Status:** built (2026-07-18)

## Report back
Implemented as `src-tauri/src/db/test_case.rs` with `commands/test_cases.rs` (list/create/update/delete + `TestCaseDto`). Association targets are validated in one shared `check_links` helper used by both create and update, so a case can never point at a missing row. `deliverable::delete` and `work_item::delete` were extended to unlink test cases, matching how deliverable deletion already treated work items.

**Why a dedicated model:** the QA Test Designer brief allowed scenarios to be stored as work items of type `test` linked by `parentItemId`, and left the decision to build time. A scenario now has to point at *either* a Deliverable *or* a Work Item, which `parentItemId` cannot express — so the model is its own table. Recorded here and in [`../CoperativeAI/qaTestDesigner.md`](../CoperativeAI/qaTestDesigner.md) round 2.

**Technical debt:**
- Nothing enforces that `deliverableId` and `workItemId` are mutually exclusive — the UI offers one picker across both, but the table allows both to be set.
- `testPath` is free text, unchecked against the filesystem or the Solution's linked repository.
- No index on `deliverableId` / `workItemId` yet; fine at current scale, worth revisiting with the other lookup fields.
