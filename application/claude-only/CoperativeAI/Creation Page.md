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

**Status:** the smaller slice is now **built** (2026-07-18) — see round 2. The "decide how many endpoints/models a project needs" question remains unanswered and unbuilt, as recommended.

---

## Round 2 — Emitting the framework's own files

### My Feedback
The requirement was that the app become self-hosting: *"until app data becomes .md/JSON, the guardrails don't apply to anything done in the app."* Before this round the app wrote exactly one file ever — `Project_brief.md` at Product creation — so everything else planned in the app was invisible to the framework.

Applied as **`emit.rs`** plus a "Generate framework files" action in the Develop area. For the selected Product it writes:
- `<solution>/application-spec.json` per Solution, from the Solution card's answers and its linked GitHub repo;
- `.CoperativeAI/pages/<feature>.md` per planned feature, seeded with the work item's description and its deliverable.

The content builders (`solution_spec`, `page_brief`, `safe_stem`) are pure and unit-tested; the filesystem half is separate. This is deliberately the **smaller slice** this brief's own plan recommended — it emits one file per thing that exists, and does not guess how many endpoints or models a project "needs".

### The part that mattered: never destroying a hand edit
`db/emitted_file.rs` records the hash of every file **as the app wrote it**. On re-emit:
- on disk still matches what we wrote → safe to update;
- identical to what we'd write → reported as already up to date, no write;
- **changed since we wrote it → conflict: reported, and left byte-for-byte alone**;
- **exists but we never wrote it → also a conflict.** Not being ours is reason enough not to touch it.

It is its own table rather than a column on `solution_management` because that table already holds scaffold locations, and adding a column there meant a drop-and-recreate that would discard them.

The hash is FNV-1a, not `DefaultHasher`: the standard hasher is explicitly not stable across Rust versions, so a toolchain upgrade would have made every file look hand-edited.

### Your Feedback
- **The conflict report is the feature.** The UI names each file it left alone and states the edits are safe — a silent skip would be worse than an overwrite, because the user would not know the file had stopped tracking the app.
- **Emission is one-way.** A hand edit is preserved but never read back into the database, so the two drift apart deliberately. Reconciling them is a real design problem (which side wins?) and belongs in its own round rather than being smuggled into this one.
- Recommendation: emit `claude-only/` translations next, so `/build` has its spec beside the brief. That is the honest next step toward the loop running from the app.

### Technical Debt
- **Model JSONs are not emitted** — only solution specs and page briefs. A Product's data models still exist only in the app.
- **No `/translate` or `/build` invocation.** The app writes the inputs; running the loop over them is still a person's job in Claude Code. This round makes the framework *apply* to app data; it does not make the app drive the framework.
- **Deleting a Solution or feature leaves its emitted file behind** — nothing prunes orphans; the file simply stops being regenerated.
- **A renamed Solution or feature emits a new file** beside the old one, because the path derives from the title.
- Emission needs the Product to have been created **with a folder**; there is no way to point a folder-less Product at a directory afterwards.
- `Project_brief.md` is still written only at Product creation, so strategy and deliverables added later never reach it.
- Tests cover the emitter against a real temp directory, but **no end-to-end run against a real scaffolded Product** has been done.
