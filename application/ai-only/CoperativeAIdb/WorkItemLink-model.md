# Page Spec — WorkItemLink (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/WorkItemLink-model.json`](../../CoperativeAIdb/WorkItemLink-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A dependency between two pieces of work. When the two items sit in different Solutions it is a cross-repository dependency — **derived from their Solutions, never stored**.

**Depends on**
- `CoperativeAIdb/WorkItem-model.json`

**Data to store**
id · fromWorkItemId FK → WorkItem · toWorkItemId FK → WorkItem · kind (blocks / relatesTo) · createdAt. Unique on (from, to, kind).

**Invariants / tests**
- [x] Both items exist and differ; kind must be one of the two.
- [x] `blocks` cannot form a cycle, directly or transitively — checked by a breadth-first walk of the blocks graph before inserting.
- [x] `relatesTo` may go both ways: it implies no order, so a ring of it is harmless.
- [x] Linking the same pair twice replaces rather than duplicates.
- [x] Deleting a work item removes every link touching it.
- [x] Two items in different Solutions link fine, and cross-repo is read back off the Solutions.

**Status:** built — round 8 (2026-07-19)

## Report back

`src-tauri/src/db/work_item_link.rs` + three commands in `commands/work_items.rs` (`list_work_item_links` scoped to a Product, `link_work_items`, `unlink_work_items`). Six cargo tests.

**Two decisions worth stating:**

1. **Cross-repo is derived, not stored.** A work item points at a Solution and a Solution at a repository, so "these two are in different repos" is already answerable. Storing a `crossRepo` flag beside it would be a second fact to keep in step with the first, and the pair would eventually disagree. `isCrossRepo` in `PlanningBoard.tsx` reads the two `solutionId`s and compares them.

2. **Only `blocks` is cycle-checked.** Cycle detection exists to stop a plan where nothing can start, and only an ordering relation can produce one. Applying it to `relatesTo` would refuse "these two features affect each other" — a true and useful statement — for no benefit. The unit test states this explicitly by building a `relatesTo` ring straight after a rejected `blocks` ring.

The walk is breadth-first over a graph, unlike `Deliverable::depends_on_transitively`, which follows a single chain: a work item may block several others, a deliverable has one parent.

**Technical debt:**
- **The cycle check races.** It walks the graph, then inserts, with no transaction around the pair. Two links added at the same instant could both pass and together form a loop. Single-user desktop app, so this is theoretical today — but it becomes real the moment anything concurrent touches the table.
- **`list_for_product` returns links whose *source* is in the Product.** A link from another Product's item into this one is invisible on this board. That is the right default (the source owns its dependency) but it means an item can be blocked by something the board never mentions.
- No link between items of *different Products* is prevented, and nothing warns that it crosses a plan boundary.
- The board shows dependencies as a flat list per card. Nothing draws the graph, so a five-deep blocking chain has to be read one card at a time.
