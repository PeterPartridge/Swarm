# Page Spec — Developer Area

> Produced by `/translate` from [`../../CoperativeAI/developerArea.md`](../../CoperativeAI/developerArea.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
The Develop tab's team list: add/remove team members (name + role) that Planning assigns work to. Names, not accounts — the app has no logins.

**Depends on**
- `CoperativeAI/workspaceShell.md`, `CoperativeAIdb/TeamMember-model.json`

**Tests**
- [x] Adding a member (name + role) shows them in the list (persisted via the TeamMember table).
- [x] Duplicate names rejected (backend rule, surfaced as the error alert).
- [x] Removing a member unassigns their items without deleting them (backend-tested; UI calls remove).

**Status:** built (2026-07-16)

## Report back (round 1)
Implemented inside `src/pages/DevelopSolutions.tsx` over `commands/team_members.rs`.

## Round 2 — team management moved to Admin
Team members + roles now live in the Admin area (`pages/AdminArea.tsx`); the Develop area no longer manages team.

## Round 3 — Technical Strategy + Board/Sprint/List views

**Behaviour:** the Develop area gains a **Product picker**; for the chosen Product it shows a **Technical Strategy** section (required infrastructure, architecture requirements, solution creation guidelines, dependencies/env prerequisites) and a **work-views** panel with **Board / Sprint / List** views, all **filterable by assigned user**.

**Implemented (pure frontend over existing commands — no backend change):**
- `components/StrategyEditor.tsx` — generic structured-strategy editor (labelled textareas → one JSON doc per (product, area)); Develop uses area `develop` with `DEVELOP_STRATEGY_FIELDS`. Reused for the Test area later.
- `components/WorkItemViews.tsx` — Board (status columns), Sprint (lanes by sprint + Unscheduled), List (flat table), with an assignee filter (Everyone / Unassigned / each member).
- `pages/DevelopSolutions.tsx` reworked: Product picker → StrategyEditor + WorkItemViews, above the Create-a-Solution card and AI Settings.

**Tests:** Vitest 45/45 (WorkItemViews: default board, switch to list/sprint, filter-by-user hides other members' items; DevelopSolutions: strategy + views present). Build clean.

**Technical debt:** the views are read-only (editing stays on the Planning board); the strategy field shape is app-defined JSON (validated only as JSON); no cross-product "all my work" view yet (scoped per selected Product).
