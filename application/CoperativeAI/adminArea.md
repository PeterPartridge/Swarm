---
form: page-brief
page: "Admin Area"
solution: "CoperativeAI"
depends-on: ["workspaceShell.md", "CoperativeAIdb/Role-model.json", "CoperativeAIdb/TeamMember-model.json"]
status: built            # blank | filled | approved | built
---

# Page Brief — Admin Area

> **Who fills this in:** Product describes what the page is for; Developers add the building details.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So the team is set up and access is controlled: assign each team member a role, and control what each role can access (Product / Develop / Test / Admin areas) and see (the cost / profit / chargeable fields on work items). The app has no login — roles gate visibility only.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Add / remove team members and assign each a role.
- Add roles and edit each role's area access and field visibility (see cost / profit / chargeable).
- (Via the header "Working as…" picker) choose the active user; their role decides which tabs and cost fields the workspace shows.

### look — What should it look like?
A team-members card and a roles table (rows = roles, columns = the access + field-visibility toggles) in the Admin environment (its own colour).

### information — What information does this page show or collect?
- Team members and their roles; roles and their permission flags.

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login. The Admin role is the one that can always reach this area.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
Roles — see [`CoperativeAIdb/Role-model.json`](../CoperativeAIdb/Role-model.json). Team members reference a role — see [`CoperativeAIdb/TeamMember-model.json`](../CoperativeAIdb/TeamMember-model.json). The active user is a system setting.

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
The add forms' unsaved input.

### tests — How will we know it works? What should we test?
- Members list and can be assigned a role; roles can be added and their flags toggled.
- The Admin role can't be deleted or weakened (never lock yourself out).
- Changing the active user changes which tabs and cost fields the workspace shows.

### limits — Any known limits or things to watch out for?
Gating is advisory visibility, not security — anyone can switch the active user. That matches the single-user local model.

### model-and-effort — Which AI model and effort level should this page use by default?
Mid-range model, medium effort.

---

## Part 4 — changes-over-time

- Round 2 (my feedback): Admin must also control **who may manage the AI budget and strategy** — a role-level permission alongside the cost/profit/chargeability visibility flags.

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
> - Round 2: …
