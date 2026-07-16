# Page Spec — SystemSetting (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/SystemSetting-model.json`](../../CoperativeAIdb/SystemSetting-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

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
