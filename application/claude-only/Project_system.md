# Claude System Spec — CooperativeAI Solution

> Produced by `/translate` from [`../Project_brief.md`](../Project_brief.md). Read back against the brief to confirm nothing was invented.

---

## Project System Spec

**Purpose**
A Product / Development / QA workspace: a desktop app where teams plan products, build developments, and design QA tests cooperatively with AI, using the CooperativeAICoding framework — with very little effort and cost.

**Users**

| User | What they want to do |
|------|----------------------|
| Product Manager / Designers | Plan products in the **Product** environment: manage work items, design features on a drag-and-drop canvas, write specifications that generate endpoints/front-end/database designs. |
| Developers | Build in the **Develop** environment: code editor, real terminal, multi-repository support, AI via API keys — deciding per work item how the AI may use it. |
| QA | Design tests in the **Test** environment around work items, for the AI to implement. |

All of them use the app as a **single local user** — no logins or accounts. The main window is a top menu with three tabs — Product, Develop, Test — each with its own colour; clicking a tab enters that environment.

**Platforms & technology constraints**
- Rust application, single repo, distributed as a native executable — Windows and Linux.
- Coded for low memory usage and good performance on low-spec machines.
- UI: Tauri GUI shell with a React 19 + Vite + TypeScript frontend — Monaco for the code editor, dnd-kit for the drag-and-drop canvas, xterm.js + a PTY crate (portable-pty) for a real embedded shell terminal.
- Database: turso (embedded, in-process — not a separately hosted server).

**Solutions & repositories**

| Solution | Type | Repository | Local path |
|----------|------|------------|------------|
| CoperativeAI | application | https://github.com/PeterPartridge/CooperativeAICoding | `app/CoperativeAI` (relative to this repo's root) |
| CoperativeAIdb | database (turso, embedded in CoperativeAI) | https://github.com/PeterPartridge/CooperativeAICoding | `app/CoperativeAI/db` (relative to this repo's root) |

**Infrastructure & environments**
- Project Brief's `infrastructure-policy` answer is "N/A." The solution specs fill in the detail: no server-side infrastructure; the pipeline (GitHub Actions) builds, tests, and produces downloadable release artifacts — nothing is provisioned or hosted.
- Environments: development (AI may build and deploy debug builds) and production (people deploy after review) — development favours debuggability, production favours performance.

**Coding house rules**

| Rule | What it means on this project |
|------|-------------------------------|
| DRY | If code is repeated three times, move it into a shared method or module and reuse it. |
| SOLID | Single-responsibility objects, dependency injection and interfaces where practical. |
| Small production changes | Changes to production code should be small; if a change would be large, extend via a new version file instead of a big rewrite. |
| Keep it simple | Only write enough code to finish the job — no speculative extra scope. |
| TDD | Always write a failing test first, then just enough code to pass it. Tests start simple and grow more complex as functionality is added. |

**Access & security**
- **No authentication**: single-user local desktop app — no logins, accounts, roles, or claims. The app opens straight into the workspace.
- AI provider **API keys** live in the OS credential store (Windows Credential Manager / Linux Secret Service) via a Tauri keyring plugin — never in plaintext in the database, config, code, or logs. The database stores only a key alias.
- **Per-work-item AI policies, deny-by-default**: before any work-item content goes to an AI provider, the item's policy must explicitly allow that use and that provider.
- The embedded terminal is a real shell with the OS user's own permissions, local only, and its output is never logged or persisted (per the solution spec's security rules).

**Look & feel / design references**
Minimal and easy to use. A top menu with three tabs — Product, Develop, Test — each with its own colour so you always know which environment you're in. A terminal to run commands and interact with files, plus a drag-and-drop system to move code blocks or UI designs around. Customisable colours.

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
- Cheapest and mid-range model tiers both name "Claude Sonnet 5" — confirm this is intentional (i.e., two effort levels of the same model rather than two different models).
- `CoperativeAI/application-spec.json` carries its own open question: should the embedded terminal (a real shell) be restricted in any way, or is full OS-user shell access intended?
- `apps-to-avoid` and `anything-else` in the Project Brief are unanswered.

---

## Project Digest *(reused by page translations)*

