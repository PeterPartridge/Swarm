# Page Spec — Creation Page

> Produced by `/translate` from [`../../CoperativeAI/Creation Page.md`](../../CoperativeAI/Creation%20Page.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Page to create a solution.

**Model & effort**
High — reasonable given this page's real job (see Open Questions).

**Depends on**
- SolutionManagement.md

**Actions**

| User | Can do |
|------|--------|
| Anyone using the app | Choose a solution type from a dropdown, then fill in a form whose answers become the required files in the `template/` folder location. |

**Information shown / collected**
- Whatever information is needed to generate the solution's files (a project brief / solution spec / item briefs, depending on type).

**Data to store**
- Files stored in a `.CoperativeAI` folder.

**Access & security**
No login — single-user local desktop app (project security model).

**Tests**
- [ ] A project with 3 AI endpoints and 1 database file is created.

**Open questions**
- This page's actual job is to generate the framework's own brief/spec files programmatically — effectively reimplementing the `/translate` and `/new-item` logic as in-app behaviour, not just a form. That is a materially bigger scope than a typical page, and probably deserves its own dedicated design pass (its own mini system-spec) before being built as "one page."
- The single given test ("3 AI endpoints and 1 database file") describes one specific outcome, not a general rule for how the count/shape of generated files is decided — it's unclear whether that's a fixed template choice or something the tool infers per project. This needs an answer before the "creation" logic can be written; guessing it would violate the no-invention rule.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| Spec-generation logic | This page's core function, as already listed at the project level. | Apply the framework's own template shapes to generate real files inside `.CoperativeAI`. | No — reused from project skills. |

---

## PLAN

**Summary:** Not ready to build as a single "medium page" — the open questions above are load-bearing (what determines the generated files' shape), and the honest answer is this page needs its own scoped-down first iteration rather than the full "3 endpoints + 1 database" scenario in one pass.

**Changes (smallest slice only):**
- Build the dropdown + form shell (choose a solution type, fill in the same questions the human `_forms/` templates ask).
- On submit, write out the files using the **existing static templates** in `template/_forms/` verbatim (blank forms copied and named, exactly like `/new-item` already does) — not a dynamic generator that decides file counts.
- Explicitly do **not** attempt the "decide how many endpoints/models a project needs" logic in this pass — that's the part with no defined rule.

**Expected technical debt:** the test "a project with 3 AI endpoints and 1 database file is created" is **not satisfied** by this smallest slice — logged as debt, with the open question above as the reason, rather than guessing at a rule to satisfy it.

**Status:** NOT approved for full build as specified — recommend a person answers the open questions (or approves the smaller slice above) before building.
