---
spec: model
from: Swarmdb/TestCase-model.json
deliverable:
depends-on: [Swarmdb/Product-model.json, Swarmdb/Deliverable-model.json, Swarmdb/WorkItem-model.json]
---
objective: A plain-English test scenario QA designs in the Test area, optionally associated with a Deliverable or a Work Item. [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: productId — id / key, required — must reference a Product row — The Product this test case belongs to [fields.entries.1]
field: title — text, required — not empty — What is being tested, in a few words [fields.entries.2]
field: scenario — text, required — The scenario in plain English (given / when / then welcome, not required) [fields.entries.3]
field: state — list, required, default designed — one of: designed / implemented — Whether a real test exists for this scenario yet [fields.entries.4]
field: testPath — text, optional — set when the state is implemented — Where the implemented test lives [fields.entries.5]
field: deliverableId — id / key, optional — must reference a Deliverable row when set — The Deliverable this test is associated with, if any [fields.entries.6]
field: workItemId — id / key, optional — must reference a work item row when set — The Work Item this test is associated with, if any [fields.entries.7]
field: createdAt — date, required, default now — When the test case was written [fields.entries.8]
field: updatedAt — date, required, default now — updated on every change — When the test case last changed [fields.entries.9]
rel: productId — many-to-one to Product.id (FK_TestCase_Product) [relationships.entries.0]
rel: deliverableId — many-to-one to Deliverable.id (FK_TestCase_Deliverable) [relationships.entries.1]
rel: workItemId — many-to-one to WorkItem.id (FK_TestCase_WorkItem) [relationships.entries.2]
index: productId [lookupsAndPerformance.answer.0]
index: deliverableId [lookupsAndPerformance.answer.1]
index: workItemId [lookupsAndPerformance.answer.2]
retention: Kept until QA deletes the test case. Deleting the Deliverable or Work Item it points at only unlinks it — the test itself survives, because it is still worth running. [lifecycleAndRules.retention]
sensitive: No. [lifecycleAndRules.sensitiveFields]
invariant: A test case always belongs to an existing Product and always has a title; state is 'designed' or 'implemented'; deliverableId and workItemId, when set, reference rows that exist. [lifecycleAndRules.invariants]

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — TestCase (database model)

> Produced by `/translate` from [`../../Swarmdb/TestCase-model.json`](../../Swarmdb/TestCase-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A plain-English test scenario QA designs in the Test area, optionally associated with a Deliverable or a Work Item.

**Depends on**
- `Swarmdb/Product-model.json`, `Swarmdb/Deliverable-model.json`, `Swarmdb/WorkItem-model.json`

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

**Why a dedicated model:** the QA Test Designer brief allowed scenarios to be stored as work items of type `test` linked by `parentItemId`, and left the decision to build time. A scenario now has to point at *either* a Deliverable *or* a Work Item, which `parentItemId` cannot express — so the model is its own table. Recorded here and in [`../Swarm/qaTestDesigner.md`](../Swarm/qaTestDesigner.md) round 2.

**Technical debt:**
- Nothing enforces that `deliverableId` and `workItemId` are mutually exclusive — the UI offers one picker across both, but the table allows both to be set.
- `testPath` is free text, unchecked against the filesystem or the Solution's linked repository.
- No index on `deliverableId` / `workItemId` yet; fine at current scale, worth revisiting with the other lookup fields.
