# Page Spec — Role (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/Role-model.json`](../../CoperativeAIdb/Role-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A named role a user is assigned; bundles capabilities (e.g. view/edit access to an area) rather than being a single flat permission.

**Model & effort** _(default; override per change)_
Not specified per-model in the brief — defaults to the project's mid-range tier (Claude Sonnet 5, medium effort) as a database schema of moderate complexity.

**Depends on**
- (none — foundational)

**Data to store**

| Field | What it looks like |
|-------|---------------------|
| id | Unique identifier (key). |
| roleName | Unique string, e.g. "Product Edit". |
| permissions | A list of capability strings this role grants. |
| description | Optional free-text explanation. |

**Access & security**
Not directly user-facing; managed by a Super Admin through user/role management (not yet its own page brief).

**Tests**
- [ ] All five default roles exist after first run, before any user is created.
- [ ] roleName is unique — creating a duplicate fails.
- [ ] The Super Admin role cannot be deleted.
- [ ] A role cannot be deleted while any UserCredentials row still references it.

**Open questions**
- No page yet defines how a Super Admin creates/edits/deletes non-default roles — likely needed once user management is designed.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| turso schema design | Defines the Role table. | Create the migration/schema for id/roleName/permissions/description. | No — project skill. |

---

## PLAN

**Summary:** Create the `Role` table in CoperativeAIdb (turso), seeded with the five default roles automatically on first run. This is the foundational data model — nothing else in the project can be built before it, since UserCredentials references it.

**Changes:**
- Define the `Role` schema (id, roleName, permissions, description) per the turso-embedded boilerplate's migration convention.
- Write the first-run seed logic that inserts the five default rows (Product Edit, Product View, Code View, Code Edit, Super Admin) if the table is empty.
- Enforce the two invariants (unique roleName; Super Admin undeletable) at the query/service layer, since turso itself won't express "this specific row is undeletable."

**Expected technical debt:** none anticipated for this item alone — it's pure schema + seed data with no UI.

**Status:** approved — waiting for build

---

## Report back (first build attempt)

**What was done:**
- Real code written at `app/CoperativeAI/src-tauri/src/db/role.rs`: `create_table`, `seed_defaults` (idempotent), `find_by_name`, `list_all`, backed by the actual `turso` crate v0.6.1 API (verified against its downloaded source, not guessed).
- Five unit tests written first, TDD-style, against an in-memory turso database (`:memory:`): all five default roles get seeded; seeding twice doesn't duplicate; roleName uniqueness is enforced; Super Admin has `manage:users`/`manage:roles`; unknown lookups return `None`.
- Scaffolded the whole solution's skeleton at `app/CoperativeAI/` (Tauri backend in `src-tauri/`, a placeholder frontend) using a corrected `tauri-desktop-app` boilerplate — see `template/_forms/boilerplates.json` and the note in `CoperativeAI/application-spec.json`'s scaffold block for why `rust-cli-app` didn't fit.
- Real dependencies added and version-pinned via `cargo add` (not guessed): tauri 2.11.5, turso 0.6.1, argon2 0.5.3, serde 1.0.228, tokio (rt-multi-thread, macros), tauri-build 2.6.3. One transitive pin was needed: `roaring` downgraded to 0.11.3 (0.11.4 requires a newer rustc than this machine has).

**Verification (after MSVC Build Tools were installed):**
- `cargo check` — clean (only expected dead-code warnings for query functions not yet called from any UI).
- `cargo test` — **all 5 tests pass.** TDD caught a real bug along the way: `seed_defaults` left its `COUNT(*)` query's cursor (`Rows`) open across the subsequent `INSERT` calls, which silently suppressed the writes on turso (no error — the inserts just didn't persist on that connection). Fixed by scoping the cursor to a block so it's dropped before inserting. Confirmed with a throwaway diagnostic test isolating insert-then-read behaviour, then removed once the real cause was found.
- `cargo build --release` — succeeds, ~4m44s cold.
- One scaffold gap found and fixed along the way: `tauri.conf.json` needs a real `icons/icon.ico` for the Windows resource step, even for `cargo check`/`test` — added a minimal generated one at `app/CoperativeAI/src-tauri/icons/icon.ico`.
- One transitive dependency pin was needed: `roaring` downgraded to 0.11.3 (0.11.4 required a newer rustc than was installed at the time).

**Machine setup performed:** Visual Studio Build Tools (Desktop development with C++ workload) installed with explicit user approval — this machine had no C/C++ linker at all beforehand, which would have blocked linking any Rust MSVC-target binary, not just this project.

**Status:** built — verified compiling, tested, and release-buildable.
