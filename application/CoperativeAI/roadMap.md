---
form: page-brief
page: "RoadMap"
solution: "CoperativeAI"
depends-on: ["productPlanning.md", "CoperativeAIdb/Sprint-model.json", "CoperativeAIdb/SystemSetting-model.json"]
status: built            # blank | filled | approved | built
---

# Page Brief — RoadMap

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So a Product's plan can be seen over time: epics, features and the rest laid out by when they happen — in sprints, or Kanban style — using the times on work items. It is a screen of the Product workspace, next to Planning.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: anyone on the team) can: open RoadMap from the Product workspace menu (and pull it out into its own OS window).
- Someone (who: anyone on the team) can: see the Product's hierarchy items grouped into lanes — one lane per sprint (with the sprint's dates when set) in sprints mode, or one lane per status in kanban mode.
- Someone (who: anyone on the team) can: see items that aren't scheduled in an "Unscheduled" lane — teams that don't set times still get a useful roadmap.
- Someone (who: anyone on the team) can: create a sprint (name, optional start/end dates).

### look — What should it look like?
Horizontal lanes filling the workspace, each lane titled with its sprint (and dates) or status; items shown as small cards with type badge, title, and dates when set. Product tab colour as accent.

### information — What information does this page show or collect?
- The Product's work items with their type, status, sprint, and optional dates.
- The Product's sprints with their optional dates.
- Which roadmap mode is active (from the roadmapMode setting).

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
Sprints — see [`CoperativeAIdb/Sprint-model.json`](../CoperativeAIdb/Sprint-model.json). Item scheduling lives on the work items themselves (sprintId, startDate, endDate).

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
No.

### tests — How will we know it works? What should we test?
- Sprints mode shows one lane per sprint plus Unscheduled; items appear in their sprint's lane.
- Kanban mode shows one lane per status.
- Items and sprints without dates display cleanly (no forced times).
- Creating a sprint adds its lane.

### limits — Any known limits or things to watch out for?
First iteration is grouped lanes, not a drawn timeline/Gantt — that's a later round.

### model-and-effort — Which AI model and effort level should this page use by default?
Mid-range model, medium effort.

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
> - Round 2: …
