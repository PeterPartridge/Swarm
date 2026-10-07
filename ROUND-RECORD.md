### What I did
- Wrote and subsequently updated the `GEMINI.md` system instructions file at the workspace root to accurately reflect Antigravity-specific behaviors.
- Ensured `GEMINI.md` correctly points to `.claude/commands/*.md` instead of skills, includes the `/new-item` command, fixes the `Project_system.md` path, and accurately describes the manual nature of the Code Map and dependency linting checks.
- Demonstrated the required plan approval halt mechanism via the `implementation_plan.md` artifact before executing the final round of edits to `GEMINI.md`.

**User Feedback Addressed (Recorded for Transparency):**
- **False Safety Nets**: Removed incorrect claims that automated tools (`brief-lint.mjs` and `code-map-lint.mjs`) could catch omitted Code Map updates or dependency audits. The framework is now clear that these are manual mandatory gates.
- **Priming Defections**: Removed the phrase "Under pressure, I might naturally skip maintaining row-by-row ledgers", ensuring the rule simply states the requirement without confessing to a skip.
- **Missing `/new-item`**: Added the route for `scaffold a new page/endpoint/model` to the commands list.
- **Header Path Correction**: Fixed the target path in the header from `claude-only/Project_system.md` to `application/claude-only/Project_system.md`.
- **Inconsistent Pointers**: Changed all pointer targets from `.claude/skills/*` to `.claude/commands/*.md` to preserve the command rules.
- **Halt Artifact Tests**: Verified and recorded the out-of-tree nature of the `implementation_plan.md` artifact (meaning no `.gitignore` entry is needed) and demonstrated a successful halt on a trivial plan.

---

**2026-09-15 — the record, and the checks that could not see it drifting.** One
round for the whole cleanup rather than one per file: twelve round records for
one tidy-up would be the exact failure this work was commissioned to fix.

- **Came off a stale tree first.** Local `main` was 3 commits behind `origin/main`
  and `follow-up` was cut from it and held nothing. Fast-forwarded, deleted
  `follow-up`, branched `fix/record-drift`. This mattered: `ROUND-RECORD.md` had
  been reported to the user as *missing* when it existed on `origin/main` all
  along. Every other finding was re-verified against the updated base.
- **Split six `status: filled` briefs three ways instead of flipping them.**
  `codeEditor`, `repositoryManagement` and `SolutionManagement` → `built` (their
  code ships). `agentPolicy` → `approved` (its spec was waiting on a person, and
  the user gave it). `mcpServer` and `featureDesigner` stay `filled` and now carry
  a round bullet each saying *why* — they are genuinely unbuilt, not stale records.
- **Restored `deliverables` and `testing` to `application/Project_brief.md`**,
  which was on an older template than `template/Project_brief.md`. Drafted both
  answers and marked each with the per-answer provenance line from
  `draft-brief/SKILL.md` — **not** `status: drafted` on the file, which would have
  made `/translate` refuse all 40 item briefs at once. `brief-lint` now reads
  *MVP → Agent governance → Feature Designer* where it read *0 deliverable(s)*.
- **Unpublished the drafted brief.** `site/build.mjs` published every `.md` in the
  briefs folder regardless of status, putting `importProject` — `drafted`, four
  questions unanswered — on the public docs site. It read `status` into `entries`
  and never used it. Now excluded from the build rather than hidden from the nav,
  because a page dropped from the nav is still served, still in the sitemap, still
  indexable. 25 pages → 24, and nothing else was caught by the filter.
- **Gave `code-map-lint` the direction it never had.** Every rule in it read a row
  and asked whether the code existed; nothing asked whether existing code had a
  row, so a map covering a quarter of the codebase printed `clean`. It now also
  enumerates *surfaces* — declared in a `SURFACES` table so this ships to projects
  that are not Tauri — and reports **229 with no row** (206 commands, 23 tables).
  Landed as a ratchet at the current number, not as 229 errors on day one.
- **Fixed a Code Map row that was describing older code**: `WorkspaceShell` still
  said "three-tab menu (Product/Develop/Test)" when `EnvironmentId` has four and
  `AdminArea` renders.
- **Removed `rmcp`** (declared, used nowhere, its comment pointing at an
  `mcp/serve.rs` that was never written) — 207 lines out of `Cargo.lock`. Round 1
  of `mcpServer.md` had already instructed this; the brief now carries the exact
  line to restore. `mcp/decide.rs` untouched: it is real, tested work.
- **Removed an unreachable render branch** in `WorkspaceShell.tsx` — placeholder
  text for four environments that are all handled explicitly above it, and that
  read as though the areas were unbuilt.
- **Stubbed `HTMLCanvasElement.prototype.getContext`** in `test-setup.ts`: six
  "Not implemented" dumps per Vitest run, indistinguishable at a glance from a
  real failure.
