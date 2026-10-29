---
spec: model
from: Swarmdb/FeatureDesign-model.json
deliverable:
depends-on: [Swarmdb/WorkItem-model.json]
---
objective: A work item's drag-and-drop feature design: the blocks on the canvas (UI pieces, endpoints, data models), their positions, and the connections between them. [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: workItemId — id / key, required — unique; must reference a WorkItem row — The work item this design belongs to (one design per item) [fields.entries.1]
field: canvas — text, required, default {} — valid JSON — The design as JSON: blocks (type: ui / endpoint / model; name; description; x; y) and connections (fromBlock, toBlock) [fields.entries.2]
field: createdAt — date, required, default now — When the design was created [fields.entries.3]
field: updatedAt — date, required, default now — updated on every save — When the design was last saved [fields.entries.4]
rel: workItemId — one-to-one to WorkItem.id (FK_FeatureDesign_WorkItem) [relationships.entries.0]
index: workItemId [lookupsAndPerformance.answer.0]
retention: Deleted with its work item. [lifecycleAndRules.retention]
sensitive: No. [lifecycleAndRules.sensitiveFields]
invariant: One design per work item at most. The canvas field always parses as valid JSON; connections only reference blocks that exist in the same design. [lifecycleAndRules.invariants]

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — FeatureDesign (database model)

> Produced by `/translate` from [`../../Swarmdb/FeatureDesign-model.json`](../../Swarmdb/FeatureDesign-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A work item's drag-and-drop feature design: blocks (UI / endpoint / model), positions, and connections, stored as one JSON document.

**Model & effort**
Mid-range tier (Claude Sonnet 5), medium effort.

**Depends on**
- `Swarmdb/WorkItem-model.json`

**Data to store**

| Field | What it looks like |
|-------|---------------------|
| id | Unique identifier (auto). |
| workItemId | FK → WorkItem.id, unique (one design per item). |
| canvas | JSON text: blocks {type, name, description, x, y} + connections {fromBlock, toBlock}. Must always parse as valid JSON. |
| createdAt, updatedAt | Timestamps; updatedAt maintained on save. |

**Access & security**
Not sensitive.

**Tests**
- [ ] One design per work item (unique workItemId).
- [ ] Invalid JSON is rejected on save.
- [ ] Connections referencing missing blocks are rejected.
- [ ] Design deleted with its work item.

**Open questions**
- (none)

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| (covered by project skills) | Canvas persistence for the Feature Designer. | Table + validated save/load queries. | No. |

---

## PLAN

**Summary:** Create the FeatureDesign table with JSON validation on save and the one-design-per-item constraint.

**Changes:**
- Schema + save/load in `src-tauri/src/db/feature_design.rs`; TDD per the tests above.

**Expected technical debt:** canvas JSON shape is app-defined — document it beside the module.

**Status:** built. The brief is marked `built` and its methods are in [`../Code_map.md`](../Code_map.md), but no build report was appended to this spec. (Until the 2026-10-07 documentation review, this line still read "translated — waiting for approval".)
