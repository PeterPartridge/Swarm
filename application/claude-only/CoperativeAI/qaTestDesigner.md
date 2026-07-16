# Page Spec — QA Test Designer

> Produced by `/translate` from [`../../CoperativeAI/qaTestDesigner.md`](../../CoperativeAI/qaTestDesigner.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
The Test environment's main page: QA designs plain-English test scenarios around work items, and the AI implements them as real tests — within each item's AI policy.

**Model & effort**
Mid-range tier (Claude Sonnet 5), medium effort.

**Depends on**
- `CoperativeAI/workItemPolicy.md`

**Actions**

| User | Can do |
|------|--------|
| QA | Pick a work item and see its scenarios. |
| QA | Add a plain-English scenario (given/when/then welcome, not required). |
| QA | Edit or remove a scenario. |
| QA | Ask the AI to implement a scenario — only if the item's policy allows generating tests. |
| QA | See which scenarios are designed vs. implemented. |

**Information shown / collected**
- Scenarios per item: description, state (designed / implemented), implemented test's file path.

**Data to store**

| Item | What it looks like |
|------|--------------------|
| Scenarios | Work items of type `test` linked via `parentItemId` — or a dedicated model if too thin; decide at build time and record it (per the brief). |

**Access & security**
No login (project security model). AI implementation goes through the single policy-checked AI call path (deny-by-default).

**Tests**
- [ ] Added scenario saves and survives restart.
- [ ] "Implement" is blocked when the policy denies generating tests.
- [ ] Implemented scenario shows its test file's location.

**Open questions**
- Scenario storage: reuse WorkItem (type `test`, parentItemId) vs. a dedicated model — flagged by the brief for a build-time decision.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| AI-implemented tests | Turning scenarios into real test files. | Send scenario + item context through the policy-gated call path; write the returned test to the repository; record its path. | Yes. |

---

## PLAN

**Summary:** Build the Test environment: scenario list per work item (stored as child work items of type `test`), and an "implement with AI" action routed through the policy gate.

**Changes:**
- Reuse WorkItem commands for scenario CRUD (type `test`, parentItemId set); add state + test-file-path fields' handling.
- Test environment page: item picker, scenario list with designed/implemented states.
- cargo tests: policy-denied implementation is blocked; Vitest for the page.

**Expected technical debt:** if scenarios outgrow the WorkItem shape (steps, expected results), promote to a dedicated model in a later round.

**Status:** translated — waiting for approval
