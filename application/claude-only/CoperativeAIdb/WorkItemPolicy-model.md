# Page Spec — WorkItemPolicy (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/WorkItemPolicy-model.json`](../../CoperativeAIdb/WorkItemPolicy-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
The per-work-item AI policy: what the AI may do with the item, which provider, what effort. No row = nothing allowed (deny-by-default).

**Model & effort**
Most capable tier (Claude Fable 5), high effort — security-enforcing.

**Depends on**
- `CoperativeAIdb/WorkItem-model.json`
- `CoperativeAIdb/AIProvider-model.json`

**Data to store**

| Field | What it looks like |
|-------|---------------------|
| id | Unique identifier (auto). |
| workItemId | FK → WorkItem.id, unique (one policy per item). |
| allowRead / allowEdit / allowGenerateTests | Booleans, **all default false**. |
| providerId | Optional FK → AIProvider.id; null = no provider allowed. |
| effortTier | One of: low / medium / high (default low). |
| updatedAt | Timestamp, maintained on change. |

**Access & security**
Security-enforcing table: every AI call must check it first, through the single shared call path. Deleting a provider nulls (never bypasses) policies that referenced it.

**Tests**
- [ ] One policy per work item (unique workItemId).
- [ ] All allow flags default to false.
- [ ] Policy deleted with its work item.
- [ ] Provider deletion nulls providerId on referencing policies.

**Open questions**
- (none)

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| (covered by project skills) | Policy-gated AI call path reads this table. | Table + lookup query used by the shared gate. | No. |

---

## PLAN

**Summary:** Create the WorkItemPolicy table with deny-by-default defaults, uniqueness, FKs, and the provider-deletion null-out behaviour.

**Changes:**
- Schema + queries in `src-tauri/src/db/work_item_policy.rs`; TDD per the tests above.

**Expected technical debt:** none acceptable — this backs the enforcement path.

**Status:** translated — waiting for approval
