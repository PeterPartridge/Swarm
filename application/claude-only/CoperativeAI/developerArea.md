# Page Spec — Developer Area

> Produced by `/translate` from [`../../CoperativeAI/developerArea.md`](../../CoperativeAI/developerArea.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
The Develop tab's team list: add/remove team members (name + role) that Planning assigns work to. Names, not accounts — the app has no logins.

**Depends on**
- `CoperativeAI/workspaceShell.md`, `CoperativeAIdb/TeamMember-model.json`

**Tests**
- [x] Adding a member (name + role) shows them in the list (persisted via the TeamMember table).
- [x] Duplicate names rejected (backend rule, surfaced as the error alert).
- [x] Removing a member unassigns their items without deleting them (backend-tested; UI calls remove).

**Status:** built (2026-07-16)

## Report back (round 1)
Implemented inside `src/pages/DevelopSolutions.tsx` over `commands/team_members.rs`.

## Round 2 — team management moved to Admin
Team members + roles now live in the Admin area (`pages/AdminArea.tsx`); the Develop area no longer manages team.

## Round 3 — Technical Strategy + Board/Sprint/List views

**Behaviour:** the Develop area gains a **Product picker**; for the chosen Product it shows a **Technical Strategy** section (required infrastructure, architecture requirements, solution creation guidelines, dependencies/env prerequisites) and a **work-views** panel with **Board / Sprint / List** views, all **filterable by assigned user**.

**Implemented (pure frontend over existing commands — no backend change):**
- `components/StrategyEditor.tsx` — generic structured-strategy editor (labelled textareas → one JSON doc per (product, area)); Develop uses area `develop` with `DEVELOP_STRATEGY_FIELDS`. Reused for the Test area later.
- `components/WorkItemViews.tsx` — Board (status columns), Sprint (lanes by sprint + Unscheduled), List (flat table), with an assignee filter (Everyone / Unassigned / each member).
- `pages/DevelopSolutions.tsx` reworked: Product picker → StrategyEditor + WorkItemViews, above the Create-a-Solution card and AI Settings.

**Tests:** Vitest 45/45 (WorkItemViews: default board, switch to list/sprint, filter-by-user hides other members' items; DevelopSolutions: strategy + views present). Build clean.

**Technical debt:** the views are read-only (editing stays on the Planning board); the strategy field shape is app-defined JSON (validated only as JSON); no cross-product "all my work" view yet (scoped per selected Product).

## Round 5 — Developer Rules + AI Solution Strategy

### My Feedback
The requirement was that developers define the rules and the AI obey them, and that each work item get an AI-generated strategy with architecture options and a tech stack.

- **`db/developer_rules.rs`** — coding standards, architecture principles, maintainability, preferred frameworks, allowed and **disallowed** technologies, and constraints on AI behaviour. Structured columns rather than a text blob **because these are enforced, not displayed**.
- **`db/solution_strategy.rs`** — one per work item: the written strategy, architecture options as JSON (their shape is the AI's to fill), the chosen option as a column (that is the developer's decision, so the app must know it), and the tech stack.
- **`build_solution_strategy_prompt`** states the rules as constraints and disallowed technology as *"MUST NOT use, under any circumstances"*.
- The Develop area gets a Developer Rules editor, and every work item in the List view gets a "How to build" panel with the options and a chooser.

### The part that matters: the rules are checked, not trusted
Stating a constraint in a prompt is not the same as it being obeyed. `developer_rules::violations` scans the AI's own output — strategy, tech stack and options together — for anything on the forbidden list, and the result is shown in red on the strategy itself plus recorded as AI feedback against the item.

Matching is **whole-word**, which took two attempts. The first version treated `.` as part of a token so that ".NET" would match, and that broke every term followed by a full stop ("in Go." stopped matching "Go"). The rule that works is simpler: only the characters *around* a match are tested, and a match must not sit against a letter or digit. Punctuation inside a name is carried by the term itself, so ".NET", "C++" and "C#" all work while "Go" no longer fires on "Google" and "Java" no longer fires on "JavaScript".

### Your Feedback
- **The policy gate was refactored, not bypassed.** `resolve_item_ai_gate` now holds the deny-by-default check that story generation used inline, so this new AI action goes through the same gate rather than a parallel one. Any future item-anchored feature should use it too.
- **Regenerating clears the chosen option deliberately** — the choice was made about options that no longer exist, and keeping it would silently point at a different architecture than the one picked.
- The violation check also runs **on read**, not just after generation, because the rules may tighten after a strategy was produced.
- Recommendation: the architecture-option kinds are a fixed list with `other` as the escape. If `other` starts dominating in practice, that is the list telling you it is wrong.

### Technical Debt
- **Ollama has no strategy path.** `generate_solution_strategy` calls the Claude client directly, so if the router hands over mid-design the request goes out in the metered provider's shape. The router still decides *who* runs, but the dispatch that `ai/backend.rs` provides for story generation was not extended here.
- **Effort is hard-coded to `high`** for strategy generation rather than taken from the item's policy — defensible for architecture work, but it is a decision the policy should own.
- **The violation check is textual.** It finds a forbidden name mentioned anywhere in the output, including inside a sentence explaining why that technology was *rejected* — a false positive that will annoy before it protects.
- `ai_usage_id` is stored as `None` — the ledger row is written, but the strategy does not yet link to the row that paid for it, so cost is not traceable to the artefact.
- **No live call has been made**, so the prompt's ability to produce usable options is unproven, as is whether models respect the prohibition.

## Round 4 — GitHub connection

**Behaviour:** the Develop area gains a **GitHub** card — connect once with a personal access token, then link or create a repository on any Solution.

**Implemented:** `components/GithubCard.tsx` (connect / disconnect; the token is verified against GitHub *before* it is stored, then held in the OS credential store and cleared from the form) and `components/SolutionRepo.tsx` (per-Solution Link-existing / Create-new). Backend in `github.rs` + `commands/github.rs`; the Solution model round 2 carries the link. Full detail and the debt list live in [`solutionCreation.md`](solutionCreation.md) round 2 — the Solution is where the repository actually attaches.

**Tests:** Vitest 51/51, cargo 85/85; `npm run build` and a full `cargo build` clean.

**Technical debt (Develop-area side):** the GitHub card sits below Create-a-Solution, so a first-time user creates a Solution before seeing the connection card — the Create-new button is disabled with a title explaining why, but the ordering is worth revisiting. Connection state is per-app, not per-Product.
