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

## Round 15 — What a work item changes, and starting a Solution from its own toolchain

### My Feedback

**One table, not three, and not two levels.** Product's ask and the developer's plan are the same row at different stages of its life: Product adds "a basket screen" with no Solution against it, and a developer points it at one and adds the endpoints and tables that serving it needs. Modelling those separately would mean copying the ask across and keeping two records in step, and they would drift the first time somebody renamed a screen.

That also makes *unassigned* a first-class state rather than an oversight. Product genuinely does not know which repository grows a screen, and if the app insisted on one they could not record anything until a developer had done their part.

**What a Solution can carry comes from its type, in exactly one place.** `kinds_for` decides it, and both the UI and the model ask that same function — a website has screens, an API has endpoints and the tables behind them, an application has screens and local storage, a database has tables only. Two copies of that rule would drift, and the drift would only ever show up as a save being rejected for reasons the form thought were fine. The check runs on **assignment as well as creation**, or it could be walked around by creating unassigned and then pointing it wherever.

An unknown Solution type gets *everything* rather than nothing, so a type added later does not silently lose the ability to plan work against it.

**Starter projects run the toolchain's own generator, and the platform does not write one.** Every one of these toolchains ships a generator that stays current with its own conventions; a template written here would be out of date within a release and wrong in ways nobody would notice for months. Three rules make running somebody else's command honest rather than magic:

1. **The command is shown and editable before it runs** — so the button press *is* the confirmation, and nothing runs that could not be read first.
2. **The folder must be empty.** Every one of these generators writes into the working directory, and running one over existing work is how a repository gets flattened. Refused before anything starts.
3. **The output is reported whole.** These commands reach the network and depend on a toolchain being installed. When one is missing, its own words are the only thing that says which — so they are repeated rather than translated into a tidy failure that hides it.

Every offered command is the **non-interactive** spelling. `npm create vite@latest` without a template flag stops to ask a question, and a generator waiting for an answer would hang with its prompt somewhere nobody can see it.

**A failed starter keeps the Solution.** The record of what someone decided to build is worth more than the folder, and rolling it back would lose the decision along with the error — leaving them to retype everything to see the same message again. The folder is only recorded against the Solution when the run actually succeeded, because a path stored for a failed run is a working copy that is not one.

### Your Feedback

- **Names are slugged where they land in a command.** `cargo init --name Shop API` is two arguments, one of them nonsense, and most of these toolchains reject spaces and capitals in a package name anyway.
- **The partial-mock trap caught me a third time.** Embedding the new component inside the build plan meant `WorkItemBuildPlan.test` had an unmocked call falling through to the real `invoke`, rendering an error alert that broke an unrelated assertion about what else was on screen. Fixed, with the reason written above the mock so the next person adding a child component sees it.
- **`language` records what a Solution was *begun* as, not what it is.** Repositories grow other languages, and a field that claimed to track that would be wrong within a month. The test explorer already detects what is actually there.

### Technical Debt

- **Nothing connects a screen to a mockup.** Round 12 put pictures on the build plan and round 15 puts screens on the work item, and they are separate lists — a screen cannot yet point at the image of itself.
- **The generation prompt does not carry the screens, APIs and tables yet.** They are recorded and shown, but the AI still works from the free-text "what has to change" rather than from the structured list beside it. That is the obvious next round and the reason the structure exists.
- **Nothing checks a table or endpoint name for sense**, and nothing dedupes: two people can add `POST /checkout` twice.
- **A starter cannot be re-run.** If it fails, the fix is to point the Solution at a folder by hand or delete and recreate it.
- **The starter list is Windows-and-Unix generic and untested per toolchain.** Only `echo` is exercised in tests; whether `dotnet new webapi` works on a given machine is between that machine and .NET.
- **`kinds_for` is a fixed opinion.** An API Solution that genuinely has no storage still gets offered tables.

## Round 14b — The workbench: a real terminal, and who does the work

### My Feedback

The other half of round 14, and the part that carried the actual risk.

