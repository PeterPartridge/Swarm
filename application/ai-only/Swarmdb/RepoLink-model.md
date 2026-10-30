---
spec: model
from: Swarmdb/RepoLink-model.json
deliverable:
depends-on: [Swarmdb/Solution-model.json]
---
objective: How two of a Product's Solutions — and so two repositories — depend on one another. Distinct from WorkItemLink, which joins two pieces of work: this joins two systems, outlives any sprint, and answers 'if we change the API, what else moves?' [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: fromSolutionId — id / key, required — must reference a Solution row; must not equal toSolutionId; must share a Product with it — The Solution that depends on the other [fields.entries.1]
field: toSolutionId — id / key, required — must reference a Solution row — The Solution depended on [fields.entries.2]
field: kind — list, required, default callsApi — one of: callsApi / sharesSchema / publishesEvent / buildsOn — How they depend on each other. 'buildsOn' means one is compiled or deployed against the other — it orders work, so it must stay acyclic. The rest describe runtime, where mutual dependence is a real and workable arrangement [fields.entries.3]
field: notes — text, required — Why the dependency exists, in the developer's own words [fields.entries.4]
field: createdAt — date, required, default now — When the link was recorded [fields.entries.5]
rel: fromSolutionId — many-to-one to Solution.id (FK_RepoLink_From) [relationships.entries.0]
rel: toSolutionId — many-to-one to Solution.id (FK_RepoLink_To) [relationships.entries.1]
index: fromSolutionId [lookupsAndPerformance.answer.0]
index: toSolutionId [lookupsAndPerformance.answer.1]
index: kind [lookupsAndPerformance.answer.2]
retention: Until the link is removed or either Solution is deleted. Deleting a Solution removes every link touching it — a link to a deleted Solution is not a dependency, it is a dangling row. [lifecycleAndRules.retention]
sensitive: No. [lifecycleAndRules.sensitiveFields]
invariant: Both Solutions exist, differ, and belong to the same Product — this map is drawn per Product, so a link reaching outside it would be invisible from both ends. 'buildsOn' must never form a cycle, directly or transitively, because neither side could be built first. The other kinds may loop freely: two services calling each other's APIs is a real arrangement, and refusing it would make the map lie about the system it describes. [lifecycleAndRules.invariants]
> The brief's change rounds record why the model changed; the fields above are
> its answers as they stand, and the rounds are not restated.

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — RepoLink (database model)

> Produced by `/translate` from [`../../Swarmdb/RepoLink-model.json`](../../Swarmdb/RepoLink-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
How a Product's Solutions — and so its repositories — depend on one another. Distinct from [`WorkItemLink`](WorkItemLink-model.md), which joins two pieces of *work*: this joins two *systems*, outlives any sprint, and answers "if we change the API, what else moves?"

**Depends on**
- `Swarmdb/Solution-model.json`

**Data to store**
id · fromSolutionId FK · toSolutionId FK · kind (callsApi / sharesSchema / publishesEvent / buildsOn) · notes · createdAt. Unique on (from, to, kind).

**Invariants / tests**
- [x] Both Solutions exist, differ, and belong to the **same Product**.
- [x] `buildsOn` cannot form a cycle, directly or transitively (1000-step guard).
- [x] The runtime kinds **may** go both ways — mutual API calls are a real arrangement.
- [x] `reaches` follows every kind to any depth, does not run backwards, and terminates on a legal runtime cycle.
- [x] Deleting a Solution removes every link touching it.

**Status:** built — round 8 (2026-07-19)

## Report back

`src-tauri/src/db/repo_link.rs` + `commands/architecture.rs`. Six cargo tests.

**Only `buildsOn` is cycle-checked**, and this is the decision worth stating. Cycle detection exists to stop a state nothing can start from, and only an *ordering* relation produces one. A build cycle genuinely cannot be resolved — neither side can compile first. Two services calling each other's APIs, by contrast, is a common and workable arrangement: a webhook back is not a paradox. Refusing it would make the map lie about the system it describes, and a map that refuses to record reality is one people stop updating.

This mirrors `work_item_link`, where only `blocks` is checked. The rule that came out of both: **check the kind that orders, allow the kinds that describe.**

**`reaches` follows every kind.** The cycle check is deliberately narrow; the impact walk is deliberately wide. A runtime dependency is exactly how a change propagates, so restricting the walk to `buildsOn` would answer a question nobody asked. Because the runtime kinds may loop, the walk carries a `seen` set and a test pins that it terminates on a legal cycle.

**Cross-Product links are refused.** Two Products' systems may genuinely integrate, but this map is drawn per Product, so such a link would be invisible from both ends — recorded, and shown nowhere. Better to refuse it with a reason than to store something no view will ever surface.

**Technical debt:**
- **The cycle check is not transactional** — walk, then insert, with no transaction spanning the two. Same as the other two cycle checks in this codebase; theoretical for a single-user desktop app, real the moment anything concurrent arrives.
- **Cross-Product integration cannot be recorded at all.** Refusing it is right for this map, but it means a real dependency on another Product's API has nowhere to live.
- **`reaches` returns ids with no path.** It says what a change reaches, not *how* it gets there, so a surprising result cannot be traced without reading the whole link list.
- **Nothing draws the graph.** The map is a flat list of sentences; a five-Solution system has to be assembled in the reader's head.
- Links are recorded by hand. Nothing derives them from the code, so the map is only as true as the last person to update it.
