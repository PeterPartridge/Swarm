# Code Map — CooperativeAI Solution

> The AI's running inventory of methods it has created. See [`template/claude-only/3-code-map.template.md`](../../template/claude-only/3-code-map.template.md) for the shape and rules.

---

## Solution — CoperativeAI (application, Tauri backend)

**Repo:** https://github.com/PeterPartridge/CooperativeAICoding · **Local path:** `app/CoperativeAI/src-tauri/` (see the Project Digest's Solutions & repos note — the brief's declared `/app/CoperativeAI` didn't exist and this location was confirmed with the user before scaffolding)

| Method | File | What it does (one line) | Uses (files → methods) |
|--------|------|--------------------------|--------------------------|
| `connect` | src-tauri/src/db/mod.rs | Opens a turso database at the given path (or `:memory:` for tests) and returns a ready connection | turso crate → `Builder::new_local`, `Database::connect` |
| `role::create_table` | src-tauri/src/db/role.rs | Creates the `roles` table if it doesn't exist | `db::connect`'s `Connection` → `execute` |
| `role::seed_defaults` | src-tauri/src/db/role.rs | Inserts the five default roles (Product Edit/View, Code Edit/View, Super Admin) if the table is currently empty; idempotent | `Connection` → `query`, `execute` |
| `role::find_by_name` | src-tauri/src/db/role.rs | Looks up one role by its `roleName` | `Connection` → `query`; `role::row_to_role` |
| `role::list_all` | src-tauri/src/db/role.rs | Returns every role, ordered by id | `Connection` → `query`; `role::row_to_role` |
| `row_to_role` | src-tauri/src/db/role.rs (private) | Converts a raw turso `Row` into a `Role` struct, deserialising the `permissions` JSON column | nothing outside this file |
| `main` | src-tauri/src/main.rs | App entry point; on Tauri's `setup` hook, opens the CoperativeAIdb file in the OS app-data dir, creates the roles table, and seeds defaults | `db::connect`, `db::role::create_table`, `db::role::seed_defaults` |

**Not yet built:** `UserCredentials`, `AuditLog`, `SolutionManagement` tables and every UI screen (login, First Run Setup, Solution Management, Creation Page) — see their specs under `application/claude-only/` for what's approved and waiting.

---

## Solution — CoperativeAIdb (turso, embedded in CoperativeAI)

No separate code — CoperativeAIdb ships embedded inside the CoperativeAI binary. Its methods are listed under the CoperativeAI section above (the `db::role` module), since they live in the same crate (`src-tauri/src/db/`).
