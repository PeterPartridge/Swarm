# Page Spec — Create Solution

> Produced by `/translate` from [`../../CoperativeAI/SolutionManagement.md`](../../CoperativeAI/SolutionManagement.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Page to create a solution.

**Model & effort**
Medium.

**Depends on**
- CoperativeAIdb/SolutionManagement-model.json
- CoperativeAIdb/AuditLog-model.json

**Actions**

| User | Can do |
|------|--------|
| Authenticated user | Create a solution, open an existing solution, delete a solution. |

**Information shown / collected**
- A list of the user's projects.

**Data to store**

| Item | What it looks like |
|------|----------------------|
| Create | Solution name + file location; writes an AuditLog entry. |
| Delete | Removes files at the location, deletes the SolutionManagement entry, writes an AuditLog entry. |

**Access & security**
Authenticated users only.

**Tests**
- [ ] The list of projects appears.
- [ ] "Create" navigates to the Creation Page.
- [ ] "Open" opens a project in the workspace page.
- [ ] "Delete" removes a project.

**Open questions**
- "Open opens a project in the workspace page" refers to a "workspace page" that has no brief anywhere in this project — needed before the "open" action can actually be built. Only "create" and "delete" are fully specced.
- No `in-memory` answer was given for this page.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| Audit logging pattern | Create/delete must write to AuditLog. | Reuse the shared "log an action" helper from the AuditLog page. | No — reused from AuditLog. |

---

## PLAN

**Summary:** Build the solution list/hub screen with create and delete working end to end; "open" is blocked on a missing workspace-page brief.

**Changes:**
- List screen querying `SolutionManagement` rows for the logged-in user's projects.
- Create button navigates to the Creation Page.
- Delete: remove the files at the stored location, delete the row, call the shared AuditLog helper.
- "Open" deliberately **not built** this round — there is no "workspace page" brief to build it against.

**Expected technical debt:** "Open" is incomplete by design, logged as a known gap rather than guessed at. Should be picked up once a workspace-page brief exists.

**Status:** approved for the create/delete slice — waiting for build (after SolutionManagement-model, AuditLog). "Open" is blocked, not approved.
