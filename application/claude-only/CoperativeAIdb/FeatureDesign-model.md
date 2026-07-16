# Page Spec — FeatureDesign (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/FeatureDesign-model.json`](../../CoperativeAIdb/FeatureDesign-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A work item's drag-and-drop feature design: blocks (UI / endpoint / model), positions, and connections, stored as one JSON document.

**Model & effort**
Mid-range tier (Claude Sonnet 5), medium effort.

**Depends on**
- `CoperativeAIdb/WorkItem-model.json`

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

**Status:** translated — waiting for approval
