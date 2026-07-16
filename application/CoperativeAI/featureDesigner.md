---
form: page-brief
page: "Feature Designer"
solution: "CoperativeAI"
depends-on: ["productPlanning.md", "CoperativeAIdb/FeatureDesign-model.json"]
status: filled            # blank | filled | approved | built
---

# Page Brief — Feature Designer

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So Product can design a feature visually: a drag-and-drop canvas where blocks representing UI pieces, API endpoints, and data models are arranged and connected. The design belongs to a work item and later feeds the specifications that generate API endpoints, front-end changes, and database designs.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: Product) can: open a work item's design canvas from the Product Planning board.
- Someone (who: Product) can: drag blocks (UI piece, API endpoint, data model) from a palette onto the canvas and move them around.
- Someone (who: Product) can: connect blocks to show what uses what (e.g. this UI piece calls this endpoint, which reads this model).
- Someone (who: Product) can: name and describe each block in plain English.
- Someone (who: Product) can: save the design; it reloads exactly as left.

### look — What should it look like?
A canvas filling the Product environment, with a small palette of block types at the side. Blocks are simple rounded cards with a name; connections are lines between them. Product tab colour as accent. Minimal.

### information — What information does this page show or collect?
- The blocks of the design: their type, name, plain-English description, and position on the canvas.
- The connections between blocks.
- Which work item the design belongs to.

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
Feature designs (blocks, positions, connections) per work item — see [`CoperativeAIdb/FeatureDesign-model.json`](../CoperativeAIdb/FeatureDesign-model.json).

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
The in-progress canvas state between saves (drag positions while dragging).

### tests — How will we know it works? What should we test?
- Dragging a block from the palette adds it to the canvas at the drop position.
- Moving a block and saving keeps its new position after reopening the design.
- Connecting two blocks shows a line, and the connection is saved.
- Each work item has its own design — opening a different work item shows its own canvas.

### limits — Any known limits or things to watch out for?
Canvas performance with many blocks — keep rendering simple; designs of up to ~100 blocks should stay smooth on low-spec machines.

### model-and-effort — Which AI model and effort level should this page use by default?
Most capable model, high effort (interactive canvas work).

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
> - Round 2: …
