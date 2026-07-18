---
form: page-brief
page: "Solution Creation"
solution: "CoperativeAI"
depends-on: ["workspaceShell.md", "CoperativeAIdb/Solution-model.json"]
status: built            # blank | filled | approved | built
---

# Page Brief — Solution Creation

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So developers can create a Solution in the Develop tab and link it to a Product — answering the solution-spec questions (what kind of solution, its purpose, hosting, language, frameworks). Solutions are the developer-side counterpart of the Product's plan.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: a developer) can: create a Solution with a name, the Product it belongs to, its type (website / api / database / application), and the core solution questions.
- Someone (who: a developer) can: see existing Solutions grouped by Product.
- Someone (who: a developer) can: delete a Solution.

### look — What should it look like?
A "Create a Solution" card in the Develop environment: name, Product dropdown, type dropdown, and the question fields; below it, the list of Solutions grouped by Product. Develop tab colour as accent.

### information — What information does this page show or collect?
- Solution name, linked Product, type, and the plain-English answers (purpose, hosting, language, frameworks).

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
Solutions — see [`CoperativeAIdb/Solution-model.json`](../CoperativeAIdb/Solution-model.json).

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
The form's unsaved answers.

### tests — How will we know it works? What should we test?
- Creating a Solution requires a name, an existing Product, and a valid type.
- A created Solution appears under its Product and survives a restart.
- Deleting a Solution removes it without touching the Product or its work items.

### limits — Any known limits or things to watch out for?
This creates the planning-level Solution record — generating the framework's actual solution files on disk stays with the Creation Page (self-hosting roadmap item).

### model-and-effort — Which AI model and effort level should this page use by default?
Mid-range model, medium effort.

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
- Round 2 (my feedback): For Developers we can create a solution **or import a solution**, link it to a Product, and then **link it to a GitHub repository or create one in GitHub as private or public**.
