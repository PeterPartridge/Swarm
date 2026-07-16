---
form: page-brief
page: "Product Planning"
solution: "CoperativeAI"
depends-on: ["workspaceShell.md", "CoperativeAIdb/WorkItem-model.json"]
status: built            # blank | filled | approved | built
---

# Page Brief — Product Planning

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So Product can plan the product: create and manage the work items (features, bugs, tests, specs) that drive everything else — the feature designer, the developers' builds, and QA's tests. It is the entry point of the Product environment and of the whole workflow.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: Product) can: create a work item with a title, a type (feature / bug / test / spec), and the repository it belongs to.
- Someone (who: Product) can: see all work items as a board grouped by status, and change an item's status.
- Someone (who: Product) can: edit or delete a work item.
- Someone (who: Product) can: open a work item to design its feature (goes to the Feature Designer).

### look — What should it look like?
A board in the Product environment: columns by status, cards for work items showing title, type, and repository. A button to create a new item. Uses the Product tab's colour as its accent. Minimal, like the rest of the app.

### information — What information does this page show or collect?
- Work item title, type, status, and which repository it belongs to.

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
Work items — see [`CoperativeAIdb/WorkItem-model.json`](../CoperativeAIdb/WorkItem-model.json).

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
Unsaved edits to the item currently being created or edited.

### tests — How will we know it works? What should we test?
- Creating a work item shows it on the board and it is still there after restarting the app.
- Changing an item's status moves it to the right column.
- Deleting an item removes it from the board and the database.
- A work item must always have a title and a type.

### limits — Any known limits or things to watch out for?
The board should stay usable with a few hundred work items.

### model-and-effort — Which AI model and effort level should this page use by default?
Mid-range model, medium effort.

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
> - Round 2: …
