---
spec: page
from: Swarm/workItemPolicy.md
deliverable:
depends-on: ["productPlanning.md", "aiSettings.md", "Swarmdb/WorkItemPolicy-model.json"]
---
objective: let developers decide how the AI may use each work item — what it may do (read it, edit code for it, generate tests for it), which provider, at what effort; nothing is allowed unless the policy says so [why-exists]
model: most capable model, high effort — security-sensitive [model-and-effort]
action: a developer opens a work item's AI policy from the work item [actions]
action: a developer allows or denies each AI use — read the item, edit code for it, generate tests for it [actions]
action: a developer picks which configured provider and effort tier the item may use [actions]
action: a developer sees at a glance which items have no policy yet, so the AI can do nothing with them [actions]
look: a small panel in Develop attached to a work item — allow and deny switches, a provider picker and an effort picker; minimal [look]
info: per work item — each AI use allowed or denied, the allowed provider and the effort tier [information]
access: anyone using the app — single-user, no login [who-can-use]
store: one policy per work item — Swarmdb/WorkItemPolicy-model.json [data-stored]
store: nothing in memory [in-memory]
check: C1 with no policy, every AI action against the item is blocked [tests]
check: C2 denying read stops the item's content ever reaching a provider [tests]
check: C3 the item may use only the provider its policy names; a call through any other is blocked [tests]
check: C4 policy changes take effect on the next AI call [tests]
limit: the policy check sits in the one code path every AI call passes through, with no way around it [limits]
uses: Swarmdb WorkItemPolicy model [data-stored]

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — Work Item AI Policy

> Produced by `/translate` from [`../../Swarm/workItemPolicy.md`](../../Swarm/workItemPolicy.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Per-work-item control of how the AI may use each item: allow/deny read, edit, and test generation; which provider; what effort. Nothing is allowed without an explicit policy (deny-by-default).

**Model & effort**
Most capable tier (Claude Fable 5), high effort — security-sensitive.

**Depends on**
- `Swarm/productPlanning.md`
- `Swarm/aiSettings.md`
- `Swarmdb/WorkItemPolicy-model.json`

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

**Status:** built (2026-07-16)

---

## Report back

**Tests:** deny cases covered at the db layer (7 work_item_policy tests) plus command-layer gate tests (no policy / wrong hierarchy / non-feature / deleted provider all block; gates-passed resolves provider + effort). Vitest covers the editor (deny-by-default start state, toggling saves, provider select).

**How it was implemented:** `commands/policies.rs` (get/set over the tested db module) and `src/components/PolicyEditor.tsx` — an "AI policy" panel on every board card with the three allow switches, provider picker (from AI Settings), and effort tier. The enforcement path is `commands/work_items.rs::resolve_story_generation` — the single gate the AI-story feature (and every future AI feature) passes through before any content moves; with gates passed, generation reads the key from the OS credential store, calls the provider, and creates userStory items under the feature.

**Technical debt:** `work_item_policy::is_allowed` (per-use gate incl. edit/tests) exists and is tested but only the read+provider path is exercised by a live feature so far — the edit/test-generation uses activate with the code-editor and QA-designer builds.
