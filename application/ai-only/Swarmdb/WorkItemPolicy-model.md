---
spec: model
from: Swarmdb/WorkItemPolicy-model.json
deliverable:
depends-on: [Swarmdb/WorkItem-model.json, Swarmdb/AIProvider-model.json]
---
objective: The per-work-item AI policy: what the AI may do with that item, which provider it may use, and at what effort — nothing is allowed without a row here (deny-by-default). [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: workItemId — id / key, required — unique; must reference a WorkItem row — The work item this policy governs (one policy per item) [fields.entries.1]
field: allowRead — true/false, required, default false — May the AI read this item's content [fields.entries.2]
field: allowEdit — true/false, required, default false — May the AI edit code for this item [fields.entries.3]
field: allowGenerateTests — true/false, required, default false — May the AI generate tests for this item [fields.entries.4]
field: providerId — id / key, optional — must reference an AIProvider row when set; when null, no provider is allowed — The only AI provider this item may be sent to [fields.entries.5]
field: effortTier — list, required, default low — one of: low / medium / high — The effort tier AI calls for this item use [fields.entries.6]
field: updatedAt — date, required, default now — updated on every change — When the policy last changed [fields.entries.7]
rel: workItemId — one-to-one to WorkItem.id (FK_WorkItemPolicy_WorkItem) [relationships.entries.0]
rel: providerId — many-to-one to AIProvider.id (FK_WorkItemPolicy_AIProvider) [relationships.entries.1]
index: workItemId [lookupsAndPerformance.answer.0]
retention: Deleted with its work item. [lifecycleAndRules.retention]
sensitive: No — but this table is security-enforcing: every AI call must check it first. [lifecycleAndRules.sensitiveFields]
invariant: One policy row per work item at most. A work item with no policy row, or a policy with allowRead = false, never has its content sent to any provider. Every flag defaults to false (deny-by-default). Deleting a provider must null out (not bypass) the providerId of policies that used it. [lifecycleAndRules.invariants]

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — WorkItemPolicy (database model)

> Produced by `/translate` from [`../../Swarmdb/WorkItemPolicy-model.json`](../../Swarmdb/WorkItemPolicy-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
The per-work-item AI policy: what the AI may do with the item, which provider, what effort. No row = nothing allowed (deny-by-default).

**Model & effort**
Most capable tier (Claude Fable 5), high effort — security-enforcing.

**Depends on**
- `Swarmdb/WorkItem-model.json`
- `Swarmdb/AIProvider-model.json`

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

**Status:** built. The brief is marked `built` and its methods are in [`../Code_map.md`](../Code_map.md), but no build report was appended to this spec. (Until the 2026-10-07 documentation review, this line still read "translated — waiting for approval".)
