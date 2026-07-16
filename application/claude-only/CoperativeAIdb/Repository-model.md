# Page Spec — Repository (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/Repository-model.json`](../../CoperativeAIdb/Repository-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A code repository the user registered to work on in the app — the basis of multi-repository support.

**Model & effort**
Mid-range tier (Claude Sonnet 5), medium effort.

**Depends on**
- (none)

**Data to store**

| Field | What it looks like |
|-------|---------------------|
| id | Unique identifier (auto). |
| name | Text, unique. |
| localPath | Text, unique; must be an existing directory when saved. |
| remoteUrl, defaultBranch | Optional text. |
| isActive | Boolean; at most one row true. |
| createdAt | Timestamp. |

**Access & security**
Not sensitive. Path validated before save (solution security rule).

**Tests**
- [ ] name and localPath uniqueness enforced.
- [ ] Saving a nonexistent directory fails.
- [ ] Setting a repository active clears the previous active row (single-active invariant).
- [ ] Deleting a row never touches the folder on disk.

**Open questions**
- (none)

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| (covered by project skills) | Embedded db + path validation. | Table + parameterised queries in `src-tauri/src/db/`. | No. |

---

## PLAN

**Summary:** Create the Repository table and queries: create (with path validation), list, set-active (transactional single-active), delete.

**Changes:**
- Schema + CRUD in `src-tauri/src/db/repository.rs`; TDD (uniqueness, validation, single-active).

**Expected technical debt:** none anticipated.

**Status:** translated — waiting for approval
