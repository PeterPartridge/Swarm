# Page Spec — RoadMap

> Produced by `/translate` from [`../../CoperativeAI/roadMap.md`](../../CoperativeAI/roadMap.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A Product workspace screen showing the plan over time: hierarchy items grouped into lanes — per sprint (sprints mode, dates shown when set, plus Unscheduled) or per status (kanban mode) — per the roadmapMode setting. Undated work fully supported.

**Depends on**
- `CoperativeAI/productPlanning.md`, `CoperativeAIdb/Sprint-model.json`, `CoperativeAIdb/SystemSetting-model.json`

**Tests**
- [x] Sprints mode: one lane per sprint (with dates) + Unscheduled; items in their sprint's lane.
- [x] Kanban mode: one lane per status; no sprint form.
- [x] Dateless sprints/items display cleanly.
- [x] Creating a sprint (with or without dates) adds its lane.
- [x] Only hierarchy items shown — bugs/tests stay on the Planning board.

**Status:** built (2026-07-16)

## Report back
Implemented as `src/components/RoadMap.tsx` (lanes + sprint-create form), reachable from the Product workspace menu and as a pulled-out OS window (`?window=roadmap`). 4 Vitest tests per the list above. First iteration is grouped lanes, not a drawn timeline — Gantt-style visuals logged as a future round per the brief's limits answer.