**The ConPTY spike paid for itself in the first hour.** The shell spawned, resized and died correctly — and produced exactly four bytes, then nothing, forever. Those four bytes were `1b 5b 36 6e`: `ESC [ 6 n`, a Device Status Report. **ConPTY asks the terminal where its cursor is on startup and says nothing further until something answers.** A real emulator answers automatically — xterm.js does, which is why the panel works — but anything that merely *reads* the PTY sees four bytes and silence, which is indistinguishable from a shell that failed to launch. Without the spike this would have been debugged inside a Tauri window with no test harness around it.

The second thing the spike found: **a PTY read blocks when the shell is quiet.** The obvious test loop — read, check a deadline, repeat — hangs the moment the shell reaches its prompt, which is most of the time. It hung for ten minutes before I killed it. The fix is the same in the test and in production: reading happens on its own thread, and in production that thread emits Tauri events, because a shell speaks when it feels like it and a request/response call cannot carry that.

**Keystrokes travel as bytes, not lines.** Ctrl-C is `\x03` and the arrow keys are escape sequences; anything that assumed whole lines would break both, and Ctrl-C is half the reason to want a real terminal.

**The AI window presents two different shapes of thing, not two engines.** Ollama answers inside the editor through the Product's policy, the budget router and the ledger, and never touches disk. Claude Code runs in the terminal and writes files itself; the app's contribution is the brief. **No cost is shown for a Claude Code run, and the panel says why** — it bills against its own subscription, so any figure would be one this app cannot see. Running it is a deliberate press, and the command is *typed into the shell* rather than executed behind it, so what ran is in the scrollback like anything else somebody typed.

**Properties sit under the tree** because they describe the selection, not the buffer. A binary file reports "binary file" for its line count rather than 0 — a number that would be a lie about a PNG rather than a fact about it.

### Your Feedback

- **The Tauri event API cannot run in jsdom**, and it threw before any component could render. Stubbed in `test-setup.ts` globally rather than per test file, deliberately: a partial `vi.mock` with `...original` lets anything unlisted fall through to the real module, and this project has been bitten by that silence more than once. A global stub cannot be forgotten by the next test that renders a terminal.
- **Terminal output is never logged or persisted**, per the page brief. It can contain anything somebody pastes. It goes from the PTY to the window and nowhere else, and scrollback dies with the widget.
- **The shell is started in the Solution's folder or not at all.** A missing folder is refused with a message rather than falling back to somewhere else, because falling back is how a destructive command gets run in the wrong repository.
- **xterm.js loads on demand, like Monaco.** An editor and a terminal in the startup bundle would be paid for by everyone who never opens either.

### Technical Debt

- **Killing the shell does not kill what the shell started.** An `npm run dev` launched in the panel outlives it and keeps holding its port. Named in the code where the kill happens.
- **Scrollback is not persisted or searchable**, and closing the tab loses it. That is the brief's own instruction, but it does mean a long test run's output is gone once the panel closes.
- **One shell per Solution tab.** No split panes, no second terminal on the same repository.
- **The terminal is a local shell with the user's own permissions** — that is the entire point of the feature, and it is also arbitrary local execution reachable from the app's UI. Stated plainly rather than left implied.
- **Nothing tests the panel end to end.** The PTY has real cargo tests; the React side is tested only up to the point where xterm would draw, because jsdom cannot host it — the same limit the Monaco work hit.
- **The Ollama half of the AI window is a description, not a control.** It explains where the pal lives; the pal itself is still the one inside the editor.

## Round 14a — The inspectors: tests in any language, and git across every Solution

### My Feedback

Two decisions were put to you first, because both changed what got built. You chose **inspectors before the workbench**, and a **real PTY** for the terminal when it comes. This round is the inspectors; the terminal, the Ollama/Claude Code selector that depends on it, and the explorer properties panel are the next one.

**"Regardless of language" is made real by three things rather than claimed by one.**

*Detection finds every suite, not the first.* A Tauri Solution has a `package.json` at the root and a `Cargo.toml` in `src-tauri`. Stopping at the first marker would run half the tests and report the Solution green — the worst possible outcome for a test explorer. Detection looks at the root and one level down and returns everything it recognises. One level, not a full walk: it covers the layouts this platform actually creates and stops well short of finding other people's fixtures in a large checkout.

