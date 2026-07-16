---
form: page-brief
page: "Workspace Shell"
solution: "CoperativeAI"
depends-on: []           # briefs that must be built first, e.g. [ClothingAPI/Login.json]
status: built            # blank | filled | approved | built
---

# Page Brief — Workspace Shell

> **Who fills this in:** Product describes what the page is for; Developers add the building details. One of these per page (a page is one screen or section of the project).
>
> **Where it goes:** copy this file into the website **solution folder**, named after the page — e.g. `ClothingWebsite/userLogin.md`. Fill in `page` and `solution` at the top.
>
> **How:** answer each question in plain English directly under its heading, same as the Project Brief. Lines starting with `>` are guidance — anything else you write under a heading is your answer. When you're done, set `status: filled` and hand it to Claude using the bridge in [`claude-only/1-translate-to-claude.md`](../claude-only/1-translate-to-claude.md).

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
> The one main job of this page. This shouldn't change much over time.
It is the main window of the app: a top menu with three tabs — Product, Develop, Test — each with its own colour. Clicking a tab enters that environment. Everything else in the app lives inside one of these three environments.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
> List the actions, with who does them.
- Someone (who: anyone using the app) can: click the Product, Develop, or Test tab in the top menu to enter that environment.
- Someone (who: anyone using the app) can: always see which environment they are in from the active tab and its colour.
- Someone (who: anyone using the app) can: customise the colours of the app, including each tab's colour.

### look — What should it look like?
> Link a sketch, or describe it. "Like the rest of the app" is fine.
Minimal and easy to use. A horizontal menu bar across the top of the window with three tabs: Product, Develop, Test. Each tab has its own distinct colour so you always know which environment you are in — the active tab's colour also accents the environment below it. The rest of the window is the current environment's content.

### information — What information does this page show or collect?
> List the bits of information, in everyday words, one bullet each.
- Which environment is currently active (Product, Develop, or Test).
- The user's colour choices.

### who-can-use — Who is allowed to use this page?
> Everyone? Only logged-in users? Only admins?
Anyone using the app — it is a single-user local desktop application with no login.

---

## Part 3 — Building Details *(Developers answer)*

> For each endpoint this page needs, copy [`_forms/endpoint.json`](../_forms/endpoint.json) into this solution folder. For each data model it stores, copy [`_forms/database-model.json`](../_forms/database-model.json). Link them from here.

### data-stored — What information needs to be stored, and what does each bit look like?
> e.g. "Order number (a number), Date (a date), Status (one of: placed / shipped / delivered)."
The user's colour choices (a small set of named colours, e.g. tab colours), stored locally so they survive restarts. Nothing else — the tabs themselves are fixed.

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
> e.g. items in a basket before checkout. "No" is common.
Which tab is currently active.

### tests — How will we know it works? What should we test?
> Plain checks are fine, one bullet each.
- The app opens straight into the workspace with the three tabs visible — no login screen.
- Clicking Product, Develop, or Test switches to that environment.
- Each tab shows its own colour, and the active tab is clearly marked.
- Changing a colour updates the UI and is remembered after restarting the app.

### limits — Any known limits or things to watch out for?
> e.g. "This page can get slow if there are thousands of orders."
Must stay light — this shell is always loaded. Heavy panels (editor, terminal) load only when their environment needs them.

### model-and-effort — Which AI model and effort level should this page use by default?
> Pick from the project's tiers (see the Project Brief).
Mid-range model, medium effort.

---

## Part 4 — changes-over-time

> You don't fill this in at the start. Each time you come back to improve the page, add a bullet describing **what you want to change** — a new action, a design tweak, a fix. Keep changes small.
> - Round 2: …
