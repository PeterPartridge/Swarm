---
spec: page
from: Swarm/roadMap.md
deliverable:
depends-on: ["productPlanning.md", "Swarmdb/Sprint-model.json", "Swarmdb/SystemSetting-model.json"]
---
objective: show a Product's plan over time — epics, features and the rest laid out by when they happen, in sprints or Kanban style, from the times on work items; a screen of the Product workspace beside Planning [why-exists]
model: mid-range model, medium effort [model-and-effort]
action: anyone opens RoadMap from the Product workspace menu, and can pull it out into its own OS window [actions]
action: anyone sees the Product's hierarchy items in lanes — one per sprint, with its dates when set, in sprints mode; one per status in kanban mode [actions]
action: anyone sees unscheduled items in an "Unscheduled" lane [actions]
action: anyone creates a sprint — name, optional start and end dates [actions]
look: horizontal lanes filling the workspace, each titled with its sprint and dates or its status; items as small cards with type badge, title and dates when set; Product's tab colour as accent [look]
info: the Product's work items with type, status, sprint and optional dates [information]
info: the Product's sprints with optional dates [information]
info: which roadmap mode is active, from the roadmapMode setting [information]
access: anyone using the app — single-user, no login [who-can-use]
store: sprints — Swarmdb/Sprint-model.json; scheduling lives on the work items — sprintId, startDate, endDate [data-stored]
store: nothing in memory [in-memory]
check: C1 sprints mode shows one lane per sprint plus Unscheduled, with items in their sprint's lane [tests]
check: C2 kanban mode shows one lane per status [tests]
check: C3 items and sprints without dates display cleanly, with no forced times [tests]
check: C4 creating a sprint adds its lane [tests]
limit: grouped lanes, not a drawn timeline or Gantt chart [limits]
uses: Swarmdb Sprint, WorkItem and SystemSetting models [data-stored, information]

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — RoadMap

> Produced by `/translate` from [`../../Swarm/roadMap.md`](../../Swarm/roadMap.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A Product workspace screen showing the plan over time: hierarchy items grouped into lanes — per sprint (sprints mode, dates shown when set, plus Unscheduled) or per status (kanban mode) — per the roadmapMode setting. Undated work fully supported.

**Depends on**
- `Swarm/productPlanning.md`, `Swarmdb/Sprint-model.json`, `Swarmdb/SystemSetting-model.json`

**Tests**
- [x] Sprints mode: one lane per sprint (with dates) + Unscheduled; items in their sprint's lane.
- [x] Kanban mode: one lane per status; no sprint form.
- [x] Dateless sprints/items display cleanly.
- [x] Creating a sprint (with or without dates) adds its lane.
- [x] Only hierarchy items shown — bugs/tests stay on the Planning board.

**Status:** built (2026-07-16)

## Report back
Implemented as `src/components/RoadMap.tsx` (lanes + sprint-create form), reachable from the Product workspace menu and as a pulled-out OS window (`?window=roadmap`). 4 Vitest tests per the list above. First iteration is grouped lanes, not a drawn timeline — Gantt-style visuals logged as a future round per the brief's limits answer.