- **Filled two briefs still carrying `# Page Brief — <Page Name>`** from the blank
  template, both `status: built`.
- Added **4 tests** for the new coverage rule, including the one that keeps it
  safe to ship: a project with none of these surfaces is untouched by it.

**2026-10-07 — `claude-only/` becomes `ai-only/`, the AI's workspace for any model.**

- **Renamed the folder everywhere it is named.** `template/claude-only/` and
  `application/claude-only/` are now `ai-only/` (git moves, so history follows).
  The bridge is `1-translate-for-ai.md` and the spec shape is
  `2-ai-system.template.md`. Every reference follows: the commands, the
  translate, emit-guardrails and pipeline skills, AGENTS.md, GEMINI.md, README,
  HOW-TO-USE, the forms, both briefs, `tools/` (both lints, their tests, QA.md),
  the `init` CLI, the Rust doc comments, and `scaffold_product`, which now
  creates `.CoperativeAI/ai-only/` (its test and Code_map row updated with it).
- **Wrote `template/ai-only/README.md`**, which says what the folder is: the
  AI's workspace, where specs, plans and round reports live. Any model can use
  it, and it explains how one works there without Claude Code. The code map is
  described as one supporting index inside it, with its cost and what it buys
  stated. The template README, the main README and the code-map template now
  say the same.
- **Made the bridge and spec template model-neutral** ("the AI", not "Claude").
  Model-tier examples now read "e.g. Claude Haiku, or your provider's smallest
  model".
- **Brought the three descriptions of a spec into agreement.** The bridge, the
  template and the translate skill disagreed: the template lacked a Testing
  floor heading, Prompt B lacked Deliverable, Prompt A's working agreement
  lacked the token-cost rule, and the skill's System Spec list lacked
  Deliverables and Testing floor. All three now list the same headings.
- **Reviewed every file in `application/ai-only/`** and corrected what was wrong:
  - `Project_system.md` claimed `anything-else` was unanswered (it is answered).
    It omitted Deliverables and the Testing floor; both are now there, marked
    drafted, along with the digest lines for them. It also silently resolved a
    contradiction about production deploys; that is now an Open Question.
  - Nine specs (four pages, five models) still read "translated — waiting for
    approval" or "approved — waiting for build" although their briefs are
    `built` and their code is in the map. Those lines are corrected without
    inventing build reports.
  - `developerWorkspace.md` depended on a `DeveloperRules-model.json` brief that
    has never existed; it now says so.
  - A stale "(round 2 …)" is gone from `productPlanning.md`'s title.
- **Fixed every broken relative link in the repository's Markdown (16).**
  application/'s briefs pointed at a bridge and `_forms/` that only exist under
  `template/`, and both Project Briefs pointed at a non-existent `example/`.
  A link check now reports none.
- Left history alone: earlier round records and round narratives still say
  `claude-only/`, because that is what the folder was called when they happened.
- Fixed README's "three Claude Code slash commands", which listed six.
- **AGENTS.md now lists the three deliverables** (MVP, Agent governance,
  Feature Designer) with what makes each done, the stop-at-the-end rule, and a
  plain statement that they are drafted and not yet accepted. Until now it said
  the brief named none.

### What I could not do (and what you would need to tell me)
- I could not dynamically test the CI/CD pipeline or linter tools (`node tools/code-map-lint.mjs`) directly because those require a Node.js environment or GitHub Actions to run, and my task was scoped purely to documentation edits. 

**2026-09-15**

- **I did not assign deliverables to the 39 item briefs** that now warn about
  naming none. Those warnings are correct and newly visible — they were masked
  while the brief had no deliverables at all. I left them because the deliverable
  names are **drafted and unaccepted**: if you rewrite them, all 39 assignments
  would be wrong, so this is genuinely blocked on you accepting or rewriting the
  three bullets first.
- **I did not decide `mcpServer` or `featureDesigner`.** The plan flagged both as
  build-or-delete decisions rather than cleanups, and `mcpServer` in particular
  intersects a design you deferred deliberately — MCP servers per agent as the
  *enforcement* layer, with the open question of whether the app adds to or
  replaces Claude Code's own MCP configuration. Deleting that scaffolding on my
  own judgement would have destroyed work you intend to build on.
- **One review finding I reported to you was wrong, and I could not fix it because
  there was nothing to fix**: `application/claude-only/CoperativeAI/developerWorkspace.md`
  is not an orphan. It is the spec for round 8b and `developerArea.md:116` links
  to it explicitly. Left alone.

**2026-10-07**

- **Who may deploy to production.** The Project Brief's `environments` answer
  says the AI may deploy to production and development; the CoperativeAI
  solution spec says people deploy production after review. `Project_system.md`
  follows the stricter solution spec and lists this as an Open Question. Tell me
  which is meant.
- **Accepting the drafted deliverables and testing floor.** Both are in
  `Project_system.md` now, but marked drafted, because the brief still carries
  the `drafted` marker on them. Only a person can accept them.
