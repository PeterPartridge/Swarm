---
spec: model
from: Swarmdb/DesignAsset-model.json
deliverable:
depends-on: [Swarmdb/Product-model.json]
---
objective: Something the design work actually produced — a token set, a user flow, a component diagram, a wireframe, or brand guidelines. The design strategy says what the design should be; an asset is the thing itself. [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: productId — id / key, required — must reference a Product row — The Product this asset belongs to [fields.entries.1]
field: kind — list, required, default tokens — one of: tokens / uiFlow / componentDiagram / wireframe / brandGuidelines — What sort of artefact this is. The kind decides the format — see below [fields.entries.2]
field: name — text, required — not empty; unique per (product, kind) — What this artefact is called. Regenerating the same name replaces it rather than leaving two [fields.entries.3]
field: content — text, required — must parse as JSON when the kind is tokens; must start with a Mermaid diagram type when the kind is uiFlow or componentDiagram — The artefact itself [fields.entries.4]
field: format — list, required, default markdown — one of: json / mermaid / markdown; decided by the kind, never by the caller — How the content should be read [fields.entries.5]
field: figmaFileKey — text, optional — Set once this asset has been pushed into a Figma file [fields.entries.6]
field: figmaNodeId — text, optional — Where in that file it landed, when known [fields.entries.7]
field: createdAt — date, required, default now — When the asset was first stored [fields.entries.8]
field: updatedAt — date, required, default now — updated on every change — When it last changed [fields.entries.9]
rel: productId — many-to-one to Product.id (FK_DesignAsset_Product) [relationships.entries.0]
index: productId [lookupsAndPerformance.answer.0]
index: kind [lookupsAndPerformance.answer.1]
retention: Until the asset or its Product is deleted. Regenerating an asset of the same name replaces it in place. [lifecycleAndRules.retention]
sensitive: No. The Figma token that pushes these lives in the operating system's credential store and never touches this table. [lifecycleAndRules.sensitiveFields]
invariant: The kind decides the format, not whoever called save. A token set must parse as JSON and a flow must start with a Mermaid diagram type, because everything downstream — the emitted file, the Figma push — assumes it. Recording where an asset landed in Figma never changes the asset's content: pushing does not modify the thing, it records that a copy exists elsewhere. [lifecycleAndRules.invariants]
> The brief's change rounds record why the model changed; the fields above are
> its answers as they stand, and the rounds are not restated.

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — DesignAsset (database model)

> Produced by `/translate` from [`../../Swarmdb/DesignAsset-model.json`](../../Swarmdb/DesignAsset-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
What the design work produced — token set, user flow, component diagram, wireframe, brand guidelines. A strategy says what the design *should be*; an asset is the thing itself.

**Depends on**
- `Swarmdb/Product-model.json`

**Data to store**
id · productId FK · kind · name (non-empty, unique per product+kind) · content · format · figmaFileKey? · figmaNodeId? · createdAt/updatedAt.

**Invariants / tests**
- [x] The **kind decides the format**, never the caller: tokens → json, flows/diagrams → mermaid, everything else → markdown.
- [x] A token set that will not parse as JSON is refused — everything downstream assumes it is real JSON.
- [x] Prose offered as a diagram is refused; a leading `%%` comment or blank line is fine.
- [x] Regenerating a named asset replaces it rather than leaving two.
- [x] Recording a Figma location does not touch the content.
- [x] Kind, blank name, and unknown Product all rejected.

**Status:** built — round 8 (2026-07-19)

## Report back

`src-tauri/src/db/design_asset.rs` + `commands/design.rs`. Six cargo tests.

**Why the format is not the caller's choice.** Every consumer of an asset assumes its shape: `emit::design_files` writes tokens as `.json` and fences flows as `mermaid`; `figma::push_variables` parses tokens as JSON before flattening them. Letting a caller declare "this Markdown is a token set" would push the failure to whichever consumer hit it first, and the error would name the wrong thing. So `required_format(kind)` decides, and `save` validates against that.

**The Mermaid check is structural, not a parser.** It looks at the first non-blank, non-comment line for a diagram type. That catches the failure that actually happens — a model returning prose, or an apology, where a diagram was asked for — without claiming to validate Mermaid, which only Mermaid can do. `client::parse_design` strips code fences before this ever runs, because a fenced diagram is a valid diagram wearing a jacket and rejecting it for that would be pedantry.

**Reads are scoped before writes.** The `existing` lookup sits in its own block so the statement is dropped before the `UPDATE`. An open read statement silently loses the write that follows it in this engine — the single most expensive thing to rediscover in this codebase.

**Technical debt:**
- **Uniqueness is per (product, kind, name)**, so a flow and a token set may share a name. Sensible, but it means "Core" can mean two different things in one Product.
- **Nothing validates a wireframe or brand guidelines at all** — they are markdown, and markdown accepts anything, including an empty string dressed as an artefact.
- `figmaNodeId` is written as `None` by every current caller: the Variables API returns collection ids rather than node ids, and nothing else pushes. The column is a promise the code has not yet had a reason to keep.
- No history. Regenerating replaces, so the previous version is gone — there is no way to compare what the AI produced this time against last time.
