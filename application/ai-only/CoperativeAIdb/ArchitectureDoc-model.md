# Page Spec — ArchitectureDoc (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/ArchitectureDoc-model.json`](../../CoperativeAIdb/ArchitectureDoc-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
How a system is put together, as a diagram the app can store, emit and show. Attached to a Product **or** a Solution.

**Depends on**
- `CoperativeAIdb/Product-model.json`, `CoperativeAIdb/Solution-model.json`

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
- ~~**Nothing renders the diagrams.**~~ Closed — see [`../CoperativeAI/developerArea.md`](../CoperativeAI/developerArea.md) round 8. Mermaid and `jsonGraph` are drawn; PlantUML deliberately is not, because drawing it in a browser means sending it to a third-party server.
- **The "agree with existing documents" instruction is unenforced.** The prompt asks for it; nothing checks the answer, unlike the developer-rules path which re-checks what the model declared.
