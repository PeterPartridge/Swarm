---
spec: page
from: Swarm/repositoryManagement.md
deliverable:
depends-on: ["workspaceShell.md", "Swarmdb/Repository-model.json"]
---
objective: let developers work across repositories — register the team's repositories and switch between them; the code editor, terminal and work items all point at a registered repository [why-exists]
model: mid-range model, medium effort [model-and-effort]
action: a developer adds a repository by picking its local folder, optionally noting its remote URL and default branch [actions]
action: a developer sees the registered repositories [actions]
action: a developer switches the active repository, and the editor and terminal then work in it [actions]
action: a developer removes a repository from the list; the files on disk are not deleted [actions]
look: a simple list in Develop — one row per repository with name, local path and which is active; buttons to add, switch and remove; Develop's tab colour as accent [look]
info: repository name, local folder path, optional remote URL, default branch; which is active [information]
access: anyone using the app — single-user, no login [who-can-use]
store: registered repositories — Swarmdb/Repository-model.json [data-stored]
store: nothing in memory [in-memory]
check: C1 adding a repository with a valid local folder lists it, and it survives a restart [tests]
check: C2 adding a repository whose folder does not exist is rejected with a clear message [tests]
check: C3 switching the active repository shows everywhere that shows it [tests]
check: C4 removing a repository removes the entry and leaves the folder on disk untouched [tests]
limit: paths are validated — they exist and are directories — before saving [limits]
uses: Swarmdb Repository model [data-stored]

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — Repository Management

> Produced by `/translate` from [`../../Swarm/repositoryManagement.md`](../../Swarm/repositoryManagement.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Multi-repository support in the Develop environment: register the repositories the team works on and switch the active one — the editor, terminal, and work items all point at a registered repository.

**Model & effort**
Mid-range tier (Claude Sonnet 5), medium effort.

**Depends on**
- `Swarm/workspaceShell.md`
- `Swarmdb/Repository-model.json`

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

**Status:** built. The brief is marked `built` and its methods are in [`../Code_map.md`](../Code_map.md), but no build report was appended to this spec. (Until the 2026-10-07 documentation review, this line still read "translated — waiting for approval".)
