---
spec: model
from: Swarmdb/ArchitectureDoc-model.json
deliverable:
depends-on: [Swarmdb/Product-model.json, Swarmdb/Solution-model.json]
---
objective: How a system is put together, as a diagram — a system-interaction map, a component map, an API contract, an event flow, or an infrastructure picture. Attached to a Product as a whole, or to one of its Solutions. [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: productId — id / key, required — must reference a Product row — The Product this document belongs to [fields.entries.1]
field: solutionId — id / key, optional — must reference a Solution of the same Product when set — The Solution this document describes. Null means it is about the whole Product — a system-interaction map spans several Solutions, an API contract belongs to one [fields.entries.2]
field: kind — list, required, default systemInteraction — one of: systemInteraction / componentMap / apiContract / eventFlow / infrastructure — What sort of picture this is [fields.entries.3]
field: name — text, required — not empty; unique per (product, kind) — What the document is called. Regenerating the same name replaces it rather than leaving two [fields.entries.4]
field: content — text, required — must be valid in its declared format — checked before storing, never after — The diagram source [fields.entries.5]
field: format — list, required, default mermaid — one of: mermaid / plantuml / jsonGraph — The notation the content is written in [fields.entries.6]
field: createdAt — date, required, default now — When the document was first stored [fields.entries.7]
field: updatedAt — date, required, default now — updated on every change — When it last changed [fields.entries.8]
rel: productId — many-to-one to Product.id (FK_ArchitectureDoc_Product) [relationships.entries.0]
rel: solutionId — many-to-one to Solution.id (FK_ArchitectureDoc_Solution) [relationships.entries.1]
index: productId [lookupsAndPerformance.answer.0]
index: solutionId [lookupsAndPerformance.answer.1]
index: kind [lookupsAndPerformance.answer.2]
retention: Until the document or its Product is deleted. Deleting a Solution only unlinks its documents — an architecture document usually outlives the Solution it was drawn for, and is often the only record of why the thing was shaped that way. [lifecycleAndRules.retention]
sensitive: No. [lifecycleAndRules.sensitiveFields]
invariant: The content is valid in its declared format, checked before it is stored and never after. A diagram that does not render is worse than no diagram: it looks like documentation, so the gap stops being visible and nobody writes the real thing. A document about a Solution names a Solution of its own Product. [lifecycleAndRules.invariants]
> The brief's change rounds record why the model changed; the fields above are
> its answers as they stand, and the rounds are not restated.

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — ArchitectureDoc (database model)

> Produced by `/translate` from [`../../Swarmdb/ArchitectureDoc-model.json`](../../Swarmdb/ArchitectureDoc-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
How a system is put together, as a diagram the app can store, emit and show. Attached to a Product **or** a Solution.

**Depends on**
- `Swarmdb/Product-model.json`, `Swarmdb/Solution-model.json`

**Data to store**
id · productId FK · solutionId? FK · kind (systemInteraction / componentMap / apiContract / eventFlow / infrastructure) · name (unique per product+kind) · content · format (mermaid / plantuml / jsonGraph) · createdAt/updatedAt.

**Invariants / tests**
- [x] The content is **checked against its declared format before it is stored**.
- [x] Prose where a diagram was asked for is refused, and nothing is stored.
- [x] Each format is checked as itself; the right notation under the wrong declared format is rejected.
- [x] A Solution document must belong to the document's own Product.
- [x] Regenerating a named document replaces it.
- [x] Deleting a Solution **unlinks** its documents rather than deleting them.

**Status:** built — round 8 (2026-07-19)

## Report back

`src-tauri/src/db/architecture_doc.rs`, `src-tauri/src/diagram.rs`, `commands/architecture.rs`. Six model tests plus five in `diagram`.

**Why validation is on the way in.** A diagram that does not render is worse than no diagram, because it *looks* like documentation — so the gap stops being visible and nobody writes the real thing. `save` refuses anything `diagram::check` rejects, and the AI command reports "the AI drew something that will not render, so it was not saved" rather than storing it and letting the failure surface in a renderer weeks later.

**Why `solutionId` is nullable rather than a second table.** A system-interaction map spans several Solutions; an API contract belongs to exactly one. Two tables would mean two of everything — two saves, two lists, two emitters — to express one distinction that a nullable column already carries.

**Why the checks are not parsers, and say so.** `diagram.rs` catches what actually goes wrong: a model answering in prose, or in the wrong notation. It does not pretend to validate Mermaid — only Mermaid can. A check claiming more certainty than it has is worse than one honest about its job, because people trust it and stop looking.

Three checks earned their place:
- **PlantUML is checked at both ends.** A truncated response opens correctly and never closes, which is precisely the case worth catching.
- **A JSON-graph edge must join nodes that exist.** A dangling edge renders as a line going nowhere, which reads as a design decision rather than a mistake.
- **Mermaid allows leading `%%` comments**, because generated diagrams often carry one and rejecting those would be pedantry.

**The parser does not judge notation.** `parse_diagram` takes the format the *caller* asked for, not one the model declares; `diagram::check` does the judging. A test pins that division so neither side starts guessing at the other's job.

**Technical debt:**
- **`design_asset` and `architecture_doc` are now near-identical shapes** — product-scoped, kind-decides-format, name-replaces-in-place, both validating diagrams. They stayed separate because their kinds and lifecycles differ, but a third table like this would be the moment to extract a shared one.
- **No history.** Regenerating replaces, so there is no way to see what changed between two drafts of the same map — which is exactly what a reviewer wants.
- Diagrams are cached by source, so a page of architecture does not redraw on every tab switch.
- ~~**Nothing renders the diagrams.**~~ Closed — see [`../Swarm/developerArea.md`](../Swarm/developerArea.md) round 8. Mermaid and `jsonGraph` are drawn; PlantUML deliberately is not, because drawing it in a browser means sending it to a third-party server.
- **The "agree with existing documents" instruction is unenforced.** The prompt asks for it; nothing checks the answer, unlike the developer-rules path which re-checks what the model declared.
