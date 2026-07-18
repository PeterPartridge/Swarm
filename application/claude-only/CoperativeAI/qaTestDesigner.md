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

**Status:** built (2026-07-18) — round 2

---

## Round 2 — Testing Strategy + tests associated with Deliverables or Work Items

**Behaviour:** the Test tab is now a real environment. Pick a Product and you get a **Testing Strategy** section (test plans, test environments, required tooling, links to test cases / automated suites) and a **Test Cases** list. Each test case is a plain-English scenario that can be **associated with a Deliverable or a Work Item** — or with neither, so a test can be written before the work that satisfies it exists.

**Storage decision (the brief's open question, now closed):** scenarios get their **own `TestCase` model**, not work items of type `test`. The brief left this to build time; a dedicated model won because a scenario now needs to point at *either* a Deliverable *or* a Work Item, and `parentItemId` can only express the second. See [`../CoperativeAIdb/TestCase-model.md`](../CoperativeAIdb/TestCase-model.md).

**Implemented:**
- `db/test_case.rs` — id, productId, title, scenario, state (`designed` | `implemented`), testPath, deliverableId, workItemId. Association targets are validated when supplied, so a case never points at a row that does not exist.
- `commands/test_cases.rs` — list / create / update / delete with `TestCaseDto`.
- `pages/TestArea.tsx` — Product picker → `StrategyEditor` (area `test`, `TEST_STRATEGY_FIELDS`) + `TestCases`; wired into `WorkspaceShell` so the Test tab renders it instead of the placeholder.
- `components/TestCases.tsx` — add form and per-case controls: one association picker spanning both kinds (`d:<id>` / `w:<id>`), a state picker, and a test-file field that appears once a case is marked implemented. Adding a case updates the list immediately (optimistic insert, rolled back on error), the same pattern as the Planning board.

Deleting a Deliverable or a Work Item now **unlinks** its test cases rather than leaving a dangling id — `deliverable::delete` already did this for work items, so test cases were made to match, and `work_item::delete` gained the same for its own cases. The test keeps existing; only the association goes.

**Tests:** cargo 93/93 (test-case defaults to `designed` with no path; title and Product required; association with a deliverable *or* a work item; associations must reference rows that exist; deleting an association target unlinks the case without deleting it; marking implemented records the path; update rejects a bad state, empty title, or unknown id; delete removes only that case). Vitest 57/57 (strategy fields present, cases listed with their association, add-with-deliverable, re-associate an existing case, marking implemented reveals the test-file field, no-Products hint). `npm run build` and a full `cargo build` clean.

**Update (round 3 of the governance plan):** the **"I can't implement this" channel** this brief's AI action would need now exists — `db/ai_feedback.rs` plus the `blocked` branch in every generation schema. When the implement-a-scenario action is built it should decline through that channel rather than guessing at a thin scenario.

**Technical debt:**
- **The AI "implement this scenario" action is not built.** This round delivers the design surface and the association model; the policy-gated call that writes a real test file is still open, so `state` and `testPath` are set by hand today. The original page-skill and the policy-denied test remain outstanding.
- **A case can be associated with only one thing at a time** in the UI (one picker over both kinds). The table technically allows both `deliverableId` and `workItemId` to be set at once — nothing enforces exclusivity at the DB level.
- **`testPath` is a free-text string** — not checked against the filesystem or the linked repository.
- Test cases are **not scoped by role** yet; the Admin field-visibility gate covers the cost/profit fields only.