*A per-Solution command overrides detection entirely,* so a language nobody here has heard of is one text field away. Blank clears it, because a command that turned out wrong must not be permanent.

*Counts are shown only when they were read.* Each parser returns nothing when the output is not the shape it expects, and the run falls back to the exit code with `counted: false` — the UI then says "passed — no test count could be read" rather than a number. **The summary line follows the same rule**: a run nobody could count is reported as "known only by exit code", never totalled into a truthful-looking `0 passed`. That flaw was in the first version and a test caught it. Five parsers ship — cargo, vitest/jest, pytest, dotnet, go — each a pure function over captured output, so all five are tested without those languages installed.

**The git hub reads porcelain v2, not the v1 the review code uses.** v1 cannot report an upstream or how far a branch has drifted, and — the reason that actually mattered — it reports a merge conflict as an ordinary modification. v2 gives conflicts their own line type, which is the only thing that makes the three-pane view possible at all. A Solution with no folder reports why on its own row and the rest still work; a hub that blanks when one entry is unlinked is useless in exactly the situation it exists for.

**The merge view takes mine and theirs from git's index, not from disk.** Once git writes markers into the working tree, the two original versions exist nowhere else — stages 2 and 3 are the only place they survive. The third pane is that working-tree file, and it is the only editable one, because it is the only one that becomes the result. Marking resolved saves first and stages second (staging reads from disk, so staging an unsaved buffer would mark a version nobody chose) and is **refused while markers remain**, in the UI and again in the backend. Committing `<<<<<<< HEAD` is a classic, and the check costs one read of a file already open in front of you.

**The git toggle** swaps the explorer from the repository to the work in progress, across every Solution at once, with each file's diff rendered from git's own unified diff rather than recomputed — a second opinion from the app could only ever disagree with the git tab.

### Your Feedback

- **Two parser bugs, both caught by tests written from real captures.** The porcelain v2 path offset was wrong (ordinary entries put the path 8th, renames 9th), and the cargo summary scanner read fields positionally, so `test result: FAILED. 1 passed` lost that entire clause to the verdict token. Both would have shipped as quietly wrong numbers, which is the failure mode this whole feature is supposed to prevent.
- **The database lock is dropped before anything slow runs.** A suite can take minutes; holding the connection across it would freeze every other part of the app behind a test run.
- **Solutions run one at a time, deliberately.** Several runners at once compete for the same cores and disk and the wall-clock total is no better for it — and running them in sequence means results appear as each Solution finishes rather than after the slowest.
- **A failing test run is an outcome, not an error.** `run` never returns `Err` for red tests; only a command that could not start at all fails, and that is reported through the exit code plus the raw output, which is what someone needs in order to fix the command.

### Technical Debt

- **No timeout on a test run.** A hung suite hangs that command. The lock is released so the rest of the app keeps working, but nothing kills the process.
- **Commands run through the platform shell** (`cmd /C`, `sh -c`) so that a typed command line behaves the way it would in a terminal. That is the right behaviour for a local dev tool and it is also arbitrary local execution — worth stating plainly rather than leaving implied.
- **Nothing streams.** Output arrives when the process exits, so a five-minute suite shows nothing for five minutes. The PTY round is the natural place to fix this.
- **The three-pane view is plain textareas, not Monaco.** No syntax highlighting and no per-hunk "take mine / take theirs" — the panes show the versions and the middle one is edited by hand.
- **`npm test` is the fallback for an unrecognised manifest**, and its output is unparseable by design, so those runs are exit-code only.
- **The changed-files toggle fetches the whole Product at once** and does not refresh itself — there is a Refresh button, and a file saved in the editor does not update the diff until it is pressed.
- **Detection stops one level down.** A monorepo with `packages/*/package.json` gets nothing without a custom command.

## Rounds 12–13 — The build plan, and letting the AI see the mockups

### My Feedback

