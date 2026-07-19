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

## Round 8 — Developer Planning: architecture that has to render

### My Feedback

Develop gains a planning sub-area: architecture documents, API contracts, and a cross-repo map. Three decisions carried it.

**Validation is on the way in, not the way out.** A diagram that does not render is worse than no diagram — it *looks* like documentation, so the gap stops being visible and nobody writes the real thing. `architecture_doc::save` refuses anything `diagram::check` rejects, and the AI command reports "the AI drew something that will not render, so it was not saved" rather than storing it and letting a renderer surface the failure weeks later.

**The checks are structural, not parsers, and the module says so.** They catch what actually goes wrong — a model answering in prose, or in the wrong notation. Three earned their place: PlantUML is checked at **both ends**, because a truncated response opens correctly and never closes; a JSON-graph edge must join nodes that exist, because a dangling edge renders as a line going nowhere and reads as a decision rather than a mistake; and Mermaid tolerates leading `%%` comments, because generated diagrams carry them.

**Only `buildsOn` is cycle-checked.** Cycle detection exists to stop a state nothing can start from, and only an ordering relation produces one. A build cycle genuinely cannot be resolved. Two services calling each other's APIs is a common, workable arrangement — a webhook back is not a paradox — and refusing it would make the map lie about the system it describes. A map that refuses to record reality is one people stop updating.

That is now a rule this codebase applies three times, and it is worth naming: **check the kind that orders, allow the kinds that describe.** `blocks` on work items, `buildsOn` on Solutions, deliverable dependencies.

**The impact walk is deliberately wider than the cycle check.** `reaches` follows *every* kind of link, because a runtime dependency is exactly how a change propagates. Restricting it to `buildsOn` would answer a question nobody asked.

### Your Feedback

- **A passing test suite was hiding a broken render.** Adding `DeveloperPlanning` to `DevelopSolutions` left its backend calls unmocked, so they fell through to the real `invoke`, failed, and landed in the component's error state — and every existing test still passed, because none of them assert the absence of an error. Green tests concealing a broken panel are worse than a red one. Mocks added, but the lesson is that partial `...original` mocks fail silently by design.
- **`design_asset` and `architecture_doc` are now near-identical.** Both product-scoped, both kind-decides-format, both name-replaces-in-place, both validating diagrams. They stayed separate because kinds and lifecycles differ, and two similar things are cheaper than the wrong abstraction — but a third would be the moment to extract one.
- **Extracting `diagram.rs` was the right call and nearly wasn't made.** The Mermaid check already existed, privately, inside `design_asset`. Copying it would have been faster and would have produced two definitions of "is this a diagram" that drifted the first time either was tightened.

### Technical Debt

- **Nothing renders the diagrams.** They are shown as source in a `<pre>`. Mermaid rendering is available in this stack and is not wired up, so a non-technical reader gets text where a picture was the point.
- **The "agree with existing documents" instruction is unenforced.** The prompt asks; nothing checks the answer — unlike the developer-rules path, which re-checks what the model declared. A contradictory second diagram would be stored without complaint.
- **No history on architecture documents.** Regenerating replaces, so there is no way to see what changed between drafts — which is exactly what a reviewer wants.
- **Cross-Product integration cannot be recorded.** Refusing it keeps the map coherent, but a real dependency on another Product's API now has nowhere to live.
- **`reaches` returns ids with no path**, so a surprising result cannot be traced without reading the whole link list. And nothing draws the graph.
- **Links are recorded by hand.** Nothing derives them from the code, so the map is only as true as the last person to update it.
- **The cycle check is not transactional** — the third instance of this in the codebase.
- **Standing: the Claude path is unproven live**, now three rounds running.

## Round 7 — What live testing found

Three things the unit tests could not have told us, from running rounds 4–6 against a real `ornith:9b`.

### 1. A bug I had filed as debt
`generate_solution_strategy` called the Claude client unconditionally. If a budget handed over to Ollama mid-design, the request went to `localhost:11434/v1/messages` — an endpoint that does not exist — so **a Product past its handover threshold could not design anything at all.** I recorded that as "technical debt" last round; it was broken behaviour, and calling it debt understated it.

Fixed by giving Ollama a strategy path and dispatching on provider kind in `ai/backend.rs`, mirroring story generation. Two unit tests now pin it: both generations refuse an unknown kind, and a local provider is never asked for a key.

### 2. The rule check fired on obedience
The predicted false positive appeared on the **first real call**. Given "MUST NOT use: Java, PHP", the model produced a correct Rust/TypeScript design whose tech stack ended:

> *"...No Java or PHP anywhere."*

and the text search dutifully reported `["java", "php"]`. **The model obeyed perfectly and was flagged for saying so.** That is worse than no check: a warning that fires on correct behaviour teaches people to ignore warnings.

The fix is to stop reading prose. The strategy schema gained a **`technologies` list — what the AI is actually proposing to use, as data** — and the check runs against that and nothing else. Re-run against the same model:

| | tech stack | violations |
|---|---|---|
| before | "…No Java or PHP anywhere." | `["java", "php"]` |
| after | "Rust for the order-store… TypeScript for the REST API…" | `[]` |

with `declared technologies: ["Rust", "TypeScript"]`. A regression test in `developer_rules.rs` records *why* `violations` must never be pointed at writing again — it asserts the obedient sentence still trips a text search, so the reason survives the next person who thinks the indirection is unnecessary.

### 3. Effort now comes from the policy
Fixed in passing: strategy generation no longer hard-codes `high`.

### 4. Completion times were an order of magnitude out
The estimator's "how long" came from a `tokensPerSecond` typed into the price table and never checked. The live runs measured **roughly 4 tokens/second** on the local 9B model; a sensible-looking default of 50 would have quoted **3 minutes for work that really takes 38**.

