# Page Spec — AuditLog (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/AuditLog-model.json`](../../CoperativeAIdb/AuditLog-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Records actions taken in the application, for accountability.

**Model & effort**
Defaults to the project's mid-range tier (Claude Sonnet 5, medium effort).

**Depends on**
- (none declared)

**Data to store**

| Field | What it looks like |
|-------|---------------------|
| id | Unique identifier. |
| action | String, e.g. "create"/"update"/"delete". |
| userId | The user who performed the action. |
| timestamp | When it happened. |
| details | Optional free text. |
| CustomNotes | Optional free text. |

**Access & security**
Retained 6 months, then archived to secure storage for 5 years before permanent deletion.

**Tests**
- [ ] Every log row has a userId and a timestamp.
- [ ] Creating/updating/deleting a solution (via SolutionManagement) writes a matching AuditLog row.

**Open questions**
- `userId` is a plain string field, not a declared foreign key to UserCredentials — confirm whether it should be a proper relationship.
- `CustomNotes` breaks the field's own camelCase convention (`customNotes`) used by every other field in this model — confirm intended casing.
- The 6-month-then-5-year archive/retention policy isn't something turso enforces on its own — confirm whether this is a manual admin task or something the app should automate (e.g. a scheduled job), since nothing in the scaffold currently runs background jobs.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| Audit logging pattern | Multiple pages (SolutionManagement) need to write to this log. | Provide a shared "log an action" helper other pages call, per the DRY house rule. | Yes. |

---

## PLAN

**Summary:** Create the `AuditLog` table. No dependencies — can be built any time before the first page that writes to it (SolutionManagement).

**Changes:**
- Define the schema as specified, preserving the field names and casing exactly as given (including `CustomNotes`) rather than silently "fixing" the inconsistency — flagged above instead.
- Provide a small shared helper (e.g. `log_action(user_id, action, details)`) that other pages call, so the DRY rule is satisfied from the start rather than each page writing its own insert.

**Expected technical debt:** the retention/archival policy (6 months → 5-year archive → delete) is not automated by this build — logged as debt until a scheduled-job mechanism is designed.

**Status:** approved — waiting for build
