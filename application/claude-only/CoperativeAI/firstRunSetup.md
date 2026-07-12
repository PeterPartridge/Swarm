# Page Spec — First Run Setup

> Produced by `/translate` from [`../../CoperativeAI/firstRunSetup.md`](../../CoperativeAI/firstRunSetup.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
So the very first time the app runs — before any user exists — someone can create the Super Admin account themselves, instead of the app shipping with a default account or password.

**Model & effort**
Medium — a straightforward form, but security-sensitive since the account it creates has full permissions.

**Depends on**
- CoperativeAIdb/Role-model.json
- CoperativeAIdb/userCredentials-model.json

**Actions**

| User | Can do |
|------|--------|
| Whoever first launches the app | Create the Super Admin account by choosing their own username and password. |

**Information shown / collected**
- Username, password, confirm password.

**Data to store**

| Item | What it looks like |
|------|----------------------|
| One UserCredentials row | Chosen username, hashed password, role = Super Admin, isActive = true, isLocked = false. |

**Access & security**
Shown only while the UserCredentials table is empty; never shown again once at least one user exists.

**Tests**
- [ ] On first run with no users, this screen shows instead of login.
- [ ] Password and confirm-password must match to create the account.
- [ ] After creation, relaunching shows the normal login page, not this screen.
- [ ] The created account has the Super Admin role and can log in immediately.

**Open questions**
- None beyond the project-level embedded-terminal scope question (not relevant to this page specifically).

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| Empty-database detection | This screen's entire behaviour hinges on checking whether UserCredentials is empty on every launch. | Query-and-branch at app startup before routing to login or setup. | Yes. |

---

## PLAN

**Summary:** Build the first-run bootstrap screen. Requires both database models to exist first.

**Changes:**
- On app startup, query `UserCredentials`; if empty, route to this screen instead of login.
- Build the create-account form (username, password, confirm password) with client-side match validation before submit.
- On submit, hash the password, look up the Super Admin role's id from `Role`, and insert the row.

**Expected technical debt:** none anticipated — this is a self-contained, well-scoped screen.

**Status:** approved — waiting for build (after Role, UserCredentials)
