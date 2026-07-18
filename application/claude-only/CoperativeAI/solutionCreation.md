# Page Spec — Solution Creation

> Produced by `/translate` from [`../../CoperativeAI/solutionCreation.md`](../../CoperativeAI/solutionCreation.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
The Develop tab's card for creating a Solution linked to a Product, answering the solution-spec core questions (type, purpose, hosting, language, frameworks), plus the list of Solutions grouped by Product.

**Depends on**
- `CoperativeAI/workspaceShell.md`, `CoperativeAIdb/Solution-model.json`

**Tests**
- [x] Requires a name, an existing Product, and a valid type.
- [x] Created Solution appears under its Product (persisted via the Solution table).
- [x] With no Products, the card asks to create a Product first.
- [x] Deleting a Solution leaves the Product and its work items untouched.

**Status:** built (2026-07-16)

## Report back
Implemented inside `src/pages/DevelopSolutions.tsx` (the Develop environment page) over `commands/solutions.rs`. Vitest covers the create flow (questions serialised as answers JSON), listing under the product name, and the no-products hint. Generating the framework's actual solution files on disk remains with the Creation Page (self-hosting roadmap item), per the brief's limits answer.

## Round 2 — GitHub repositories on a Solution

**Behaviour:** each Solution can carry a GitHub repository — either an **existing repo linked by URL** ("imported") or a **new repo created through the GitHub API** as private or public ("created"). A single GitHub connection (Personal Access Token) serves the whole app.

**Implemented:**
- `db/solution.rs` round 2 — new `origin` (`created` | `imported`, default `created`), `githubUrl`, `githubVisibility` columns; `set_github()` validates the origin and that the Solution exists; `find_by_id()` added. Migration follows the established pre-release pattern: a round-1 table (no `origin` column) is dropped and recreated.
- `github.rs` (new, Rust) — token kept in the **OS credential store** under `CoperativeAI / coperativeai/github`, exactly the rule AI keys follow: never the DB, config, or logs. `verify()` (GET /user) returns the login; `create_repo()` (POST /user/repos) returns the new repo URL; `repo_create_body()` is a pure function so the request shape is unit-tested without the network.
- `commands/github.rs` (new) — `github_status` (local check, no network), `set_github_token` (verifies **before** storing, returns the login), `remove_github_token`, `link_solution_repo`, `create_solution_repo`.
- `components/GithubCard.tsx` — connect / disconnect, token entered once and never redisplayed.
- `components/SolutionRepo.tsx` — per-Solution row: shows the linked repo (URL, visibility, created/imported) or offers **Link existing** (URL) and **Create new** (name + Private checkbox). "Create new" is disabled until GitHub is connected; linking a URL works without a token.

**Tests:** cargo 85/85 (incl. solution defaults `created`/no-repo, `set_github` links + rejects a bad origin or unknown id, a round-1→round-2 migration test that opens an old-shaped table cleanly, and the two repo-body tests); Vitest 51/51 (connect stores the token and shows the login and clears the field, link-by-URL calls through with the right id, Create-new disabled while disconnected, create sends `private: true`, a linked repo renders as a link). `npm run build` and `cargo build` clean.

**Technical debt:**
- **No git operations.** The app records the repo URL; it does not clone, add a remote, commit, or push. A Solution scaffolded on disk is not wired to its repo yet.
- **Import means "link a URL".** `link_solution_repo` does not call GitHub to check the URL exists, is reachable, or is yours — any string that looks like a URL is accepted. Visibility is left unknown for imported repos.
- **Status is local-only.** `github_status` reports whether a token is stored, not whether it is still valid; a revoked token only surfaces on the next real call. The login is shown after connecting but not re-fetched on reload.
- **One token for the whole app**, tied to the authenticated user — no orgs, no per-Solution accounts, and `create_repo` only creates under `/user/repos`.
- The **drop-and-recreate migration** on `solutions` is the standing pre-release debt: linking data in an existing DB is discarded when the table shape changes.
