# Code Map — CooperativeAI Solution

> The AI's running inventory of methods it has created. See [`template/claude-only/3-code-map.template.md`](../../template/claude-only/3-code-map.template.md) for the shape and rules.

---

## Solution — CoperativeAI (application, Tauri backend + React frontend)

**Repo:** https://github.com/PeterPartridge/CooperativeAICoding · **Local path:** `app/CoperativeAI/`

**Pinned versions (recorded at scaffold, 2026-07-16):** tauri 2.11.5, tauri-build 2.6.3, turso 0.6.1 (roaring pinned 0.11.3 for rustc 1.89), tokio 1.52.3, serde 1.0.228, serde_json 1.0.150 · react ^19.2.0, vite ^6.4.1, vitest ^3.2.4, typescript ^5.9.3, @tauri-apps/api ^2.9.0, @tauri-apps/cli ^2.9.6.

### Frontend (React + TypeScript)

| Method | File | What it does (one line) | Uses (files → methods) |
|--------|------|--------------------------|--------------------------|
| `App` | src/App.tsx | Root component; renders the workspace shell | `WorkspaceShell` |
| `WorkspaceShell` | src/pages/WorkspaceShell.tsx | The main window: three-tab menu (Product/Develop/Test), active environment panel, colour settings footer | `TabBar`, theme.ts → `loadTabColors`/`saveTabColors`/`applyTabColors` |
| `TabBar` | src/components/TabBar.tsx | Renders the Product/Develop/Test tabs, each coloured by its CSS variable, active tab marked | theme.ts types |
| `loadTabColors` / `saveTabColors` | src/lib/theme.ts | Persist the user's tab colours in localStorage (decision recorded: localStorage, not the DB — frontend-only concern) | — |
| `applyTabColors` | src/lib/theme.ts | Writes the three tab colours onto `:root` CSS variables | — |
| `ProductPlanning` | src/pages/ProductPlanning.tsx | The Product environment's work-item board: five status columns, create form, per-card status select + delete, first-repository form when none exist, error alert on backend failure | backend.ts wrappers |
| backend.ts wrappers | src/lib/backend.ts | One mockable module wrapping every Tauri `invoke` call (`listWorkItems`, `createWorkItem`, `updateWorkItemStatus`, `deleteWorkItem`, `listRepositories`, `addRepository`) + shared DTO types and the ITEM_TYPES/STATUSES lists | @tauri-apps/api → `invoke` |

### Backend (Rust, src-tauri)

| Method | File | What it does (one line) | Uses (files → methods) |
|--------|------|--------------------------|--------------------------|
| `main` | src-tauri/src/main.rs | App entry; resolves the data dir (`COPERATIVEAI_DATA_DIR` or OS app-data), opens CoperativeAIdb, creates all tables, manages the shared connection, registers all commands | `db::connect`, `db::create_all_tables`, `commands::AppDb` |
| `commands::AppDb` | src-tauri/src/commands/mod.rs | Managed state: the app's shared db connection behind a tokio Mutex; `to_message` maps DbError to a frontend string | — |
| `work_items::{list_work_items, create_work_item, update_work_item_status, delete_work_item}` | src-tauri/src/commands/work_items.rs | Product Planning board commands + `WorkItemDto` (camelCase) — thin wrappers over the tested db module | `db::work_item`, `AppDb` |
| `repositories::{list_repositories, add_repository}` | src-tauri/src/commands/repositories.rs | Repository list + minimal first-repository add for the board (full management is roadmap #4) + `RepositoryDto` | `db::repository`, `AppDb` |
| `db::connect` | src-tauri/src/db/mod.rs | Opens a turso database at a path (or `:memory:` for tests) and returns a connection | turso → `Builder::new_local` |
| `db::create_all_tables` | src-tauri/src/db/mod.rs | Creates every table (solution_management, repositories, work_items, ai_providers, work_item_policies, feature_designs) | each module's `create_table` |
| `db::now_millis` | src-tauri/src/db/mod.rs | Unix-millisecond timestamps for created/updated columns | — |
| `DbError` / `db::Result` | src-tauri/src/db/mod.rs | Error type: `Db` (engine) or `Validation` (code-enforced invariants — the engine doesn't enforce FKs) | — |
| `solution_management::{create_table, create, list_all, delete, last_insert_id}` | src-tauri/src/db/solution_management.rs | SolutionManagement table (PascalCase columns per its brief): create/list/delete solutions | `db::now_millis` |
| `repository::{create_table, add, list_all, set_active, find_active, find_by_id, remove}` | src-tauri/src/db/repository.rs | Repository table: register (path must exist), single-active invariant, remove never touches disk | `db::now_millis`, `solution_management::last_insert_id` |
| `work_item::{create_table, create, update_status, list_all, find_by_id, delete}` | src-tauri/src/db/work_item.rs | WorkItem table: type/status lists enforced, repository + parent checked in code, delete cascades to policy + design | `repository::find_by_id`, `db::now_millis` |
| `ai_provider::{create_table, add, list_all, find_by_id, remove}` | src-tauri/src/db/ai_provider.rs | AIProvider table: https-only URL, **keyAlias only — key values never enter the DB**; remove nulls referencing policies | `db::now_millis` |
| `work_item_policy::{create_table, set_policy, get_for_item, is_allowed}` | src-tauri/src/db/work_item_policy.rs | Per-item AI policy; `is_allowed` is the deny-by-default gate every AI call must pass (no row/flag/provider mismatch → denied) | `work_item::find_by_id`, `ai_provider::find_by_id` |
| `feature_design::{create_table, save, get_for_item}` | src-tauri/src/db/feature_design.rs | One JSON canvas per work item; canvas validated (JSON + connections reference existing blocks) on save | `work_item::find_by_id`, serde_json |

**Test suites:** 31 cargo tests (all db modules, in-memory turso) + 11 Vitest tests (workspace shell, product planning board) — all green as of this build.

**Not yet built:** the Feature Designer, spec generation, full repository management, code editor, terminal (ConPTY spike first), AI settings, work-item policy UI, and QA test designer — see `application/claude-only/` for translated specs and the roadmap in the plan.

**Standing technical debt:** turso 0.6.x is pre-1.0 (all access isolated in `src-tauri/src/db/` so a swap to libsql/rusqlite is one module); `roaring` pinned to 0.11.3 until rustc ≥1.90; db layer carries a module-level `#[allow(dead_code)]` until commands consume it.

---

## Solution — CoperativeAIdb (turso, embedded in CoperativeAI)

No separate code — CoperativeAIdb ships embedded inside the CoperativeAI binary. Its methods are listed under the CoperativeAI section above (the `src-tauri/src/db/` modules), since they live in the same crate.