**The build plan (round 12).** A work item now opens onto the Solutions it touches, and each one carries what it needs: changes required, unit tests, the branch to make and the branch to clone from — both prefilled from the Develop Strategy's pattern — questions for Product, and pictures. The written half and the AI-generated half are **separate writes that never overwrite each other**, so regenerating cannot silently erase what a person typed. Questions reuse the existing AI-feedback channel rather than growing a second one, which means an answer Product gives becomes a clarification that reaches the generation prompt without anyone re-typing it. Generation returns an API schema, a page schema and the files each Solution should expect — schemas, not raw code, because this app's job is to prepare and review while the agent writes. Replies are matched back to Solutions **by name**, and a reply naming a Solution that no longer exists is dropped and reported rather than written onto the wrong repository.

**Vision (round 13).** Round 12 shipped with the pictures named to the model and the model told it could not see them. That is now conditional on the truth.

Pictures are read from disk, encoded, and attached: typed image blocks for Claude, bare base64 in an `images` array for Ollama — two different shapes for the same idea. On the Claude side they sit **inside the cached prefix**, with the cache mark moving from the context text onto the last image. That is the whole cost argument: mockups do not change between regenerations of the same work item, and an image is the most expensive thing in the request, so leaving them outside the prefix would re-bill the dearest part at full price every time.

**Whether a model can see is a person's answer, recorded in AI Settings, and off until they give it.** The platform cannot establish it cheaply — asking a model whether it can see costs a call and earns an answer models get wrong about themselves — and being wrong is expensive in both directions: mockups sent to a text-only model buy an error, and mockups withheld from one that can see leave it guessing at a layout that was sitting on disk. So a capability nobody has confirmed is treated as absent.

The prompt then follows what was **actually** sent. Attached: "read the layout, fields and states from them." Not attached: the old wording, unchanged. A model told to look at pictures it never received will describe what it thinks it saw, and that is worse than a model that asks.

### Your Feedback

- **Guards run before the call, not after it.** 4 MB per image, four images per request, and a fixed list of types. A refusal on our side is free; the same refusal from the API is billed and arrives as a wall of provider error text.
- **Every omission is named back on the run.** A picture silently dropped is a picture the user believes was looked at, so the run's reason line says how many were shown and, separately, what was not sent and why. This is the same rule as the cost display: never let the app imply something it did not do.
- **Removing the text-only body builder was the right cleanup.** Once every path went through the images-capable one, keeping a thin wrapper for the empty case left a function only tests called — so the tests now exercise the production path with an empty slice, and one of them pins that a text-only call gains **no `images` key at all**, because some Ollama builds read its mere presence as a demand for a vision model.
- **Two capability facts now live on `model_installs`** — whether the model passed validation, and whether it can see — and the table still has no model brief of its own. It is the only table in the platform without one.

### Technical Debt

- **Nothing checks that a recorded path is still a picture.** The plan stores paths; if the file is moved or replaced between typing it and generating, the run reports it as skipped, which is honest but late.
- **The 4 MB and four-image limits are constants, not policy.** They belong in Admin with the other budgets, and a Product that works on dense UI will hit the count first.
- **Nothing resizes.** A 4 MB screenshot is sent at full resolution and billed accordingly, when a downscale would usually read the same and cost a fraction.
- **The vision toggle is per model, not per model per provider capability probe.** It is a person's assertion with nothing checking it, so a mistyped answer is discovered by a failed generation.
- **Standing: the Claude path is unproven live** — and vision has just made that gap wider, because image blocks inside a cached prefix are exactly the shape no test here can prove. `ANTHROPIC_API_KEY=sk-... cargo test -- --ignored caching_is_live` remains the single highest-value check available, and only you can run it.

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

- ~~**Nothing renders the diagrams.**~~ **Closed the same day.** Mermaid draws Mermaid; `jsonGraph` is converted to a flowchart and drawn the same way. **PlantUML is deliberately still not drawn** — rendering it in a browser means posting the diagram to plantuml.com, and sending a private architecture to a third party to get a picture is not a trade worth making, so the source is shown with that reason. Mermaid is loaded on demand: the startup bundle moved 286.6 → 289.9 kB.
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
