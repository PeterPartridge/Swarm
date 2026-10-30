---
spec: page
from: Swarm/marketingDesign.md
deliverable:
depends-on: []
---
objective: keep taking a Product to market, and deciding how it looks, in the workspace beside the planning and code [why-exists]
objective: Marketing works out audience, positioning, pricing and launch; Design works out branding, tokens, flows and components, producing artefacts a designer or developer can use [why-exists]
model: whatever the Product's AI policy says — no budget or provider of its own [model-and-effort]
action: Product or Marketing writes a brief and the AI drafts a marketing strategy from what the Product actually is [actions]
action: Product or Design writes a brief and the AI drafts a design direction, plus design tokens, user flows and a component inventory [actions]
action: Design connects a Figma account, points at a file, and the AI reads it before designing [actions]
action: Design writes the design artefacts out as files under design/ [actions]
action: Design pushes design tokens into Figma as variables where the plan allows, and posts an artefact onto a Figma file as a comment [actions]
look: two screens in the Product workspace beside Planning and RoadMap, each able to pop out [look]
look: a brief box, a Figma panel, a generate button, and on Design the assets listed with their contents visible [look]
info: the marketing and design strategy documents [information]
info: design assets — token sets, user flows, component diagrams, wireframes, brand guidelines [information]
info: whether a Figma account is connected, and a summary of any linked file [information]
info: a Figma personal access token, kept only in the OS credential store [information, data-stored]
access: anyone using the app — single-user, no login [who-can-use]
store: strategy documents — Swarmdb/Strategy-model.json, areas marketing and design [data-stored]
store: design assets — Swarmdb/DesignAsset-model.json [data-stored]
store: the brief being typed, the Figma file reference and the digest of the last file read, in memory only [in-memory]
check: C1 a marketing strategy uses the Product's own description and invents no features [tests]
check: C2 a design direction produces tokens that parse as JSON and flows that parse as Mermaid [tests]
check: C3 a Figma file is reduced to a digest before it reaches an AI, and the digest says when it is partial [tests]
check: C4 a token push the Figma plan forbids says it is the plan, and names the file export as the way through [tests]
check: C5 the file export writes the path that explanation names [tests]
limit: Figma's REST API cannot create frames, components or layouts on any plan; tokens can be written as variables only on Enterprise; reading files and posting comments work everywhere [limits]
limit: a design file can be megabytes, so it is summarised before it nears a prompt [limits]
uses: Swarmdb Strategy and DesignAsset models [data-stored]
UNKNOWN: the brief has no front matter; what are its status, deliverable and depends-on? [why-exists]
> The brief's Part 4 change rounds have no question ID to cite, so what they
> add beyond the answers above is not translated here. Read them in the brief.

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — Marketing & Design

> Produced by `/translate` from [`../../Swarm/marketingDesign.md`](../../Swarm/marketingDesign.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Two workspace screens beside Planning and RoadMap. Marketing produces a strategy; Design produces a direction plus artefacts — tokens, flows, components — that a person can use, export, or push to Figma.

**Depends on**
- `Swarm/productPlanning.md` (the workspace and its pop-out routing)
- `Swarmdb/Strategy-model.json` (areas `marketing`, `design`), `Swarmdb/DesignAsset-model.json`

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
- ~~**`canMarketing` / `canDesign` role flags still do not exist.**~~ **Closed** — see [`adminArea.md`](../../Swarm/adminArea.md) round 3: both screens now gate on role flags, seeded sensibly and off by default for custom roles. Still visibility, not security, like every role flag here.
- **Not run in the real app.** Tauri UI cannot be exercised in a plain Vite preview — there is no IPC, so every call fails. Verified by tests and builds only.
- **Standing: the Claude path is still unproven live.** Unchanged, and now two rounds old.
