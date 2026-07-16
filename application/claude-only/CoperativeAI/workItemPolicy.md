# Page Spec — Work Item AI Policy

> Produced by `/translate` from [`../../CoperativeAI/workItemPolicy.md`](../../CoperativeAI/workItemPolicy.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Per-work-item control of how the AI may use each item: allow/deny read, edit, and test generation; which provider; what effort. Nothing is allowed without an explicit policy (deny-by-default).

**Model & effort**
Most capable tier (Claude Fable 5), high effort — security-sensitive.

**Depends on**
- `CoperativeAI/productPlanning.md`
- `CoperativeAI/aiSettings.md`
- `CoperativeAIdb/WorkItemPolicy-model.json`

**Actions**

| User | Can do |
|------|--------|
| Developer | Open a work item's AI policy. |
| Developer | Allow/deny each AI use: read, edit code, generate tests. |
| Developer | Pick the allowed provider and effort tier. |
| Developer | See which items have no policy (AI can do nothing with them). |

**Information shown / collected**
- Per item: allow/deny flags, allowed provider, effort tier.

**Data to store**

| Item | What it looks like |
|------|--------------------|
| Policies | One WorkItemPolicy row per work item — see the model spec. |

**Access & security**
This page *is* the enforcement surface for the project's deny-by-default AI rule. The policy check must live in the single code path every AI call passes through — no bypass.

**Tests**
- [ ] Item with no policy: every AI action is blocked.
- [ ] `allowRead = false`: content is never sent to any provider.
- [ ] Only the policy's named provider is usable for the item.
- [ ] Policy changes apply on the next AI call.

**Open questions**
- (none)

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| Policy-gated AI call path | Every AI call must resolve the item's policy first. | One shared backend function: resolve policy → deny-by-default → provider + effort → call; all AI features go through it. | Yes. |

---

## PLAN

**Summary:** Build the WorkItemPolicy table's editor panel and — the real substance — the single policy-checked AI call path all AI features must use.

**Changes:**
- Tauri commands: get/set an item's policy; the shared `ai_call(item, use, payload)` gate that enforces policy before any provider call.
- Policy panel UI on a work item (switches, provider picker, effort picker).
- cargo tests: deny-by-default, per-use denial, provider restriction; Vitest for the panel.

**Expected technical debt:** none acceptable on the enforcement path — tests must cover every deny case.

**Status:** translated — waiting for approval
