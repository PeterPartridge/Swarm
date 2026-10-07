# Page Spec — Product (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/Product-model.json`](../../CoperativeAIdb/Product-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A Product being planned in the app — created from the Project_brief's Product questions; work items, sprints, feature designs, and Solutions all attach to one.

**Data to store**
id (auto) · name (unique, non-empty — the workspace title) · answers (JSON keyed by brief question ids: purpose, problem, users, appsYouLike, appsToAvoid, designs) · createdAt/updatedAt (millis).

**Invariants / tests**
- [x] name unique and non-empty; answers valid JSON.
- [x] Deleting a Product removes its work items (cascading their policies/designs), sprints, and solutions.

**Status:** built (2026-07-16)

## Report back
Implemented as `src-tauri/src/db/product.rs` (`create_table/create/list_all/find_by_id/delete`); delete cascades in code via `work_item::delete` per item then sprints/solutions/product. cargo tests: listing, name rules, JSON rule, full cascade. Command layer: `commands/products.rs` (list/create/get/delete).

## Round 13b — Nothing was being saved at all

### My Feedback

Reported as *"the Product is not saving projects when created, I keep having to create them"*. It was not a Product bug: **no write this app ever made survived a restart**, from the fifth table onwards.

`SELECT name FROM pragma_table_info('x')` — the spelling used by all ten migrations — leaves a read transaction open that nothing closes. Reads keep working. Writes keep returning `Ok`. And every write made afterwards on that connection is discarded when the process exits. The page cache serves them for the life of the session, so the app looks completely correct until it is closed.

Startup runs the migrations in order. The first one is `role::create_table`, the fourth table. From there, nothing landed: not the remaining twenty-odd tables, not a Product, not a Solution, not a work item.

Confirmed against the real database on this machine before fixing anything: **8 tables of 31, and zero Products.** The file was 4 KB with a 90 KB write-ahead log that had never been committed.

The fix is one shared helper, `db::table_columns`, using turso's own `pragma_query` API, which drains and finalises the statement. All ten call sites now go through it, so the bad spelling has nowhere left to live.

### Your Feedback

- **This was findable and was not found, because every database test runs against `:memory:`.** A write that never reaches a file cannot fail that way. The suite was 393 tests green over a database that had never persisted anything.
- **A test for the reported symptom would have passed.** `products` is created *before* the first migration, so a restart test that only checked Products would have gone green while the other twenty-seven tables were still being lost. The regression test asserts the **table count** and a row written after every migration, deliberately.
- **The diagnosis took eleven probes and every one of them was worth it.** The first four hypotheses — turso durability in general, unflushed WAL, unexhausted reads, sheer volume — were all wrong, and each was cheap to kill. What isolated it was listing *which* tables survived: the boundary sat exactly at the first migration.
- **My own note on this trap was half right and therefore dangerous.** It said a read must be scoped before a write. Scoping does not help here, and the session-visible symptom is absent. Corrected.

### Technical Debt

- **Existing databases heal themselves but do not recover.** The next launch creates the missing tables and keeps everything from then on; work lost before the fix is gone, because it was never written.
- **Nothing stops the bad spelling coming back.** `table_columns` is a convention, not a barrier — a new migration can still hand-roll the SELECT. A lint or a grep in CI would close it.
- **The `:memory:` blind spot is only closed for startup.** Three file-backed tests now exist; every other data test still runs where this class of bug cannot appear.
- **No integrity check on open.** The app cannot currently tell a healthy database from one missing two thirds of its schema, and would not have told anyone.