The ledger had been recording `latencyMs` since the first call, so the real figure was already there — `ai_usage::recent_throughput` reads it back and the estimator prefers it. **Three readings are enough** to override the table, against twenty for token counts: how many tokens a task needs varies enormously with the task, but how fast a model runs is close to a property of the model and the machine.

Sub-second and zero-token calls are excluded rather than dividing into an absurd rate.

### Your Feedback
- **The debt list earned its keep, and also misled me.** Writing down "the check is textual, a false positive that will annoy before it protects" is what made the live result legible in one glance. But I had also filed a broken path as debt, which let it sit a round longer than it should have. Debt and defects want different words.
- **Structured output beats parsing prose, every time.** The general lesson: when the model's answer needs checking by code, ask for the checkable part as data rather than inferring it from writing.
- Local strategy calls took **170–290 seconds** on a 9B model. Handover keeps work going, but the experience past the threshold is minutes per design, not seconds.

### Technical Debt
- The `technologies` list is **self-reported**. A model that uses Java in its prose while listing only "Rust" would pass — this checks stated intent, which is what the rules constrain, not the eventual code.
- `solution_strategies` took another **drop-and-recreate** migration for the new column.
- Claude's behaviour on all of this is still unproven; every live finding here comes from one local model.

## Round 6 — The cost-based recommendation engine

### My Feedback
The requirement: for every scoped work item, two recommendations — **fastest** (most capable model, higher cost, shortest time) and **most cost-efficient** (cheaper model, longer) — each showing estimated tokens, cost and completion time, and respecting the AI budget, token limits and the handover chain.

- **`ai/estimator.rs`** — pure. A per-purpose baseline (story generation is not the same size of job as designing a solution) scaled by how much the item actually says, priced from the editable table. Once there are **20 or more recorded calls** of that kind on that model, the **median of real usage** replaces the baseline.
- **`commands/recommendations.rs`** — candidates come from the budget's provider chain where there is one, so the options offered are the ones the router would actually allow. Fastest is the high tier; cost-efficient prefers an unmetered provider outright.
- **`CostRecommendation.tsx`** — both options with tokens, money and minutes, each labelled with where the number came from.

### Your Feedback
- **Every figure says its source.** "estimate: price table, no history yet" against "estimate: median of your recorded calls". A guess shown with the same confidence as a measurement is a dishonest number, and this is the one place in the app where being wrong about money is cheap to prevent.
- **Twenty samples before history counts.** A median of three calls is noise wearing the costume of data; below the threshold the baseline is used and labelled.
- **Only successful calls feed the median.** A declined call is cheap and a failed one is incomplete — including either would drag the estimate below what real work costs.
- **The median, not the mean**, so one runaway call cannot distort the figure. There is a test for exactly that.
- **The fastest option is withheld, not greyed out, past the hard stop** — offering something the router will refuse is worse than explaining why it is missing.
- **Deviation from the plan, deliberate:** the approved plan had an `ai_recommendation` table. I did not build it. Prices, budget and history all move independently of the work item, so a stored recommendation starts going stale the moment it is written, and recomputing costs nothing but a ledger read. A cached answer about money is the wrong trade.

### Technical Debt
- **The baselines are invented.** 4k/6k/9k tokens per purpose are stated guesses with no measurement behind them, and until 20 real calls accumulate that is what every estimate rests on. The labelling is what makes this honest rather than misleading.
- **The 3:1 input/output split is a guess too**, and it drives the cost since output is priced several times higher than input.
- **Time comes from a hand-entered `tokensPerSecond`.** The one real measurement available — 91 seconds for ~350 tokens on `ornith:9b` — suggests local throughput is far lower than any default would assume; nothing feeds observed latency back into the table, though `latencyMs` is being recorded and could.
- **Size is judged by text length**, which is a crude proxy: a short precise item may be far more work than a long rambling one.
- Only two options are offered even when the chain has more providers, and the estimate ignores prompt caching, so a repeat call about the same Product will cost less than quoted.

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

### Fixed in round 7 (below), after live testing
- ~~Ollama has no strategy path~~ — this was **a bug, not debt**: a Product past its handover threshold could not design anything at all.
- ~~Effort hard-coded to `high`~~ — the item's policy now owns it.
- ~~The violation check is textual~~ — the predicted false positive appeared on the *first* real call.

### Technical Debt
- `ai_usage_id` is stored as `None` — the ledger row is written, but the strategy does not yet link to the row that paid for it, so cost is not traceable to the artefact.
- **No live call has been made**, so the prompt's ability to produce usable options is unproven, as is whether models respect the prohibition.

## Round 4 — GitHub connection

**Behaviour:** the Develop area gains a **GitHub** card — connect once with a personal access token, then link or create a repository on any Solution.

**Implemented:** `components/GithubCard.tsx` (connect / disconnect; the token is verified against GitHub *before* it is stored, then held in the OS credential store and cleared from the form) and `components/SolutionRepo.tsx` (per-Solution Link-existing / Create-new). Backend in `github.rs` + `commands/github.rs`; the Solution model round 2 carries the link. Full detail and the debt list live in [`solutionCreation.md`](solutionCreation.md) round 2 — the Solution is where the repository actually attaches.

**Tests:** Vitest 51/51, cargo 85/85; `npm run build` and a full `cargo build` clean.

**Technical debt (Develop-area side):** the GitHub card sits below Create-a-Solution, so a first-time user creates a Solution before seeing the connection card — the Create-new button is disabled with a title explaining why, but the ordering is worth revisiting. Connection state is per-app, not per-Product.
