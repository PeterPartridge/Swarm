# Page Spec — DesignAsset (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/DesignAsset-model.json`](../../CoperativeAIdb/DesignAsset-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
What the design work produced — token set, user flow, component diagram, wireframe, brand guidelines. A strategy says what the design *should be*; an asset is the thing itself.

**Depends on**
- `CoperativeAIdb/Product-model.json`

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
