# Page Spec — WorkItem (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/WorkItem-model.json`](../../CoperativeAIdb/WorkItem-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A unit of planned work (feature / bug / test / spec) on the Product Planning board — the anchor for feature designs, AI policies, and QA scenarios.

**Model & effort**
Mid-range tier (Claude Sonnet 5), medium effort.

**Depends on**
- `CoperativeAIdb/Repository-model.json`

**Data to store**

| Field | What it looks like |
|-------|---------------------|
| id | Unique identifier (auto). |
| title | Text, not empty. |
| itemType | One of: feature / bug / test / spec (default feature). |
| status | One of: planned / designing / building / testing / done (default planned). |
| description | Optional text. |
| repositoryId | FK → Repository.id (required). |
| parentItemId | Optional FK → WorkItem.id (test scenarios under a feature). |
| createdAt, updatedAt | Timestamps; updatedAt maintained on change. |

**Access & security**
Not sensitive itself — but an item with no WorkItemPolicy row is completely closed to AI (deny-by-default invariant, enforced in the AI call path).

**Tests**
- [ ] Title/type/repository required.
- [ ] itemType and status restricted to their lists.
- [ ] FK to Repository and (when set) parent WorkItem enforced.
- [ ] updatedAt changes on update.

**Open questions**
- (none)

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| (covered by project skills) | Embedded db. | Table + queries in `src-tauri/src/db/work_item.rs`. | No. |

---

## PLAN

**Summary:** Create the WorkItem table and CRUD queries with list/status constraints and FKs; indexes on status, repositoryId, itemType, parentItemId.

**Changes:**
- Schema + CRUD in `src-tauri/src/db/work_item.rs`; TDD per the tests above.

**Expected technical debt:** none anticipated.

**Status:** translated — waiting for approval
