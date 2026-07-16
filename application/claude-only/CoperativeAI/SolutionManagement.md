# Page Spec — Create Solution

> Produced by `/translate` from [`../../CoperativeAI/SolutionManagement.md`](../../CoperativeAI/SolutionManagement.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Page to create a solution, open an existing solution, and delete a solution.

**Model & effort**
Mid-range tier (Claude Sonnet 5), medium effort.

**Depends on**
- `CoperativeAIdb/SolutionManagement-model.json`
- `CoperativeAI/workspaceShell.md`

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

**Status:** translated — waiting for approval
