---
spec: page
from: Swarm/SolutionManagement.md
deliverable:
depends-on: ["Swarmdb/SolutionManagement-model.json","workspaceShell.md"]
---
objective: a page to create a solution [why-exists]
model: medium effort [model-and-effort]
UNKNOWN: which model tier? The brief gives only "Medium" [model-and-effort]
action: create a solution, open an existing solution, delete a solution [actions]
look: a desktop page with a box in the centre listing projects, with create, edit and delete buttons at the side; double-clicking opens a solution [look]
UNKNOWN: what does the edit button do? The actions name create, open and delete only [look, actions]
info: the user's projects [information]
access: anyone using the app — single-user, no login [who-can-use]
store: creating a solution stores its name and file location in the SolutionManagement table [data-stored]
store: deleting removes the files at the location and deletes the entry [data-stored]
check: C1 a list of projects appears [tests]
check: C2 create goes to a creation screen [tests]
check: C3 open opens a project in the workspace page [tests]
check: C4 delete removes a project [tests]
limit: none [limits]
uses: Swarmdb SolutionManagement model [data-stored]

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — Create Solution

> Produced by `/translate` from [`../../Swarm/SolutionManagement.md`](../../Swarm/SolutionManagement.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Page to create a solution, open an existing solution, and delete a solution.

**Model & effort**
Mid-range tier (Claude Sonnet 5), medium effort.

**Depends on**
- `Swarmdb/SolutionManagement-model.json`
- `Swarm/workspaceShell.md`

**Actions**

| User | Can do |
|------|--------|
| Anyone using the app | Create a solution, open an existing solution (double-click), delete a solution. |

**Information shown / collected**
- A list of the user's projects.

**Data to store**

| Item | What it looks like |
|------|----------------------|
| Create | Solution name + file location, stored in the SolutionManagement table. |
| Delete | Removes files at the location and deletes the entry. |

**Access & security**
No login — single-user local desktop app (project security model). Deleting removes real files; the location is validated and confirmed before deletion.

**Tests**
- [ ] The list of projects appears.
- [ ] "Create" navigates to the Creation Page.
- [ ] "Open" opens a project in the workspace.
- [ ] "Delete" removes a project.

**Open questions**
- "Open opens a project in the workspace page": with the three-tab workspace shell now specced, confirm "open" means making the solution's repository active and switching to the Develop environment.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| (covered by project skills) | List/CRUD over an embedded table + file operations. | SolutionManagement queries + validated file deletion. | No. |

---

## PLAN

**Summary:** Build the solution list/hub screen with create and delete end to end; wire "open" to activate the solution's repository and switch to Develop (pending confirmation of the open question).

**Changes:**
- List screen querying `SolutionManagement` rows.
- Create button navigates to the Creation Page.
- Delete: remove the files at the stored location (validated + confirmed), delete the row.
- Open: pending the open-question confirmation.

**Expected technical debt:** "open" semantics need the confirmation above before that slice is built.

**Status:** built. The brief is marked `built` and its methods are in [`../Code_map.md`](../Code_map.md), but no build report was appended to this spec. (Until the 2026-10-07 documentation review, this line still read "translated — waiting for approval".)
