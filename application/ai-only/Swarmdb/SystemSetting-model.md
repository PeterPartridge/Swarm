---
spec: model
from: Swarmdb/SystemSetting-model.json
deliverable:
depends-on: []
---
objective: A named app-wide setting stored as JSON. First settings: planningHierarchy (how Products are planned — which work-item levels exist and their order) and roadmapMode (sprints or kanban). [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: key — text, required — unique; not empty — The setting's name, e.g. planningHierarchy [fields.entries.1]
field: value — text, required, default null — valid JSON — The setting's value as JSON [fields.entries.2]
field: updatedAt — date, required, default now — updated on every change — When the setting last changed [fields.entries.3]
index: key [lookupsAndPerformance.answer.0]
retention: Settings persist for the life of the installation; unknown keys are never invented by the app. [lifecycleAndRules.retention]
sensitive: No — and never store secrets or API keys here (they belong in the OS credential store, per the solution's security rules). [lifecycleAndRules.sensitiveFields]
invariant: planningHierarchy is one of exactly three presets: [epic, feature, userStory, task] (default), [feature, userStory, task], [feature, task]. roadmapMode is 'sprints' (default) or 'kanban'. Values always parse as JSON. [lifecycleAndRules.invariants]

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — SystemSetting (database model)

> Produced by `/translate` from [`../../Swarmdb/SystemSetting-model.json`](../../Swarmdb/SystemSetting-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Named app-wide settings stored as JSON. First settings: `planningHierarchy` (how Products are planned) and `roadmapMode` (sprints | kanban). Never stores secrets (project security rule).

**Data to store**
id · key (unique, non-empty) · value (valid JSON) · updatedAt.

**Invariants / tests**
- [x] `planningHierarchy` restricted to exactly three presets — [epic, feature, userStory, task] (default), [feature, userStory, task], [feature, task].
- [x] `roadmapMode` restricted to sprints (default) / kanban.
- [x] Unset keys fall back to defaults; non-JSON values rejected.

**Status:** built (2026-07-16)

## Report back
Implemented as `src-tauri/src/db/system_setting.rs` (`get/set` + typed `get_planning_hierarchy`/`set_planning_hierarchy`/`get_roadmap_mode`/`set_roadmap_mode`, presets as `HIERARCHY_PRESETS`) with cargo tests per the invariants. Command layer: `commands/settings.rs`.
