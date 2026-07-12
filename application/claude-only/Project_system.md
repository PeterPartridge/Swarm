# Claude System Spec — CooperativeAI Solution

> Produced by `/translate` from [`../Project_brief.md`](../Project_brief.md). Read back against the brief to confirm nothing was invented.

---

## Project System Spec

**Purpose**
A desktop application that lets developers and Product run the CooperativeAICoding framework — filling in briefs, translating them, building, and reviewing — with very little effort and cost.

**Users**

| User | What they want to do |
|------|----------------------|
| Developers | Build solutions using the framework, with AI assistance, across single or multiple repos. *(Brief lists this group but doesn't break out per-role goals beyond the project purpose — see Open Questions.)* |
| QA | *(Not detailed in the brief.)* |
| Product Manager | *(Not detailed in the brief.)* |
| Designers | *(Not detailed in the brief.)* |

**Platforms & technology constraints**
- Rust application, single repo, distributed as a native executable — Windows and Linux.
- Coded for low memory usage and good performance on low-spec machines.
- UI: Tauri (GUI shell + web-based frontend) for the window and drag-and-drop canvas; a real embedded shell terminal (a genuine OS shell process, e.g. via a PTY crate, rendered in the Tauri window) — not a text-mode UI crate.
- Database: turso (embedded, in-process — not a separately hosted server).

**Solutions & repositories**

| Solution | Type | Repository | Local path |
|----------|------|------------|------------|
| CoperativeAI | application | https://github.com/PeterPartridge/CooperativeAICoding | `/app/CoperativeAI` ⚠ not found on this machine — see Open Questions |
| CoperativeAIdb | database (turso, embedded in CoperativeAI) | https://github.com/PeterPartridge/CooperativeAICoding | `/app/CoperativeAI/db` ⚠ not found on this machine — see Open Questions |

**Infrastructure & environments**
- Project Brief's `infrastructure-policy` answer is "N/A." The solution specs fill in the detail: no server-side infrastructure; the pipeline (GitHub Actions) builds, tests, and produces downloadable release artifacts — nothing is provisioned or hosted.
- Environments: development (AI may build and deploy debug builds) and production (people deploy after review) — development favours debuggability, production favours performance.

**Coding house rules**

| Rule | What it means on this project |
|------|-------------------------------|
| DRY | If code is repeated three times, move it into a shared place. *(The brief's answer is cut off after "three times" — the standard next clause, "move it to a shared library," is assumed but not stated — see Open Questions.)* |
| SOLID | Single-responsibility objects, dependency injection and interfaces where practical. |
| Small production changes | Changes to production code should be small; if a change would be large, extend via a new version file instead of a big rewrite. |
| Keep it simple | Only write enough code to finish the job — no speculative extra scope. |
| TDD | Always write a failing test first, then just enough code to pass it. Tests start simple and grow more complex as functionality is added. |

**Access & security**
- User login with role-based access control. Each user holds exactly **one** role; a role bundles several capabilities (e.g. view/edit access to an area) rather than being a single flat permission.
- Roles seeded automatically on first run (data, not a user account): Product Edit, Product View, Code View, Code Edit, Super Admin (full permissions, including managing users and roles; cannot be deleted or weakened).
- No default or seeded password anywhere in the app. If no users exist, a First Run Setup screen lets a person create the Super Admin account themselves (their own username/password) — see the per-page spec.
- ⚠ The Project Brief's own `roles` answer only lists **Product Edit, Product View** — narrower than the five roles actually defined in `CoperativeAI/application-spec.json` and the `Role` database model. Flagged under Open Questions rather than silently resolved.

**Look & feel / design references**
Minimal and easy to use. A terminal to run commands and interact with files, plus a drag-and-drop system to move code blocks or UI designs around. Customisable colours.

**Model & effort selection**

| Model tier | Example | When to use it |
|------------|---------|----------------|
| Cheapest / fastest | Claude Sonnet 5 | Small, well-defined tasks — minor code edits, small UI tweaks, simple functions, updating control-flow statements. |
| Mid-range | Claude Sonnet 5 | Everyday feature work — medium-sized code/UI changes, reading brief design notes, creating new files or tests. *(Brief names the same model as the cheapest tier — see Open Questions.)* |
| Most capable | Claude Fable 5 | Complex UI or coding work, unfamiliar systems, architecture decisions, interpreting design files and building overall code structure. |

| Effort level | When to use it |
|--------------|----------------|
| Low | Small, well-defined edits and straightforward fixes. |
| Medium | Everyday feature work and moderate refactors. |
| High | Architecture changes, cross-file refactors, complex implementation work. |

**Open questions**
- `CoperativeAI` and `CoperativeAIdb`'s declared local path (`/app/CoperativeAI`) does not exist on this machine, either as an absolute path or relative to the repo root. Confirm the intended location before any scaffolding.
- Roles: the Project Brief lists only Product Edit / Product View; the solution spec and Role model define five (adds Code View, Code Edit, Super Admin). Should the Project Brief be updated to match, since roles are meant to be the shared project-wide vocabulary?
- The `dev-rules` DRY answer is cut off mid-sentence ("...if you are repeating code three times.") — confirm the intended rule (assumed: move shared code to a common module).
- Cheapest and mid-range model tiers both name "Claude Sonnet 5" — confirm this is intentional (i.e., two effort levels of the same model rather than two different models).
- `CoperativeAIdb/application-spec.json`'s `core.purpose` answer is blank.
- `CoperativeAI/application-spec.json`'s `stylingOrToolkit` answer is blank, and it carries its own open question: should the embedded terminal (a real shell) be restricted in any way, or is full OS-user shell access intended?
- `apps-to-avoid` and `anything-else` in the Project Brief are unanswered.

---

## Project Digest *(reused by page translations)*

- **Platform / tech:** Rust, single repo, Windows + Linux native executable, low memory/low-spec target. Tauri GUI + embedded real-shell terminal. turso embedded database.
- **Solutions & repos:** CoperativeAI (application) → github.com/PeterPartridge/CooperativeAICoding, local path `/app/CoperativeAI` (⚠ unresolved — see Open Questions); CoperativeAIdb (database, embedded in CoperativeAI) → same repo, `/app/CoperativeAI/db` (⚠ unresolved).
- **Infra & environments:** No hosted infrastructure — release artifacts only, via GitHub Actions. dev = AI may build/deploy debug builds; production = people deploy after review, performance-focused.
- **House rules:** DRY, SOLID (DI + interfaces), small production changes (or a new version file), keep it simple, TDD (failing test first).
- **Security model:** Login + role-based access, one role per user, roles bundle permissions. Roles auto-seeded on first run; Super Admin **user** created interactively via First Run Setup — no default/seeded password anywhere.
- **Roles:** Product Edit, Product View, Code View, Code Edit, Super Admin (per the solution spec — wider than the Project Brief's own roles answer; flagged above).
- **Model & effort tiers:** Cheapest/mid = Claude Sonnet 5 (routine vs. everyday feature work); most capable = Claude Fable 5 (complex/architecture). Low/medium/high effort per task difficulty as defined above.

---

## Project Skills *(defined by the AI)*

| Skill | Why it's needed | How the AI will use it | Tools/approach |
|-------|------------------|--------------------------|-----------------|
| Rust + Tauri desktop development | The whole application is a Tauri-based native executable. | Build the window, routing between screens (login/setup/solution management/creation), and the Rust backend behind them. | Tauri, Rust, cargo. |
| Embedded database integration | CoperativeAIdb is a turso file opened in-process, not a hosted server. | Define schema/migrations from each database-model brief, write parameterised queries, run in-process. | turso (libSQL) Rust crate. |
| Authentication & role-based access control | Every page is gated by login and a single-role permission model, with a bootstrap (First Run Setup) case. | Implement password hashing, session/auth state, role-permission checks, the empty-database detection that shows First Run Setup instead of login. | Rust password-hashing crate (e.g. argon2), the Role/UserCredentials models. |
| Secure secret & credential handling | No hardcoded or seeded secrets anywhere; passwords are user-chosen and hashed. | Apply the `application-baseline` and `embedded-database-baseline` security rules on every build; never write a literal credential into code. | Project's own security baselines in `boilerplates.json`. |
| Desktop UI/UX (drag-and-drop canvas, forms) | Product wants a minimal UI with draggable code/UI blocks and customisable colours. | Build the frontend views in Tauri's webview per page brief; implement drag-and-drop for the Creation/SolutionManagement screens. | Tauri frontend (HTML/CSS/JS or a framework of choice — not yet specified). |
| Embedded terminal / PTY integration | The brief calls for a real terminal inside the app, confirmed as a genuine embedded shell. | Spawn and render a real OS shell process inside the Tauri window, scoped by the security rules (local-only, no privilege escalation, no output logging). | A PTY crate (e.g. portable-pty) + a terminal renderer (e.g. xterm.js) in the frontend. |
| Cross-platform CI/CD | Release binaries are needed for both Windows and Linux, built and tested automatically. | Implement the GitHub Actions pipeline described in the solution spec (PR → build/test; merge → release binaries). | GitHub Actions, cargo. |
| Spec-generation logic (framework self-hosting) | The Creation Page's actual job is generating the same kind of brief/spec files this session has been hand-building all along. | Implement the logic that turns a filled-in form (inside the app) into the framework's own file layout — effectively reimplementing `/translate`'s reasoning as app behaviour. | The framework's own templates in `template/_forms/` and `template/claude-only/` as the reference shape. |

> This is a genuinely broad list for one project — a full desktop app with embedded auth, an embedded shell, drag-and-drop UI, and a meta spec-generation engine. No single skill looks invented or surprising, but the breadth is a sign to keep building one page/model at a time (as the framework already structures it) rather than attempting several skills at once.

---
## Working Agreement *(restated)*

- Build the **smallest change** that satisfies the request — no unrequested extras.
- Treat existing code as **working in production**; avoid breaking it.
- Record **technical debt** instead of retrying endlessly.
- A **person reviews and approves** every plan before anything is built.
- **Score each change** by how token-intensive it's likely to be.
- **Never put secret values in code, config, or logs** — reference them by name from their stores.
- **Infrastructure and pipelines are their own approved plans** — never a side effect of building a feature.
