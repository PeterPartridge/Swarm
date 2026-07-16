---
form: page-brief
page: "Repository Management"
solution: "CoperativeAI"
depends-on: ["workspaceShell.md", "CoperativeAIdb/Repository-model.json"]
status: filled            # blank | filled | approved | built
---

# Page Brief — Repository Management

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So developers can work multi-repository: register the repositories the team works on, and switch between them. The code editor, terminal, and work items all point at a registered repository.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: a developer) can: add a repository by picking its local folder (and optionally noting its remote URL and default branch).
- Someone (who: a developer) can: see the list of registered repositories.
- Someone (who: a developer) can: switch the active repository — the editor and terminal then work in that repository.
- Someone (who: a developer) can: remove a repository from the list (the files on disk are not deleted).

### look — What should it look like?
A simple list in the Develop environment: one row per repository showing name, local path, and which one is active. Buttons to add, switch, and remove. Develop tab colour as accent.

### information — What information does this page show or collect?
- Repository name, local folder path, optional remote URL, default branch.
- Which repository is currently active.

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
Registered repositories — see [`CoperativeAIdb/Repository-model.json`](../CoperativeAIdb/Repository-model.json).

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
No.

### tests — How will we know it works? What should we test?
- Adding a repository with a valid local folder shows it in the list and it survives a restart.
- Adding a repository with a folder that doesn't exist is rejected with a clear message.
- Switching the active repository is reflected everywhere that shows it.
- Removing a repository removes the entry but leaves the folder on disk untouched.

### limits — Any known limits or things to watch out for?
Paths must be validated (exist, be a directory) before saving — per the solution's security rule on validating opened files/paths.

### model-and-effort — Which AI model and effort level should this page use by default?
Mid-range model, medium effort.

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
> - Round 2: …
