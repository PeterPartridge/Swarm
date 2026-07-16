# Page Spec — Repository Management

> Produced by `/translate` from [`../../CoperativeAI/repositoryManagement.md`](../../CoperativeAI/repositoryManagement.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Multi-repository support in the Develop environment: register the repositories the team works on and switch the active one — the editor, terminal, and work items all point at a registered repository.

**Model & effort**
Mid-range tier (Claude Sonnet 5), medium effort.

**Depends on**
- `CoperativeAI/workspaceShell.md`
- `CoperativeAIdb/Repository-model.json`

**Actions**

| User | Can do |
|------|--------|
| Developer | Add a repository by picking its local folder (optional remote URL, default branch). |
| Developer | See the list of registered repositories. |
| Developer | Switch the active repository. |
| Developer | Remove a repository (files on disk untouched). |

**Information shown / collected**
- Name, local path, optional remote URL, default branch, which is active.

**Data to store**

| Item | What it looks like |
|------|--------------------|
| Repositories | See the Repository model spec. |

**Access & security**
No login (project security model). Paths are validated (exist, are directories) before saving — per the solution's file-validation security rule.

**Tests**
- [ ] Valid folder adds and survives restart.
- [ ] Nonexistent folder is rejected with a clear message.
- [ ] Switching active is reflected everywhere it's shown.
- [ ] Removing an entry leaves the folder on disk.

**Open questions**
- (none)

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| Native folder picker | Adding a repo means picking a real local folder. | Tauri dialog plugin for directory selection; backend validates the path. | Yes. |

---

## PLAN

**Summary:** Build repository registration on the Repository table: add/list/switch/remove commands with path validation, and a simple list UI in the Develop environment.

**Changes:**
- Tauri commands: add (validate path), list, set-active (enforce single active), remove.
- List page with add/switch/remove controls.
- Vitest for the list UI; cargo tests for commands and the single-active invariant.

**Expected technical debt:** none anticipated.

**Status:** translated — waiting for approval
