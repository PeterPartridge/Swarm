# Page Spec — Solution Management (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/SolutionManagement-model.json`](../../CoperativeAIdb/SolutionManagement-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Tracks the files and versions belonging to each solution created through the app.

**Model & effort**
Defaults to the project's mid-range tier (Claude Sonnet 5, medium effort).

**Depends on**
- (none declared)

**Data to store**

| Field | What it looks like |
|-------|---------------------|
| id | Unique identifier. |
| Filename, Filepath, Version | Strings. |
| CreatedAt, UpdatedAt | Timestamps. |

**Access & security**
Not marked sensitive.

**Tests**
- [ ] A row's data survives until its file (or the whole solution) is deleted, per the retention answer.

**Open questions**
- Field descriptions in the brief are all generic placeholders ("string", "string", "date") rather than saying what each field actually represents — e.g. what "Version" means (a semantic version string? an iteration/round number?) is unclear.
- Field casing (`Filename`, `Filepath`) is PascalCase, unlike every other model in this project (camelCase). Not silently normalised — flagged for a decision.
- No `invariants` answer given — e.g. is Filepath expected to be unique per solution?

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| File/version tracking | Backs the SolutionManagement and Creation Page screens. | Model + query the list of a user's solutions. | Yes. |

---

## PLAN

**Summary:** Create the table backing the "list of my solutions" screen. No dependencies.

**Changes:**
- Define the schema exactly as given (including the PascalCase field names, per the "don't invent" rule — not normalised to camelCase without confirmation).
- Given the open questions on field meaning, this build should implement only what's unambiguous (id, filename, filepath, timestamps) and flag `Version`'s semantics for confirmation before any versioning logic is written on top of it.

**Expected technical debt:** the `Version` field's real meaning is unresolved; whatever it's used for downstream should be treated as provisional until clarified.

**Status:** approved — waiting for build
