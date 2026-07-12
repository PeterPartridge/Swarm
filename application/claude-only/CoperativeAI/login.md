# Page Spec — login

> Produced by `/translate` from [`../../CoperativeAI/login.md`](../../CoperativeAI/login.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
The login page for users.

**Model & effort**
Medium.

**Depends on**
- CoperativeAIdb/userCredentials-model.json

**Actions**

| User | Can do |
|------|--------|
| Anyone | Log in. (If no users exist yet, First Run Setup is shown instead.) |

**Information shown / collected**
- Username, password.

**Data to store**
- None new — reads/writes UserCredentials (lastLogin, failedLoginAttempts, isLocked) on each attempt.

**Access & security**
Open to everyone (it's the gate itself).

**Tests**
- [ ] A user can log in with correct credentials.
- [ ] A user with bad credentials cannot log in.
- [ ] The account created via First Run Setup can log in immediately afterwards.

**Open questions**
- None.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| Session/auth state | Once logged in, the app needs to remember who's authenticated and their role for every other screen. | Establish an in-memory auth/session state on successful login. | Yes. |

---

## PLAN

**Summary:** Build the login screen and the app's basic session/auth state.

**Changes:**
- Build the username/password form.
- On submit: look up the user, verify the password hash, check isLocked/isActive, increment/reset failedLoginAttempts, set lastLogin on success.
- On success, establish in-memory session state (who's logged in, their role) used to gate every other screen.
- On startup, check for empty UserCredentials and route to First Run Setup instead of this page when applicable.

**Expected technical debt:** the lockout threshold (how many failed attempts before isLocked is set) isn't specified anywhere in the brief — will need a reasonable default (e.g. 5) called out explicitly in the build report, since it wasn't given.

**Status:** approved — waiting for build (after UserCredentials, and effectively after First Run Setup so there's an account to log in with)
