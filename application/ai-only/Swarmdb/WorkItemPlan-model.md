---
spec: model
from: Swarmdb/WorkItemPlan-model.json
deliverable:
depends-on: [Swarmdb/WorkItem-model.json, Swarmdb/Solution-model.json]
---
objective: What one work item requires of one Solution it affects: the changes needed there, the tests that must prove them, the branch to work on and the branch it is cut from, any UI pictures — and the API and page schemas the AI generates from all of that. [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: workItemId — id / key, required — must reference a WorkItem row — The work item being planned [fields.entries.1]
field: solutionId — id / key, required — must reference a Solution of the work item's own Product; unique with workItemId — The Solution this work item affects [fields.entries.2]
field: changesRequired — text, required — What has to change in this Solution, in the team's own words [fields.entries.3]
field: unitTests — text, required — What must be proved — written before the thing that proves it [fields.entries.4]
field: branchName — text, required — The branch this work lands on. Prefilled from the Develop Strategy's naming pattern [fields.entries.5]
field: cloneFrom — text, required — The branch it is cut from — obvious to whoever set it up, a guess to everyone else. Prefilled from the Develop Strategy [fields.entries.6]
field: mockups — text, required, default [] — must be a JSON array of file paths — UI pictures for this Solution's part of the work [fields.entries.7]
field: apiSchema — text, required — written only by generation, never by the form — AI-generated: endpoints, payloads and status codes [fields.entries.8]
field: pageSchema — text, required — written only by generation, never by the form — AI-generated: pages, their fields, and which endpoints they call [fields.entries.9]
field: filesToChange — text, required — written only by generation, never by the form — AI-generated: the paths the work is expected to touch [fields.entries.10]
field: createdAt — date, required, default now — When the Solution was attached to this work item [fields.entries.11]
field: updatedAt — date, required, default now — updated on every change — When it last changed [fields.entries.12]
rel: workItemId — many-to-one to WorkItem.id (FK_WorkItemPlan_WorkItem) [relationships.entries.0]
rel: solutionId — many-to-one to Solution.id (FK_WorkItemPlan_Solution) [relationships.entries.1]
index: workItemId [lookupsAndPerformance.answer.0]
index: solutionId [lookupsAndPerformance.answer.1]
retention: Until the Solution is detached from the work item, or the work item is deleted. [lifecycleAndRules.retention]
sensitive: No. [lifecycleAndRules.sensitiveFields]
invariant: One row per (work item, Solution): work touching two repositories needs two sets of changes, branches and tests, and one row each is the only honest shape for that. The written half (changes, tests, branch, mockups) and the generated half (the schemas) are set by separate calls and never overwrite each other in either direction — regenerating schemas must not eat what a person typed, and re-saving a typed field must not blank the schemas. A plan can only name a Solution of the work item's own Product. [lifecycleAndRules.invariants]
> The brief's change rounds record why the model changed; the fields above are
> its answers as they stand, and the rounds are not restated.

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — WorkItemPlan (database model)

> Produced by `/translate` from [`../../Swarmdb/WorkItemPlan-model.json`](../../Swarmdb/WorkItemPlan-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
What one work item requires of one Solution: the changes, the tests that prove them, the branch — and the API and page schemas generated from all of it.

**Depends on**
- `Swarmdb/WorkItem-model.json`, `Swarmdb/Solution-model.json`

**Data to store**
id · workItemId FK · solutionId FK · changesRequired · unitTests · branchName · cloneFrom · mockups (JSON array of paths) · apiSchema · pageSchema · filesToChange · createdAt/updatedAt. Unique on (workItemId, solutionId).

**Invariants / tests**
- [x] A Solution is attached once; attaching again returns the same row.
- [x] The Solution must belong to the work item's own Product.
- [x] The written half and the generated half never overwrite each other, in either direction.
- [x] `mockups` must be a JSON array.
- [x] Deleting the work item takes its plans.
- [x] A branch pattern fills `{id}`, `{title}`, `{type}`; an unknown placeholder is left visible rather than blanked.

**Status:** built — round 12 (2026-07-21)

## Report back

`src-tauri/src/db/work_item_plan.rs` + `commands/work_item_plans.rs`. Eight cargo tests here, three more on the prompt/parser in `ai/client.rs`, one on the handover brief.

**Why per (work item, Solution) rather than per work item.** Work that touches an API and the web app in front of it needs two sets of changes, two branches and two sets of tests. One row per repository is the only shape that does not force a developer to write "…and in the web app, …" inside a field meant for one of them.

**Why the two halves are separate calls.** `set_written` is the team's; `set_generated` is the AI's. Regenerating schemas must never eat what a person typed, and re-saving a typed field must never blank the schemas. A test drives both directions, because this is the kind of thing that only breaks after someone has lost work to it.

**Why questions reuse `ai_feedback`.** A developer's question for Product is the same shape as the AI's question for the team: ask, wait, answer. `clarifications_for_item` already feeds resolved answers into every later prompt for that item, so reusing the table means the answers *reach the generation* without anyone re-typing them. That is what makes "we have asked enough to generate" true rather than aspirational. A second Q&A mechanism would have collected the same answers into a box nothing reads.

**Why replies are matched by name.** The model is given Solution names and asked to use them exactly. A renamed Solution means it has not planned for that one, and writing its schemas onto the wrong repository is worse than dropping them — so unmatched entries are dropped and named in the result, and Solutions that got nothing back are named too.

**Technical debt:**
- **The AI cannot see the mockups.** They are stored, named, and the prompt states plainly that the model cannot see them so it asks rather than inventing a layout. This client sends text; wiring vision (image content blocks, and a vision-capable local model) is a real piece of work and is not done.
- **Nothing renders the pictures in-app either** — the path is shown, not the image. Tauri's asset protocol would do it.
- **`filesToChange` is prose, not a checked list.** Nothing verifies those paths exist, and nothing compares them against what the change review later finds.
- **The schemas are not validated.** Unlike architecture diagrams, which must parse before they are stored, an API schema here is free text — so a malformed one is stored and travels to the agent.
- **No history.** Regenerating replaces the schemas; the previous version is gone.
- **The branch is not created.** The plan says what the branch should be called and where it comes from; nothing runs `git checkout -b`.
