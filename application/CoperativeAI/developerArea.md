---
form: page-brief
page: "Developer Area"
solution: "CoperativeAI"
depends-on: ["workspaceShell.md", "CoperativeAIdb/TeamMember-model.json"]
status: built            # blank | filled | approved | built
---

# Page Brief — Developer Area

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So the team is set up in one place: the Develop tab's Developer Area holds the team members (name + role) that Planning assigns work to. The app has no logins — these are names, not accounts.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: a developer) can: add a team member with a name and a role (Developer / QA / Product / Designer).
- Someone (who: a developer) can: see the team list.
- Someone (who: a developer) can: remove a team member — their assigned work items simply become unassigned.

### look — What should it look like?
A simple team list card in the Develop environment: one row per member with name and role, an add form above it. Develop tab colour as accent.

### information — What information does this page show or collect?
- Team member names and roles. Nothing else — no contact details, no credentials.

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
Team members — see [`CoperativeAIdb/TeamMember-model.json`](../CoperativeAIdb/TeamMember-model.json).

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
The add form's unsaved input.

### tests — How will we know it works? What should we test?
- Adding a member with a name and role shows them in the list and survives a restart.
- Duplicate names are rejected.
- Removing a member clears them from any work items they were assigned to, without deleting the items.

### limits — Any known limits or things to watch out for?
No.

### model-and-effort — Which AI model and effort level should this page use by default?
Cheapest model, low effort.

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
- Round 2 (my feedback): Move team-member management to the new Admin area (users are assigned roles there). The Develop area keeps solution creation and AI settings, and will gain a Technical Strategy section and Board/Sprint/List views in a later round.
- Round 3 (my feedback): The Develop area needs a **Technical Strategy** section — required infrastructure, architecture requirements, solution creation guidelines, and dependencies / environment prerequisites. It must also offer **Board**, **Sprint**, and **List** views of the work, with **filtering by assigned user**. Pick a Product at the top of the Develop area to work against it.
