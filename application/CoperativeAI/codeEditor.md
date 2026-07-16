---
form: page-brief
page: "Code Editor"
solution: "CoperativeAI"
depends-on: ["repositoryManagement.md"]
status: filled            # blank | filled | approved | built
---

# Page Brief — Code Editor

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So developers can read and write code inside the app: a real code editor over the active repository's files, with a file tree to navigate.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: a developer) can: browse the active repository's files in a tree.
- Someone (who: a developer) can: open a file in the editor with syntax highlighting.
- Someone (who: a developer) can: edit and save a file.
- Someone (who: a developer) can: have several files open in editor tabs and switch between them.

### look — What should it look like?
The Develop environment: file tree on the left, editor filling the rest, open-file tabs above the editor. Like VS Code but minimal. Develop tab colour as accent.

### information — What information does this page show or collect?
- The active repository's folder and file names.
- The contents of open files, and whether a file has unsaved changes.

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
Nothing new in the database — files are read from and written to the repository on disk. (Which repository is active comes from Repository Management.)

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
Open tabs, unsaved edits, and the expanded/collapsed state of the file tree.

### tests — How will we know it works? What should we test?
- The file tree shows the active repository's files and folders.
- Opening a file shows its content with highlighting for its language.
- Saving writes the change to disk (verified by reading the file back).
- A file with unsaved changes is clearly marked, and switching tabs doesn't lose edits.
- Files outside the active repository cannot be opened through this page.

### limits — Any known limits or things to watch out for?
Use Monaco (per the solution spec) and load it lazily — it is heavy, and the app must stay light on low-spec machines. Very large files should open read-only or warn.

### model-and-effort — Which AI model and effort level should this page use by default?
Most capable model, high effort.

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
> - Round 2: …
