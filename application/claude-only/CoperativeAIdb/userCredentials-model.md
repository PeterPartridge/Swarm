# Page Spec — UserCredentials (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/userCredentials-model.json`](../../CoperativeAIdb/userCredentials-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Stores login credentials and account state for every user of the application.

**Model & effort**
Defaults to the project's mid-range tier (Claude Sonnet 5, medium effort).

**Depends on**
- CoperativeAIdb/Role-model.json

**Data to store**

| Field | What it looks like |
|-------|---------------------|
| id | Unique identifier (key). |
| username | Unique string. |
| passwordHash | Hashed password — never plain text. |
| role | Foreign key → Role.id; exactly one per user. |
| createdAt / updatedAt | Timestamps. |
| lastLogin | Nullable timestamp. |
| failedLoginAttempts | Number, drives lockout. |
| isLocked / isActive | Booleans. |

**Access & security**
Sensitive fields: username, passwordHash. Rows are created only via First Run Setup (the first one) or by a Super Admin (subsequent ones — page not yet defined).

**Tests**
- [ ] Every user has exactly one role, referencing an existing Role.
- [ ] Deleting or locking the last Super Admin user is rejected.
- [ ] username is unique.
- [ ] Repeated failed logins increments failedLoginAttempts and eventually sets isLocked.

**Open questions**
- No page yet handles admin-driven user creation/editing/deletion beyond the First Run Setup bootstrap case.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| Password hashing | passwordHash must never be plain text. | Hash on account creation, verify on login. | Yes. |

---

## PLAN

**Summary:** Create the `UserCredentials` table, referencing `Role` by foreign key. No rows exist until First Run Setup creates the first one.

**Changes:**
- Define the schema (id, username, passwordHash, role FK, timestamps, lockout fields) per the turso-embedded boilerplate.
- Implement password hashing (argon2 or equivalent) — hash on write, verify on read; never store or log plain text.
- Enforce the "last Super Admin can't be deleted/locked" invariant at the service layer.

**Expected technical debt:** account creation/editing beyond First Run Setup isn't built yet — there's no admin user-management page. That's expected; it's simply not yet in scope.

**Status:** approved — waiting for build (after Role)
