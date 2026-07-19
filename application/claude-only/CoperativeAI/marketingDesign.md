# Page Spec — Marketing & Design

> Produced by `/translate` from [`../../CoperativeAI/marketingDesign.md`](../../CoperativeAI/marketingDesign.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Two workspace screens beside Planning and RoadMap. Marketing produces a strategy; Design produces a direction plus artefacts — tokens, flows, components — that a person can use, export, or push to Figma.

**Depends on**
- `CoperativeAI/productPlanning.md` (the workspace and its pop-out routing)
- `CoperativeAIdb/Strategy-model.json` (areas `marketing`, `design`), `CoperativeAIdb/DesignAsset-model.json`

**Tests**
- [x] Marketing has no assets; Design lists them (Vitest).
- [x] The brief and any linked file reach the command; no file means `null`, not `""` (Vitest).
- [x] A refusal is shown as a question, not an error (Vitest).
- [x] A Figma push is offered for token sets only (Vitest).
- [x] A refused push shows the plan explanation whole (Vitest).
- [x] The digest's prompt cost is shown before it is paid for (Vitest).
- [x] The plan limits are stated without waiting for a failure (Vitest).
- [x] Token asks for a password field and is never returned (Vitest).
- [x] A document reduces to pages/screens/copy; a partial digest says so; copy is labelled as content (cargo).
- [x] Hex → Figma RGBA, nested tokens → slash names, the variables body types each token (cargo).
- [x] A 403 blames the plan and names the way out (cargo).
- [x] `design/tokens.json` is what the 403 message promises **and** what the emitter writes (cargo, asserted together).

**Status:** built — round 8 (2026-07-19)

## Round 8 — Marketing, Design, and an honest Figma link

### My Feedback

The requirement said design output should include "writing into Figma". Before building anything I checked what Figma's REST API can actually do, because a plan promising "Claude creates your Figma designs" is a plan that cannot be delivered:

- **It cannot create frames, components or layouts. On any plan.** No endpoint exists; that needs a plugin running inside Figma.
- **Variables (design tokens) are Enterprise-only.** Every lesser plan gets 403.
- **Reading a file and posting comments work everywhere.**

You said the account is on the **free** plan, and chose: build the Enterprise path anyway, and let the AI download the file to read. Both are built. What that means in practice is stated plainly rather than buried — the variables push will 403 for you, and the file export is your route.

**Marketing and design were never new machinery.** They are strategy areas the `strategy` table was missing; adding them to `AREAS` is most of it. What is genuinely new is **design assets** — a strategy says what the design should be, an asset is the thing itself.

**The kind decides the format, not the caller.** Tokens must be JSON, flows must be Mermaid, because everything downstream assumes it. A cheap structural check catches the common AI failure of returning prose where a diagram was asked for, without pretending to validate Mermaid — only Mermaid can do that.

**The digest is the part that mattered most.** A real Figma document is megabytes of nested nodes. Handing that to a model would cost more than the rest of this platform saves, so `digest_file` reduces it to what a designer would say out loud — pages, top-level frames, components, styles, and the copy actually on screen, capped per page and **marked when truncated**, so a partial digest never reads as the whole file. It goes in the **cacheable half** of the prompt: it is the most expensive thing there and the least likely to change between two questions about the same file.

**Copy from a design file is quoted and labelled as content to read, never as instruction.** A design file is written by whoever has edit access; a text layer saying "ignore your rules" is a text layer, not an order. A test asserts the labelling survives.

### Your Feedback

- **I shipped a promise the code did not keep, and caught it late.** The 403 message and the Figma panel both told people to use `design/tokens.json` — and nothing wrote that file. It went in one commit and was fixed in the next. Worse, on your plan that file *is* the only route tokens have into Figma, so the one path you can actually use was the one that did not exist. The fix now pins the message to the emitted path in a single test, because the two live in different modules and would otherwise drift apart quietly.
- **The window allow-list is a trap worth remembering.** `WORKSPACE_SCREENS` and the Rust `SCREENS` constant are two lists that must agree, and nothing makes them. Adding the screens to the frontend alone would have looked completely fine until someone dragged a panel out.
- **Three raw-string failures on the same cause.** `r#"…"#` closed early on every hex colour, three separate times, because `"#` is the terminator. I flagged it, fixed it, and hit it again twice. The pattern was available after the first one.
- **A test asked for `role="status"` and got two.** The Figma panel renders one as well. Not a bug — multiple live regions are legal — but it is a sign the page has two things talking at once, and a reader using a screen reader hears both.

### Technical Debt

- **`push_variables` is unverifiable here.** The account is on the free plan, so the endpoint answers 403 by design. Its request body is unit-tested; the network call has never run. If it is ever pointed at a real Enterprise token, expect the first attempt to reveal something the tests did not.
- **Nothing writes frames, and nothing will.** The plugin spec described in the original plan was deliberately *not* emitted: a JSON document with no plugin to consume it is work that pretends to be a feature. If someone commits to writing the plugin, that changes.
- **Comments post the asset content raw.** A large token set becomes a very long Figma comment. No truncation, no formatting.
- **`emit_design_files` overwrites unconditionally** via `write_generated`. Correct for app-owned output, but a hand-edited `design/brand.md` is lost — unlike the authored briefs, which `write_files` protects.
- **The digest caps copy at 40 strings per page** and says when it truncated, but the cap is arbitrary and not tuned against any real file.
- **`canMarketing` / `canDesign` role flags still do not exist.** Deferred from R1 and still deferred: both screens are visible to everyone. Consistent with the rest of the app, where roles are visibility rather than security, but it means these areas are not gated at all.
- **Not run in the real app.** Tauri UI cannot be exercised in a plain Vite preview — there is no IPC, so every call fails. Verified by tests and builds only.
- **Standing: the Claude path is still unproven live.** Unchanged, and now two rounds old.
