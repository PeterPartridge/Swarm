---
form: page-brief
page: "Create Solution"
solution: "CoperativeAI"
depends-on: ["CoperativeAIdb/SolutionManagement-model.json","workspaceShell.md"]           # briefs that must be built first, e.g. [ClothingAPI/Login.json]
status: filled            # blank | filled | approved | built
---

# Page Brief — <Page Name>

> **Who fills this in:** Product describes what the page is for; Developers add the building details. One of these per page (a page is one screen or section of the project).
>
> **Where it goes:** copy this file into the website **solution folder**, named after the page — e.g. `ClothingWebsite/userLogin.md`. Fill in `page` and `solution` at the top.
>
> **How:** answer each question in plain English directly under its heading, same as the Project Brief. Lines starting with `>` are guidance — anything else you write under a heading is your answer. When you're done, set `status: filled` and hand it to Claude using the bridge in [`claude-only/1-translate-to-claude.md`](../claude-only/1-translate-to-claude.md).

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
Page to create a solution

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
Page to create a solution, open an exiting solution and delete a solution

### look — What should it look like?
Desktop application with a box in the center displaying a list of projects and a create, edit and delete button on the side. Double clicking opens a solution.

### information — What information does this page show or collect?
List of users projects

### who-can-use — Who is allowed to use this page?
Anyone using the app — it is a single-user local desktop application with no login.

---

## Part 3 — Building Details *(Developers answer)*

> For each endpoint this page needs, copy [`_forms/endpoint.json`](../_forms/endpoint.json) into this solution folder. For each data model it stores, copy [`_forms/database-model.json`](../_forms/database-model.json). Link them from here.

### data-stored — What information needs to be stored, and what does each bit look like?
If we create a new solution the name and file location are stored in the SolutionManagement table.
When we delete we remove the files at location and delete the entry.


### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?


### tests — How will we know it works? What should we test?
A list of projects appears
Create goes to a creation screen, 
open opens a project in the workspace page 
Delete removes a project

### limits — Any known limits or things to watch out for?
No

### model-and-effort — Which AI model and effort level should this page use by default?
Medium

---

## Part 4 — changes-over-time

> You don't fill this in at the start. Each time you come back to improve the page, add a bullet describing **what you want to change** — a new action, a design tweak, a fix. Keep changes small.
> - Round 2: …
