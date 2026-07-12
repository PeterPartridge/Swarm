---
form: page-brief
page: "First Run Setup"
solution: "CoperativeAI"
depends-on: ["CoperativeAIdb/Role-model.json", "CoperativeAIdb/userCredentials-model.json"]
status: filled
---

# Page Brief — First Run Setup

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So the very first time the app runs — before any user exists — someone can create the Super Admin account themselves, instead of the app shipping with a default account or password.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
Someone (who: whoever first launches the app) can: create the Super Admin account by choosing their own username and password.

### look — What should it look like?
Desktop application with a box in the center — the same style as the login box, but labelled "Create your Super Admin account," with username, password, and confirm-password fields and a "Create account" button. Shown instead of the login screen only when no users exist yet.

### information — What information does this page show or collect?
Username, password, confirm password.

### who-can-use — Who is allowed to use this page?
Anyone who launches the app while the UserCredentials table is empty. Once the Super Admin account is created, this screen never appears again — the normal login page is shown instead from then on.

---

## Part 3 — Building Details *(Developers answer)*

> Depends on the Role model (to assign the seeded Super Admin role) and the UserCredentials model (to create the account).

### data-stored — What information needs to be stored, and what does each bit look like?
Creates one UserCredentials row: the chosen username, the chosen password (hashed), role = Super Admin, isActive = true, isLocked = false.

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
The typed username, password, and confirm-password until the account is created.

### tests — How will we know it works? What should we test?
- On first run, with no users in the database, this screen is shown instead of login.
- Creating the account requires password and confirm-password to match.
- After the account is created, relaunching the app shows the normal login page, not this screen.
- The created account has the Super Admin role and can log in immediately.

### limits — Any known limits or things to watch out for?
This screen must never appear again once at least one user exists — check for that on every launch, not just once.

### model-and-effort — Which AI model and effort level should this page use by default?
Medium — a straightforward form, but security-sensitive since the account it creates has full permissions.

---

## Part 4 — changes-over-time

- Round 2: …
