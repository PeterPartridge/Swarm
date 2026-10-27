# Page Brief — Marketing & Design

> **Who fills this in:** Product answers Parts 1–2, developers answer Part 3.
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So the work of taking a Product to market, and the work of deciding how it looks, live in the workspace beside the planning and the code — instead of in a separate tool nobody links back. Marketing works out audience, positioning, pricing and launch. Design works out branding, tokens, flows and components, and produces artefacts a designer or developer can actually use.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: Product/Marketing) can: write a brief and have the AI draft a marketing strategy from what the Product actually is.
- Someone (who: Product/Design) can: write a brief and have the AI draft a design direction, plus design tokens, user flows and a component inventory.
- Someone (who: Design) can: connect a Figma account, point at a file, and have the AI read that file before it designs anything.
- Someone (who: Design) can: write the design artefacts out as files under `design/`.
- Someone (who: Design) can: push design tokens into Figma as variables — where the Figma plan allows it — and post an artefact onto a Figma file as a comment.

### look — What should it look like?
Two screens in the Product workspace beside Planning and RoadMap, each pop-out-able like the others. A brief box, a Figma panel, a generate button, and — on Design — the assets listed with their contents visible.

### information — What information does this page show or collect?
- The marketing and design strategy documents.
- Design assets: token sets, user flows, component diagrams, wireframes, brand guidelines.
- Whether a Figma account is connected, and a summary of any linked file.
- A Figma personal access token — **stored in the operating system's credential store only**, never in the database, a config file, or a log line.

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
- Strategy documents — see [`CoperativeAIdb/Strategy-model.json`](../CoperativeAIdb/Strategy-model.json), areas `marketing` and `design`.
- Design assets — see [`CoperativeAIdb/DesignAsset-model.json`](../CoperativeAIdb/DesignAsset-model.json).
- The Figma token is **not** stored by the app — it lives in the OS credential store.

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
The brief being typed, the Figma file reference, and the digest of the last file read.

### tests — How will we know it works? What should we test?
- Generating a marketing strategy uses the Product's own description and does not invent features.
- Generating a design direction produces tokens that parse as JSON and flows that parse as Mermaid.
- A Figma file is reduced to a digest before it reaches an AI, and the digest says when it is partial.
- A token push that the Figma plan forbids explains that it is the plan, and names the file export as the way through.
- The file export writes the path that explanation names.

### limits — Any known limits or things to watch out for?
**Figma's REST API cannot create frames, components or layouts on any plan** — that needs a plugin running inside Figma. Design tokens can only be written as variables on an **Enterprise** plan. Reading a file and posting comments work everywhere. A design file can be megabytes, so it must be summarised before it goes anywhere near a prompt.

### model-and-effort — Which AI model and effort level should this page use by default?
Whatever the Product's AI policy says — this area does not get its own budget or its own provider.

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
- Round 8b (my feedback): Marketing outputs become **stored artefacts** like Design's — campaign ideas, launch plan and messaging are things a person can pick up and hand to someone, which a paragraph inside a strategy document is not. *(Applied: three new asset kinds in the shared table, generated explicitly by the marketing prompt, shown on the Marketing screen only, and emitted as `marketing/` files.)*
- Round 8 (my feedback): Add a **Marketing & Design** section. Marketing covers target audience, messaging, positioning, pricing, campaigns and launch. Design covers branding, tokens and flows. Design output should include **writing into Figma**. *(Answered during the round: the Figma account is on the **free** plan, and the decision taken was to build the Enterprise variables path anyway and to let the AI download and read the file. Both are built; the variables push cannot be verified from a free plan and is unit-tested only.)*
