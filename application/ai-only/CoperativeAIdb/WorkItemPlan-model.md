# Page Spec — WorkItemPlan (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/WorkItemPlan-model.json`](../../CoperativeAIdb/WorkItemPlan-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
What one work item requires of one Solution: the changes, the tests that prove them, the branch — and the API and page schemas generated from all of it.

**Depends on**
- `CoperativeAIdb/WorkItem-model.json`, `CoperativeAIdb/Solution-model.json`

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
