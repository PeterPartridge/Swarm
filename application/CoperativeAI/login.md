---
form: page-brief
page: "login"
solution: "CoperativeAI"
depends-on: ["CoperativeAIdb/userCredentials-model.json"]           # briefs that must be built first, e.g. [ClothingAPI/Login.json]
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
This is the login page for users 

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
Login. (If no users exist yet, the First Run Setup page is shown instead — see `firstRunSetup.md`.)

### look — What should it look like?
Desktop application with a box in the center displaying login / log out

### information — What information does this page show or collect?
User name and password

### who-can-use — Who is allowed to use this page?
Everyone

---

## Part 3 — Building Details *(Developers answer)*

> For each endpoint this page needs, copy [`_forms/endpoint.json`](../_forms/endpoint.json) into this solution folder. For each data model it stores, copy [`_forms/database-model.json`](../_forms/database-model.json). Link them from here.

### data-stored — What information needs to be stored, and what does each bit look like?
username string encrypted, password string encrypted 

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
That the user is authenticated and their role

### tests — How will we know it works? What should we test?
A user can login with correct credentials
A user with bad credentials cannot login
The account created via First Run Setup can log in immediately afterwards

### limits — Any known limits or things to watch out for?
No

### model-and-effort — Which AI model and effort level should this page use by default?
Medium

---

## Part 4 — changes-over-time

> You don't fill this in at the start. Each time you come back to improve the page, add a bullet describing **what you want to change** — a new action, a design tweak, a fix. Keep changes small.
> - Round 2: …
