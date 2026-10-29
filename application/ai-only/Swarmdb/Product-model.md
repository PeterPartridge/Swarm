---
spec: model
from: Swarmdb/Product-model.json
deliverable:
depends-on: []
---
objective: A Product being planned in the app — created by answering the Project_brief's Product questions; everything on the Product side (work items, sprints, feature designs, solutions) attaches to one. [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: name — text, required — unique; not empty — The Product's title, shown at the top of its workspace [fields.entries.1]
field: answers — text, required, default {} — valid JSON keyed by Project_brief question ids (purpose, problem, users, appsYouLike, appsToAvoid, designs) — The Product's brief answers, in the person's plain English [fields.entries.2]
field: origin — text, required, default product — one of: product, develop, test — The area the Product was created in. Develop and QA can start a Project; it keeps this marker after it is handed over [fields.entries.3]
field: handedOverAt — date, optional — set once, by Send to Product; never on a Product made in the Product area — When a Develop or QA Project was sent to the Product area. Empty until then [fields.entries.4]
field: createdAt — date, required, default now — When the Product was created [fields.entries.5]
field: updatedAt — date, required, default now — updated on every change — When the Product last changed [fields.entries.6]
index: name [lookupsAndPerformance.answer.0]
retention: Until the user deletes the Product; deleting it removes its work items (and their policies/designs) and its solutions. [lifecycleAndRules.retention]
sensitive: No. [lifecycleAndRules.sensitiveFields]
invariant: name is unique and non-empty; answers always parses as JSON; origin is product, develop or test; a Product is in the Product area when its origin is product or it has been handed over, and a Product already there cannot be handed over again. [lifecycleAndRules.invariants]
> The brief's change rounds record why the model changed; the fields above are
> its answers as they stand, and the rounds are not restated.

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — Product (database model)

> Produced by `/translate` from [`../../Swarmdb/Product-model.json`](../../Swarmdb/Product-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A Product being planned in the app — created from the Project_brief's Product questions; work items, sprints, feature designs, and Solutions all attach to one.

**Data to store**
id (auto) · name (unique, non-empty — the workspace title) · answers (JSON keyed by brief question ids: purpose, problem, users, appsYouLike, appsToAvoid, designs) · origin (`product` | `develop` | `test`, default `product`) · handedOverAt (millis, null until sent to Product) · createdAt/updatedAt (millis).

**Invariants / tests**
- [x] name unique and non-empty; answers valid JSON.
- [x] Deleting a Product removes its work items (cascading their policies/designs), sprints, and solutions.
- [x] origin is one of the three areas; anything else is refused.
- [x] In the Product area = origin `product`, or handed over. A Develop/QA Project is not, until it is sent.
- [x] Hand-over sets handedOverAt and keeps origin; it refuses a Product already in the Product area, twice, or one that does not exist.
- [x] An existing table gains origin and handedOverAt in place — no rebuild, no lost rows — and every existing row reads as made in the Product area.

**Status:** built (2026-07-16)

## Report back
Implemented as `src-tauri/src/db/product.rs` (`create_table/create/list_all/find_by_id/delete`); delete cascades in code via `work_item::delete` per item then sprints/solutions/product. cargo tests: listing, name rules, JSON rule, full cascade. Command layer: `commands/products.rs` (list/create/get/delete).

## Round 1 (model) — Develop and QA hand a Project over

Decided 2026-10-07: Develop and QA can create a Project — a Product — that stays theirs until somebody presses **Send to Product**. It then appears in the Product area, marked with where it came from. Two columns carry it: `origin` (where it was made, kept after hand-over — the marker is the point) and `handedOverAt`. Added with `ALTER TABLE` through `db::table_columns`, not a rebuild: Products are written by people.

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