- **Platform / tech:** Rust, single repo, Windows + Linux native executable, low memory/low-spec target. Tauri GUI + React 19/Vite/TypeScript frontend (Monaco editor, dnd-kit drag-drop, xterm.js terminal), portable-pty real shell. turso embedded database.
- **Solutions & repos:** CoperativeAI (application) → github.com/PeterPartridge/CooperativeAICoding, local path `app/CoperativeAI`; CoperativeAIdb (database, embedded in CoperativeAI) → same repo, `app/CoperativeAI/db`.
- **Infra & environments:** No hosted infrastructure — release artifacts only, via GitHub Actions. dev = AI may build/deploy debug builds; production = people deploy after review, performance-focused.
- **House rules:** DRY, SOLID (DI + interfaces), small production changes (or a new version file), keep it simple, TDD (failing test first).
- **Security model:** No authentication (single-user local app). API keys in the OS credential store via keyring, aliases only in DB. Per-work-item AI policies, deny-by-default, checked before every AI call.
- **Roles:** None — everyone sees all three workspace tabs (Product, Develop, Test).
- **Model & effort tiers:** Cheapest/mid = Claude Sonnet 5 (routine vs. everyday feature work); most capable = Claude Fable 5 (complex/architecture). Low/medium/high effort per task difficulty as defined above.

---

## Project Skills *(defined by the AI)*

| Skill | Why it's needed | How the AI will use it | Tools/approach |
|-------|------------------|--------------------------|-----------------|
| Rust + Tauri desktop development | The whole application is a Tauri-based native executable. | Build the window, the three-tab workspace shell, and the Rust backend commands behind each environment. | Tauri 2, Rust, cargo. |
| React + TypeScript frontend | The frontend is React 19 + Vite + TS with Vitest. | One page component per page brief, shared components/lib, component tests per screen. | React, Vite, Vitest. |
| Embedded database integration | CoperativeAIdb is a turso file opened in-process, not a hosted server. | Define schema from each database-model brief, write parameterised queries, run in-process. | turso (libSQL) Rust crate, isolated in `src-tauri/src/db/`. |
| Secure secret & credential handling | AI provider API keys must never touch the database, config, code, or logs. | Store/retrieve keys via the OS credential store under an alias; apply both security baselines on every build. | Tauri keyring plugin; the project's security baselines in `boilerplates.json`. |
| AI provider integration & policy enforcement | The app calls AI providers (Claude first, pluggable) and must gate every call on the per-work-item policy. | One shared AI-call path that resolves the item's policy (deny-by-default), the allowed provider, and the effort tier before sending anything. | Claude API (and pluggable HTTP providers), WorkItemPolicy model. |
| Drag-and-drop canvas UI | Product designs features by arranging and connecting blocks on a canvas. | Implement the Feature Designer's palette, canvas, and connections; persist designs as JSON per work item. | dnd-kit, FeatureDesign model. |
| Code editor integration | Developers edit repository files inside the app. | File tree + Monaco editor over the active repository, lazy-loaded, scoped to the repository folder. | Monaco, Tauri fs commands. |
| Embedded terminal / PTY integration | The brief calls for a real terminal inside the app. | Spawn and render a real OS shell inside the Tauri window, scoped by the security rules (local-only, no output logging). | portable-pty + xterm.js. |
| Multi-repository management | Work items and the editor/terminal operate against registered repositories. | Register/validate/switch repositories; keep one active repository. | Repository model, path validation. |
| Cross-platform CI/CD | Release binaries are needed for both Windows and Linux, built and tested automatically. | Implement the GitHub Actions pipeline described in the solution spec (PR → build/test; merge → release binaries). | GitHub Actions, cargo, npm. |
| Spec-generation logic (framework self-hosting) | The Creation Page's job is generating the same kind of brief/spec files this framework uses. | Turn a filled-in in-app form (or feature design) into the framework's own file layout. | The framework's templates in `template/_forms/` as the reference shape. |

> This is a genuinely broad list for one project — a full desktop app with an editor, terminal, canvas, AI integration, and a meta spec-generation engine. No single skill looks invented, but the breadth is the signal to keep building one page/model at a time (as the framework already structures it) rather than attempting several skills at once.

---
## Working Agreement *(restated)*

- Build the **smallest change** that satisfies the request — no unrequested extras.
- Treat existing code as **working in production**; avoid breaking it.
- Record **technical debt** instead of retrying endlessly.
- A **person reviews and approves** every plan before anything is built.
- **Score each change** by how token-intensive it's likely to be.
- **Never put secret values in code, config, or logs** — reference them by name from their stores.
- **Infrastructure and pipelines are their own approved plans** — never a side effect of building a feature.