- **Whether a `DeveloperRules-model.json` brief should be written.** The table is
  built with no brief behind it. Writing one is a person's call, not mine.

### Debt I left behind
- I entirely neglected to append this round record upon completing my task, breaking the project's framework rules. I failed to automatically register my completed work, missing debt, and open questions into this file. This was a process failure on my end.

**2026-09-15**

- **`UNCOVERED_CEILING = 229` is a number that will rot if nobody moves it.** It
  exists so the new rule could land without producing 229 errors and being
  commented out in week two, but a ceiling nobody lowers is permanent permission
  to stay at 25% coverage. It fails immediately if the count goes *up*, which is
  the half that protects new work; the half that pays off the debt is manual.
- **The coverage check is deliberately lenient and therefore under-reports.** A
  surface counts as covered if its name appears anywhere in the map, including in
  prose, and existing rows bundle commands (`work_items::{list_work_items, …}`)
  so a bundled name covers several at once. The true number of commands with a
  row *of their own* is worse than 229 suggests. Fixing that properly is the
  three-grain map (method / command / table), which is its own piece of work.
- **Drafted answers now live inside a brief whose status is `filled`** — a state
  the framework does not model. The provenance line is the only thing marking
  them, and no check looks for a marker left behind after someone edits the
  answer. A `brief-lint` rule for stale provenance lines would close it.
- **`site/build.mjs` excludes only `drafted`.** A brief that is `blank` still
  publishes. That was true before this change and remains true; I narrowed the
  fix to the status the user asked about rather than quietly widening it.
- **`cargo test` needed a 7 GiB clean before it would link, and that will recur.**
  It failed twice with `LNK1318: Unexpected PDB error; LIMIT (12)` on
  `turso_sync_sdk_kit`, whose debug PDB had grown to **237 MB** — a toolchain
  limit, not a code fault (clippy type-checks every test target and passed clean
  throughout). Not caused by this round, but removing `rmcp` forced the relink
  that exposed it. `cargo clean -p turso_sync_sdk_kit` fixed it and the suite then
  ran **908 passed, 0 failed, 35 ignored**. The durable fix is a
  `[profile.dev.package]` entry capping debug info for that dependency, which is a
  decision about the project's build rather than a cleanup, so it is left here
  rather than taken.
- **The Code Map's test figures were stale and are now measured, but nothing
  keeps them that way.** `Code_map.md:195` claimed 673 cargo tests and 23 ignored;
  the measured figures are 908 and 35, and Vitest 605 → 811 across 76 files. They
  are now dated so a reader can tell how old they are — but no check compares that
  line to a real run, so it will drift again. It is the same one-directional
  blindness the surfaces rule just fixed for rows, in a different sentence.

**2026-10-07**

- **Projects made before this change still have `claude-only/`.** Products the
  app scaffolded earlier, and projects created by an older `coperativeai init`,
  keep the old folder name and their old copies of the commands and lints.
  Re-running `init` adds an empty `ai-only/` beside it rather than moving
  anything, because `init` never overwrites. There is no migration step. A
  project that wants the new layout renames the folder and refreshes
  `.claude/` and `tools/` by hand.

- **About half the item specs are thinner than the template.** No spec has a
  Deliverable heading. 23 of 41 lack Model & effort, and most of those also lack Open questions and
  Skills, and most database-model specs lack Tests. The template grew after
  they were written. Filling them in means re-running `/translate` per brief,
  and the briefs themselves name no deliverable (brief-lint warns on all 21
  models). That is a re-translation round, not a documentation fix.

- **Nine built specs have no build report.** I corrected their status lines,
  but what was built, and how each use case was implemented, was never
  appended to these specs. The code map shows the code exists. The spec does
  not say how it maps onto the brief.

- **`developerArea.md` is 5,582 lines and `qaTestDesigner.md` 530.** The
  bridge's token-efficiency argument assumes a spec is cheap to read before
  building. For developerArea it is not: about 50 rounds of reports, newest
  near the top, sit in the file a build reads. Splitting finished rounds into
  a history file beside it would keep the spec readable. That is a structural
  change people should decide, so I did not make it.

- **`marketingDesign.md` (the brief) has no front matter.** It has no `form`,
  `status` or `deliverable`, so brief-lint and `/build` cannot see what state
  it is in, though its spec says built (round 8).

- **Only the scaffold's tests were run locally, not the full Rust suite.**
  `cargo clippy --all-targets -- -D warnings` is clean, and the four
  `tooling::scaffold` tests pass, including the one asserting
  `.CoperativeAI/ai-only/` exists. The other Rust changes are doc comments
  only, so I relied on CI for the full `cargo test`. `tsc --noEmit` and
  `npm test` were not run, since no frontend file changed. `npm run check`
  (49 tests, both lints, the round-record lint) passes.
