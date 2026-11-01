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

**2026-10-07 — developers start their own projects**

- **Asked:** "Can we allow developers to create their own projects in their own
  area and solutions around it." Every Solution needs a Product, and only the
  Product tab could make one. The seeded Developer role cannot see that tab, and
  Develop's empty state still sent people there.
- **Asked three questions before building, and you picked the smallest option
  each time:** a project is an ordinary Product; "their own area" means the
  Develop tab, with no ownership recorded; AI policy stays deny-by-default and
  Admin's.
- **Built** `NewProjectForm` (name only, through the existing `create_product`)
  as a "Create a project" card on Develop → Map, above "Create a Solution". The
  new project is selected in the Develop picker and the Solution form. With no
  Products, the Develop bar now offers a "Create a project" button instead of
  pointing at the Product tab. No Rust change.
- **TDD:** four Vitest cases written first and seen failing (one replaces the
  old "create a Product first" test). `npm test` (tsc --noEmit + Vitest)
  814/814 across 76 files (installed with `npm ci --force` on this Linux
  container: the lockfile is resolved on win32, as `ci.yml` explains); `npm run check` clean apart from the deliverable
  warnings that were already there.
- Recorded as round 3 on `application/CoperativeAI/solutionCreation.md` and its
  spec; Code_map rows for `DevelopSolutions` and `NewProjectForm` updated.
- **Rust gates pass** although no Rust file changed: `cargo clippy --all-targets
  -- -D warnings` clean, `cargo test` 912 passed, 0 failed, 35 ignored
  (live-only).
**2026-10-07**

- **Measured what the 229 surfaces actually owed before changing anything.**
  Of 206 unmapped Tauri commands, 139 already carried a doc comment; of 21
  unmapped database tables, 21 did. Paying the count down with rows would have
  been transcribing ~160 explanations into a table — a third copy of prose that
  already lives in the brief and the item spec.
- **`code-map-lint` now reports two numbers instead of one.** *No explanation
  anywhere* (106) is ratcheted and fails when it rises. *Explained in the code
  but not indexed* (123) is reported and never fails — the explanation exists,
  and where it is indexed is a judgement about reuse rather than a gap.
- **A doc comment counts as an explanation**, in any language: `///`, `//!`,
  `/** */`, `#`, `--`, `"""`. Tables are read from the module header, because a
  comment above `CREATE TABLE` describes the `create_table` function, not the
  table. `commentAbove` refuses to borrow a preceding declaration's comment —
  `claude_code_status` has a `const PROBE_FRESH` doc comment two lines up and is
  correctly counted as unexplained.
- **An 80-character floor**, because `// TODO: tidy this up` would otherwise
  discharge the rule. This is why the honest ceiling is **106, not 67**: 44 of
  the doc comments are one line restating the name. `/// Writes to the
  terminal.` is 30 characters and tells a reuse scan nothing.
- **`3-code-map.template.md` documents the surface check for the first time** —
  it had never been updated when the check landed, so projects installing via
  `npx` got a lint whose main rule was undocumented.
- 54 tests pass (16 new, one existing assertion reworded). `npm run check` is
  clean at exit 0.
- **The six procedures moved out of `.claude/` into
  `template/ai-only/procedures/`.** Their text was never Claude-specific — each
  is a procedure written in English — but their location was, so an agent that
  was not Claude Code arrived to find the framework's instructions filed under
  `.claude/` and addressed to somebody else. 31 KB of procedure, one copy.
- **All six commands and all four skills are now pointers**, 575–1,129 bytes
  each, down from up to 7.4 KB. Each keeps its front matter, because that is what
  makes Claude Code trigger it, and its body says which procedure to follow.
- **`init` writes an `AGENTS.md`.** It carries the procedures table, the working
  agreement, the checks and the honest limits — all true on day one — and marks
  house rules, security, testing and deliverables as *not yet filled in* rather
  than inventing them. It has the generated-file header, so `/emit-guardrails`
  replaces it once there is a spec to generate from.
- **`emit-guardrails` emits the procedures table into every format** and no
  longer claims the procedures do not travel. They do; what does not travel is
  enforcement, which is narrower and true.
- **Four new checks, two of which found real faults on their first run.** Every
  procedure must be reachable from some tool; a pointer may not grow past 2 KB
  (how a procedure creeps back into one tool's folder); every procedure a
  pointer names must exist; and every path the starter `AGENTS.md` names must
  exist in a fresh project. That last one caught `ai-only/Project_system.md` and
  `ai-only/Code_map.md` being named as though they were there on day one, when
  both are outputs — the document now says so, and the check reads the same
  admission rather than carrying its own exception list.
- **Repointed a test that had quietly stopped checking anything.** "Every skill
  a command asks for exists" matched `run the \`x\` skill`, which no command says
  any more, so it passed on an empty set. It now checks the unrooted
  `ai-only/procedures/…` form — the path a project actually uses, which the
  rooted-path test skips by design.
- **One piece of real drift found and fixed while doing this.** The `brief-lint`
  deliverable check lived only in `.claude/commands/translate.md`, so an agent
  following the procedure was never told to run it. It is in the procedure now.
- 57 tests pass; `npm run check` clean at exit 0. Verified by running `init`
  into an empty folder: `AGENTS.md` is at the root and every path it names
  resolves.
- **`init` now copies all three checks, not two.** `round-record-lint.mjs` was
  inside the published package and missing from the copy list, so every project
  created with `npx` got the two checks that read what an agent wrote *while*
  working and none of the one that reads what it wrote afterwards. The test now
  names each check individually rather than trusting `tools/`, so one cannot
  drop out again unnoticed.
- **The app moved here from CooperativeAICoding, history kept.** `app/`,
  `application/`, the guardrails, this record, `rust-toolchain.toml` and the
  CI and release workflows came across with every commit that touched them and
  all 53 version tags; the framework stayed behind. Every kept path was checked
  byte-identical to the source, and `v0.2.52` points at the code that release
  was built from. Swarm's own `.gitignore` was dropped in the merge: its bare
  `debug` rule would have hidden `src-tauri/src/debug/`, the debugger module.
- **This repository checks itself.** `brief-lint`, `code-map-lint` and
  `round-record-lint` are copied into `tools/` from CooperativeAICoding at
  `dc69caa`, as `init` copies them into any project; CI's `documents` job runs
  those three and no longer runs the framework's own tests, which stayed with it.
- **Releases are held until the rename.** `release.yml` no longer runs on a
  push to main, so the first release from here is named Swarm rather than
  0.2.53 going out as CoperativeAI. The manual trial build still works and
  still publishes nothing.
- **The app is Swarm.** Product name, window title, identifier
  (`com.swarm.app`), crate and package names, the `app/Swarm` folder, the
  briefs (`application/Swarm`, `application/Swarmdb` and their `ai-only`
  mirrors), the database file (`Swarm.db`), `SWARM_DATA_DIR`, the keyring
  service, the WSL distribution and agent image, the folders the app writes
  into a user's repository (`.Swarm/`, `.swarm/`), the SSH key name and the
  browser-storage keys. Nothing carries data across from the old names — the
  app has no users yet, so there was nothing to carry. Three things keep the
  old name on purpose: `coperativeai init`, which is the framework's own CLI; a
  real local folder path in a sandbox test; and the checks in `tools/`, left
  byte-identical to the framework's so a later copy shows only real changes.
- **One name, one place.** The keyring service was typed out in three files
  and is now `ai::keys::SERVICE`; the database file name was typed in five and
  is now `db::DB_FILE`.
- **Releases run again on a push to main,** so the next merge publishes
  0.2.53 as Swarm. That also ends the gap the previous round left, where main
  was checked by nothing.
- **The guardrails stop describing a repository this is not.** `AGENTS.md`
  said the framework was "in this same repository" and listed `template/`,
  `example/` and `site/`; twelve brief and code-map links pointed at those
  folders with relative paths. They now point at CooperativeAICoding on GitHub,
  and each target was checked to exist there.
- **Swarm has a README.** It is the app half of CooperativeAICoding's old
  `INSTALL.md` — downloads, Windows and Linux installs, what the app needs,
  building from source — moved here with the new names, since the framework's
  install page now covers only the framework.
- **Develop and QA hand a Project over to Product** (decided 2026-10-07).
  Briefs first: `Product-model.json` gains `origin` and `handedOverAt`, and
  `productPlanning.md` (round 11), `developerArea.md` (round 103) and
  `qaTestDesigner.md` (round 7) record the decision, with their `ai-only`
  specs. Then the code: `product::create_from` and `product::hand_over`, an
  in-place migration for existing tables, `create_product(origin)` and
  `hand_over_product`, and `ProductDto` carrying `inProductArea` so no screen
  works it out for itself. Develop's "Create a project" now makes a Develop
  Project that stays there; Test gains the same form; both offer **Send to
  Product** (`SendToProduct`, one component) on their own un-sent Project; the
  Product home lists only what is in the Product area and marks a sent Project
  **From Develop** or **From QA**. The six database tests written red before
  this round are what the database code was written to.

**2026-10-27 — Cells, Round A: the sandboxing moves into a folder of its own.**
The user asked for the sandboxing to become a bolt-on in a new folder called
Cells, with Sandboxie and a Linux / WSL Linux cell to follow. The plan was
approved in rounds; this is Round A, the move, with nothing a person sees
changing. Spec and report: `application/ai-only/Cells/cells.md`.

- **A crate of its own at `app/Cells`.** The seven `tooling/sandbox*.rs`
  modules moved there with only their `crate::` paths changed. Swarm depends on
  it by path and re-exports the seven modules under `tooling::`, so no caller in
  Swarm changed. `which`, the only thing they borrowed from Swarm, moved with
  them and `dev_runner` re-exports it. So did `sha2`, which only the policy
  digest used.
- **The seam test stayed in Swarm**, because it guards Swarm's callers. Its
  scanner is now `cells::seam::spawners`, and Cells uses the same scanner to
  check its own two spawning files. That way there's one scanner rather than
  two copies drifting apart.
- **The three panels moved to `app/Cells/ui`** with their types, their CSS and
  their tests. Each now takes its host's calls as a prop through a small
  interface. Swarm passes in its own Tauri wrappers as `cellsBackend` and
  resolves the folder through an `@cells` alias.
- **CI runs Cells' clippy and tests** in `ci.yml` and both release jobs.
  AGENTS.md, the Project Brief and the Project Digest list Cells as a solution
  and name its gates.
- **A drafted brief for Cells** (`application/Cells/application-spec.json`),
  marked `drafted · guessed` throughout, and a Round 13 bullet in the Agent
  Sandbox brief recording the request.
- **Proved:** Cells' clippy is clean, and 97 of its tests pass with 11 ignored.
  That is all 108, 107 moved plus 1 new. Swarm's `tsc` and `npm test` pass (76
  files, 814 tests; the 36 moved panel tests are the same 36). `npm run build`
  succeeds and the panels' CSS lands where it sat in the cascade. The code-map
  lint has 0 errors.

**2026-10-27 — the Linux release build keeps its lockfile.**

- **Found why no release has ever published.** The Linux job deleted
  `package-lock.json` before `npm install`, so `^2.9.0` resolved
  `@tauri-apps/api` to 2.12.4 and `@tauri-apps/plugin-dialog` to 2.8.3, while
  Cargo.lock holds `tauri` 2.11.5 and `tauri-plugin-dialog` 2.7.1.
  `tauri build` refuses Tauri packages that differ in minor version. Windows
  passed because `npm ci` honours the lockfile, but `publish` needs both
  platforms.
- **Changed one line in `release.yml`:** the lockfile is no longer deleted. The
  platform-pin swap stays, so `npm install` changes only those two entries. The
  comment above the step now says why.
- **Proved:** a dispatch trial on `fix/linux-release-lockfile` (run
  40571870048) went green on all four jobs. Linux built the .deb, .rpm and
  AppImage, Windows built the .msi, NSIS installer and portable binary, and
  `publish` counted six assets. Nothing was published, because the release step
  is held behind `push`. Before the push, a local Linux-targeted
  `npm install --package-lock-only` showed the Tauri packages stay on 2.11.1
  and 2.7.1.

**2026-10-27 — Hives: the work areas move out of Swarm, are granted per role, and the app opens on a chat.**
The spec and the three round reports are in `application/ai-only/Hives/hives.md`.

- **Round 1 — the move.** Product, Develop and Test are now Hives in
  `app/Hives/{product,develop,test}`. Each folder holds its page, a `hive.tsx`
  (id, label, icon, colour, screen, palette views), and the Test-only
  components and tests. `app/Hives/registry.ts` lists them, and the rail, the
  screen switch, the ⌘K palette and the colour settings all read from it. Swarm
  reaches the registry through `@hives`, and the Hives reach back through
  `@swarm`. Tab colours are keyed by id. There was no change in behaviour.
- **Round 2 — permissions per Hive.** There is a new `role_hives` table, and
  `canProduct`, `canDevelop` and `canTest` are copied into it once. A Hive
  nobody has granted is hidden from everyone except Admin, which sees every
  Hive. There is a new `set_role_hive` command and a `canAccessHive(id)`
  check. The Admin role table draws one column per registered Hive.
- **Round 3 — the chat as home.** The app opens on a chat (`ChatHome`), and
  the rail stays. The chat is about a Product. A turn goes through that
  Product's AI policy (deny-by-default), the router and budget, and the usage
  ledger under a new `chat` purpose. The AI proposes actions from a list
  (`lib/chatActions.ts`): open a Hive, open a view, set the theme, set a Hive's
  colour, create a work item. Each action is checked again on screen against
  the role and its arguments. Layout and appearance run at once; creating a
  work item waits for Confirm. A refused action is shown with its reason.
- **Proved:** `tsc --noEmit` is clean; `npm test` passes (81 files, 852
  tests, 25 of them new); `npm run build` succeeds; the code-map lint has 0
  errors. The Rust that can run without Tauri (`db/role.rs`, `db/role_hive.rs`,
  `ai/chat.rs`) was compiled and tested in WSL: 23 tests pass, and clippy with
  `-D warnings` is clean. `commands/roles.rs` was type-checked and clippy'd
  there too, with Tauri's `State` stubbed.

**2026-10-27 — the Dependabot security alerts.**
One branch in place of Dependabot's #8 and #9. Both PRs were red on
`documents` because a lockfile bump brings no round record, and #9 was also
red on `rust` because it was built against an older `main`.

- **npm (`app/Swarm`).** `vite` 6.4.3 → 6.4.5 (launch-editor, `server.fs`,
  cross-origin middleware). `vitest` / `@vitest/mocker` 5.0.0 → 5.0.5 (mock
  registration, Windows backslash traversal). `dompurify` override 3.4.16 →
  3.4.17. `source-map-js` 1.2.1 → 1.2.2. `mermaid` 11.16.1 → 12.2.0, because
  no 11.x accepts the fixed `katex` (0.18): 12.2.0 is the first mermaid that
  does, and it brings `katex` 0.18.10. `npm audit` now reports 0.
- **cargo.** `rustls` 0.23.42 → 0.23.46 and `rustls-webpki` 0.103.13 →
  0.103.16, in both `app/Swarm/src-tauri` and `app/Cells`. That clears all
  eight rustls alerts.
- **Code scanning.** `ci.yml` now sets `permissions: contents: read`, which
  clears the three `actions/missing-workflow-permissions` alerts. Two alerts
  were false positives and were dismissed, not changed. In
  `rust/non-https-url` (`sandbox_policy.rs:331`) the http URL is the test
  that proves `fetch` refuses http, and the https check returns before
  `reqwest::get`. `js/bad-tag-filter` (`DiagramView.test.tsx:154`) is a test
  counting Mermaid `-->` arrows, not an HTML filter.
- **Proved:** `npm test` passes (81 files, 852 tests), which includes
  `tsc --noEmit`, and `npm run build` succeeds with mermaid 12.

**2026-10-29 — Extensions, Round 1.** Hives and Cells are installed and
removed from Admin → Extensions, and a new Swarm starts with none. Spec and
report: `application/ai-only/Hives/extensions.md`.

- **The standard file.** `swarm-extensions.json` (format 1) is at the
  repository root and lists the three Hives and two Cells. Swarm builds the same
  file in as its list of what it contains, so the two cannot drift. A Rust test
  ties its Cells to `SANDBOXES`, and a Vitest test ties its Hives to `HIVES`.
- **Reading a source.** `extensions::catalogue` checks every rule purely and
  `extensions::fetch` gets the file. It accepts HTTPS only, gives up after
  10 s, and stops reading at 256 KB. An entry that carries code is refused.
- **What is installed.** The new `installed_extensions` table starts empty on a
  new database. An existing database gets the five extensions it was using,
  once. Removing a Hive drops its role grants first.
- **What it changes.** `get_active_permissions` lists only installed Hives,
  Admin included, so the rail, palette and chat follow. The role editor shows
  only installed Hives. The sandbox setting refuses a cell that is not
  installed. A new run gate, `cell`, refuses agent runs when no cell is
  installed (O1 (a)). The cell the setting names cannot be removed.
- **Admin → Extensions** has an Installed card (Remove; a Hive asks first) and
  an Add card (a source URL defaulting to this repository's `main`, and Read).

**2026-10-29 — the framework brought up to date, and every spec re-translated.**
No item's work fits a deliverable: this is the framework's own upkeep.

- **Copied in from CooperativeAICoding `main` (`64c7777`)**, by hand, as
  `init` lays them out: `application/_forms/`, `application/ai-only/README.md`,
  `1-translate-for-ai.md`, `2-ai-system.template.md`, `3-code-map.template.md`,
  `application/ai-only/procedures/`, `application/qa/regression.md` and
  `signoff.md`, `tools/spec-lint.mjs`, `tools/check.mjs`, and the newer
  `tools/brief-lint.mjs`. `code-map-lint.mjs` and `round-record-lint.mjs`
  already matched, except Swarm's own code-map ceiling (105), which is kept.
- **The Project Brief** became `ai-only/Project_digest.md` and a new-format
  `ai-only/Project_system.md`. **Solutions:** `ai-only/Swarm/_solution.md` and
  `ai-only/Swarmdb/_solution.md`, each with its preset and baseline copied in.
- **Items:** 19 Swarm page specs and 21 Swarmdb model specs. Each line cites
  the answer it came from. Each file keeps the spec it replaced **whole** under
  one `## Round history` heading (title demoted), because the old specs used
  `## PLAN`, `## Report back`, `## Report back — round N` and `## Round N` for
  their history, and their bodies carry round behaviour and test status the
  briefs' answers do not. A script confirmed every old file is in its new one,
  verbatim. The model specs were generated from the JSON briefs by a script,
  one line per answered field, relationship, lookup and lifecycle rule.
- **AGENTS.md** now points at `application/ai-only/Project_digest.md`.
- **Proved:** `spec-lint` finds every line sourced. Its only errors are the
  62 "built, and C<n> has no test naming it", across 16 built page specs.
  `brief-lint`, `code-map-lint` and `round-record-lint` pass. No code changed,
  so the cargo and npm gates were not run.

**2026-10-30 — CI's Rust job made to pass again (PR #19).**

- **Why it failed:** PR #18 merged the first half of Extensions Round 2 step 3
  — `store`, `fetch::read_code` and `approval_matches` — before Install calls
  them. With `-D warnings` the ten unused items failed clippy on `main`, and so
  on every PR, this docs-only one included.
- **The fix:** `#[allow(dead_code)]` on `approval_matches` and `read_code`, and
  on the `store` module, each saying Install reaches it in the second half of
  step 3. The same pattern `mcp/decide.rs` uses. No behaviour changed.

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

**2026-10-07 — developers start their own projects**

- **Which deliverable this belongs to.** It does not clearly fit MVP, Agent
  governance or Feature Designer, so the brief names none. Tell me if it is MVP.
- **Whether developers should own their projects** (recorded per team member,
  "mine" shown first). You chose not to for now. If wanted later it needs an
  owner column and a statement that it is visibility only, not access control.
- **Not run in the real Tauri window.** The form is covered by mocked tests only.
**2026-10-07**

- **Whether 80 characters is the right floor.** It admits every doc comment in
  this repository over one line and rejects every one-liner, which is the
  behaviour I wanted. But it is a number I chose from this codebase's own median
  of 236, and a project whose house style is terser would be judged unfairly by
  it. If it should be configurable per project rather than fixed, say so.
- **Whether the unindexed 123 should ever fail.** I made it a note, on the
  argument that a doc comment is a better home than a table row. If you want the
  map to be a complete index — every surface named, prose or not — that is a
  different rule and I have not built it.
- **I did not write any of the 106 missing explanations.** The ceiling records
  the debt; paying it down is work on the code, not on the lint, and nobody
  asked for it in this round.
- **Whether `init` should write an `AGENTS.md`.** Verified by running `init`
  into an empty folder: the forms, the bridge and all three checks are
  agent-neutral, but all six commands and four skills are under `.claude/`, and
  no `AGENTS.md` is written — so a non-Claude agent arrives to instructions
  addressed to somebody else. `/emit-guardrails` produces one, but it is itself
  a Claude Code command, so Claude is needed once to bootstrap any other model.
  Writing one at `init` could only be a generic starter, since
  `emit-guardrails` generates from the translated spec and there is none yet —
  and a generated file with nothing project-specific in it may be worse than
  none. That is a product decision, so I left it.
- **I could not run the gates locally for the move.** Clippy, `cargo test`,
  `tsc` and `npm test` run on this repository's pull request instead; the code
  is byte-identical to what passed them in CooperativeAICoding, so a failure
  there would be the new repository's setup, not the code.
- **Two questions about the framework side are still open:** whether
  CooperativeAICoding keeps, splits or drops its copy of this record, and
  whether it gets guardrails of its own once `AGENTS.md` and `GEMINI.md` have
  left with the app.
- **The rename was not tested by a test of its own.** It is a rename: the
  existing suites passing under the new names is the evidence, and a test that
  a constant equals a literal would only restate it. Nothing checks that the
  built installer is called Swarm or that a fresh start creates `Swarm.db` in
  the `com.swarm.app` folder; that is seen by running it.
- **`AGENTS.md` was edited by hand, not regenerated.** Its header says to edit
  the brief and run `/emit-guardrails`; the lines that were wrong are not in
  `Project_system.md`, so regenerating would not have fixed them, and may drop
  them on the next run.
- **I could not compile the Rust for the hand-over locally.** The machine's
  Visual C++ build tools went missing during the session (`link.exe` is gone
  and the Visual Studio installer lists nothing), so clippy and `cargo test`
  — including the six hand-over tests — run on this pull request's CI and
  nowhere else. `tsc` and all 827 frontend tests passed locally.
- **What I did not test:** the screens in the running app. The frontend
  tests prove the Product home hides an un-sent Project and marks a sent one,
  and that Develop and Test send it; nobody has pressed the button in Swarm.

**2026-10-27 — Cells, Round A.**
- **I could not run Swarm's cargo gates.** This machine has no Visual Studio
  build tools, so there is no MSVC linker and no Windows SDK, and no Rust crate
  builds natively here. WSL Ubuntu has Rust but not the GTK/WebKit libraries
  Tauri needs. Cells' gates ran in WSL. Swarm's clippy and `cargo test` run in
  CI on the pull request. I checked by hand for the ways a crate split usually
  breaks (restricted visibility, `cfg(test)` helpers, relative paths, test-only
  coupling) and found none, but that is a reading, not a build.
- **Rounds B to D need answers before they start.** How a Sandboxie run's work
  leaves the box (opened through to the disk, or recovered afterwards). Whether
  the native Linux cell is bubblewrap. Whether Round 12 of the Agent Sandbox
  brief is built before the Linux cell. And whether this goes ahead of the MVP,
  which the project's goals put first. All four are in the Cells brief's
  `openQuestions`.
- **The Cells brief's answers are mine, not Product's.** Its purpose, framework
  and security answers are drafted from what was asked in chat and are marked
  as such.
- **What I did not test:** whether the moved panels look identical in the
  running app. The CSS rules are byte-identical and land in the same cascade
  position in the built bundle, but nobody looked at the Admin area afterwards.

**2026-10-27 — the Linux release build keeps its lockfile.**

- **What I did not test:** a real `push` to main publishing a release. The trial
  ran everything except that last step. It will first happen when this merges.
- **Left for a decision:** three other pipeline findings from the same check
  are not fixed (see Debt). Each needs a choice, not just a code change.

**2026-10-27 — Hives.**

- **Some of the Rust has not been compiled anywhere.** Swarm's `cargo clippy`
  and `cargo test` did not run: this machine has no MSVC linker, and WSL has
  no GTK/WebKit. Never built: `ai::backend::chat`, `commands/chat.rs`,
  `ai_run::product_policy_gate`, the three visibility changes
  (`client::post_structured`, `ollama::chat`, `claude_code::turn`) and the
  registrations in `main.rs`, `commands/mod.rs`, `ai/mod.rs` and `db/mod.rs`.
  CI on the pull request is the first real build.
- **"Anything the app can do" is five things so far.** The mechanism is built
  (an offered list, checks on screen, confirmation for writes); the list is
  short on purpose. Tell me which commands should come next, and for each
  whether it needs a confirmation.
- **The chat needs a Product.** Every AI call here is held to a Product's
  policy, budget and ledger, so the chat is too. On a fresh install with no
  Product it says so and does not call. A chat that works with no Product
  would need an app-wide AI policy and budget, which is a decision for you,
  not me.
- **The Workspace Shell brief and the Project Digest still describe four fixed
  tabs.** Product owns the brief, and I did not rewrite its answers. Updating
  the brief and running `/translate` would bring both into line.
- **What I did not test:** a real conversation with a real model (no
  provider is configured here); the app running (it cannot be built here);
  how the chat looks. `MarketingDesign.test.tsx` timed out once at 5s in a
  full run and passed on the re-run and on its own.

**2026-10-27 — the Dependabot security alerts.**

- **The `glib` alert (#25) is not fixed, and cannot be from here.** `glib`
  0.18 reaches Swarm only on Linux, through Tauri's GTK3 stack (`gtk` 0.18 ←
  `tao`, `muda`, `tauri`). The fix is in `glib` 0.20, which needs GTK4, and no
  Tauri 2 release uses it. The unsound API (`VariantStrIter`) is not called by
  Swarm. Tell me whether to dismiss the alert as tolerable risk. I have not
  dismissed it.
- **Cargo did not build here.** There is no MSVC linker on this machine, so
  `cargo clippy` and `cargo test` did not run for either crate. The same
  rustls bump passed CI's `rust` job on #8. CI on this PR is the real check.
- **What I did not test:** a mermaid 12 diagram rendering in the running app.
  `DiagramView` calls only `initialize` and `render`, and `tsc` accepts both
  against 12's types, but nobody has looked at a drawn diagram.

**2026-10-29 — Extensions, Round 1.**

- **Swarm's cargo gates ran, in WSL, for the first time on this machine.**
  GTK, WebKit and libsoup were unpacked into `~/sysroot` without root, from
  `apt-get download` with a private package index, and pkg-config was pointed
  at it. `cargo clippy --all-targets -- -D warnings` is clean. `cargo test`:
  867 pass and 5 fail, and all 5 fail because WSL's git (2.34) has no
  `merge-tree --write-tree`, which needs 2.38. Unchanged `main`, built the
  same way, fails the same 5 (832 pass), so they are the machine and not this
  round. Cells' clippy is clean and its 97 tests pass. CI's git is newer.
- **"This repository" will not read until this merges.** The default source is
  `main`'s `swarm-extensions.json`, which does not exist on `main` yet. Until
  the merge, Read on the default URL answers 404, and installing on a new
  Swarm has nowhere to come from. The live fetch test is `#[ignore]`d for that
  reason and has not been run.
- **Round 2 and Round 3 are outlined, not approved.** Code from a URL, a
  sandboxed frame for Hives, the permissions prompt and Cells from other
  people each need your approval before they start.
- **What I did not test:** the app running. A new Swarm opening on Chat and
  Admin, the Extensions screen, and an install changing the rail are proved by
  component tests with a mocked backend, not by pressing them. A real fetch from
  GitHub was not tested either.

**2026-10-29 — the framework brought up to date, and every spec re-translated.**

- **Cells' solution spec is not translated.** Its brief is `status: drafted`.
  A person sets it to `filled` first.
- **`Swarm/importProject.md` is not translated.** It is `drafted` too, and it
  never had a spec.
- **Four specs have no brief:** `Cells/cells.md`, `Hives/hives.md`,
  `Hives/extensions.md` and `Swarm/developerWorkspace.md`. They are left as
  they were. `spec-lint` skips them, because they have no front matter.
- **`spec-lint` fails.** 62 checks in built specs have no test naming them
  (`<item>#C<n>`). Tagging the existing tests is its own piece of work.
- **The open questions are written as `UNKNOWN` lines.** `node
  tools/spec-lint.mjs` lists all 21. The ones that need a person most:
  - Who deploys production: the brief says the AI, the solution specs say people.
  - Are the deliverables and testing answers, still marked drafted, accepted?
  - Is it intended that the cheap and mid-range tiers are both Claude Sonnet 5?
  - The briefs name the CooperativeAICoding repository, but the code is here.
  - `developerArea` and `productPlanning`: their answers still describe the
    first build, not the page as it now is.
  - `marketingDesign` has no front matter (status, deliverable, depends-on).
  - `mcpServer`: is the call log kept in the database or only in memory?
- **AGENTS.md and GEMINI.md were not regenerated.** Only the one wrong line
  changed. `/emit-guardrails` now builds from `Project_digest.md`.

**2026-10-30 — CI's Rust job.**

- **The cargo gates were not run on this machine.** It has no MSVC linker,
  so cargo cannot build. CI's Rust job is the check.

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


**2026-10-07 — developers start their own projects**

- **A developer cannot fill in their project's brief.** The Product questions
  (purpose, problem, users) are edited in Product → Strategy, which the
  Developer role cannot see. A project made in Develop keeps empty answers until
  someone with Product access fills them in, and anything that reads those
  answers (generation, briefs) gets nothing.

- **No framework-file scaffold from Develop.** The Product tab's form can
  scaffold a Product's framework files into a folder when it creates one. The
  Develop form does not offer that, so a developer's project has no scaffolded
  files unless someone generates them afterwards.

- **Two Product-creation forms.** `ProductPlanning` and `NewProjectForm` both
  call `createProduct`. They differ on purpose: questions and scaffold, versus a
  name only. A third would trip the DRY rule and should become one shared form.
**2026-10-07**

- **The ceiling is 106 and the right number is 0.** One hundred and six surfaces
  in this app have nothing written about them anywhere. The check now says so
  honestly rather than blurring them with 123 that were already explained, but
  the explanations still have to be written, and 106 of them is somebody's week.
  Each is its own small work item: what the command is for, and why it is the
  way it is.

- **`EXPLANATION_MIN` is a constant, not a setting.** A project installing this
  via `npx` inherits 80 characters whether or not it suits their house style.
  Making it configurable means deciding where per-project lint configuration
  lives, which does not exist yet — so it is hard-coded with its reasoning
  beside it.

- **The surface list is still only Tauri commands and database tables.** An HTTP
  endpoint, a CLI subcommand and a React route are all surfaces by the same
  argument, and none of them is detected. Adding each is a row in `SURFACES`,
  but choosing which ones count is a judgement about what a build could rebuild
  by accident, so I did not decide it alone.

- **A pointer can still drift, just more slowly.** The 2 KB ceiling catches a
  procedure being copied back into a tool's folder; it cannot catch a single
  sentence of behaviour added to a pointer. Two of the commands were at 2,008
  and 2,017 bytes before I converted them — one sentence from failing — and they
  were that size precisely because they had been restating their procedures.
  Nothing stops that recurring except the ceiling and somebody reading diffs.

- **`AGENTS.md` is written once and never reconciled.** `init` writes the
  starter, `/emit-guardrails` replaces it from the spec, and in between nothing
  notices if a person edits the generated copy by hand — their edits are lost on
  the next run, silently, because the header says it is safe to overwrite. The
  alternative was a protected file that goes stale instead. Both are wrong in
  different directions and the choice was made deliberately.

- **The procedures are reachable, not enforced.** Any agent can be pointed at
  `ai-only/procedures/build.md`; nothing checks that it read it, and no check
  can. The approval gate is the only part that does not depend on the model
  cooperating, which is why every emitted file now says so plainly instead of
  implying the framework carries over whole.

- **The checks in `tools/` are copies and will drift.** A fix to a check in
  CooperativeAICoding reaches this repository only when somebody copies it
  again, and nothing says when that is due. Every project `init` creates has
  the same gap; this is the first one where the framework is actively changing
  underneath it.

- **While releases are held, nothing builds main after a merge.** `ci.yml`
  runs on pull requests only, on the grounds that the release build covers
  main; with the release trigger off, a direct push to main is checked by
  nothing until the rename turns the trigger back on.

- **A machine that ran CoperativeAI keeps what it made.** The renamed app
  creates its own WSL distribution (`swarm`), agent image, SSH key
  (`id_ed25519_swarm`), credential entries and data folder, and leaves the old
  ones where they are. On a developer machine that means a `coperativeai` WSL
  distribution, an `id_ed25519_coperativeai` key registered with GitHub, and a
  `com.coperativeai.app` data folder, all still present and now unused.
  Removing them is a person's call, because removing a distribution or a key
  cannot be undone.

- **Folders written into users' repositories changed name.** `.CoperativeAI/`
  and `.coperativeai/` are now `.Swarm/` and `.swarm/`. A repository the old
  app already wrote into keeps its old folder, which Swarm will not read.

- **A Project cannot be taken back.** Once sent it is in the Product area for
  good; there is no "send back to Develop", and `hand_over` refuses a second
  press rather than undoing the first. Nobody asked for the reverse, so it was
  not built — but a Project sent by mistake has no way home.

- **Admin still lists every Product without saying where it is.** It shows
  un-sent Develop and QA Projects alongside Product's own with no marker, so
  somebody tidying Products in Admin cannot tell which ones Product has never
  seen.

- **Nothing says why Send to Product is missing on the other area's
  Project.** Develop and Test both list every Product, and the button simply
  does not appear on a Project the other area made. That was the decision, but
  nothing on screen says why the button is missing.

- **Cells still carries Swarm's names (2026-10-27, Cells Round A).** The
  distribution it creates is `swarm`, the agent image and the policy file
  (`.swarm/policy.json`) are Swarm's, and the panels' wording says "this app".
  Cells is a separate folder but not yet usable by a second host. Making those
  names the host's choice is a round of its own, if anyone wants a second host.

- **Cells is built twice in CI.** It is its own crate with its own lockfile and
  target folder, so CI compiles tokio, reqwest and the rest once for Swarm and
  again for Cells' own tests. The two lockfiles also have to be kept in step by
  hand: Cells' started as a copy of Swarm's. A Cargo workspace would fix both,
  at the cost of moving where Swarm's lockfile and target live.

- **The panels borrow Swarm's `node_modules`.** Cells has no `package.json`, so
  Swarm's tsconfig points four packages (`react`, `@testing-library/*`,
  `vitest`) at its own `node_modules`, and Vite dedupes them. A new package
  imported by a Cells panel needs a line in both places, or it fails to resolve
  with an error that does not say why.

- **AGENTS.md was edited by hand again.** Its header says to edit the brief and
  run `/emit-guardrails`. The Project Brief and Project Digest now carry the
  Cells lines too, so a regeneration should keep them, but that has not been
  run to prove it.

**2026-10-27 — the Linux release build keeps its lockfile.**

- **npm and Cargo can still drift apart.** Keeping the lockfile fixes today's
  failure, but `package.json` allows `@tauri-apps/api ^2.9.0` and
  `plugin-dialog ^2.7.1`, while `tauri` is pinned in Cargo.toml. The first
  lockfile refresh that takes the npm side to a new minor version, from
  Dependabot or anyone else, breaks `tauri build` on **both** platforms.
  Pinning the npm packages to `~2.11` / `~2.7`, or bumping both sides together,
  would stop that. That changes production dependencies, so it was left alone.

- **A release can be dropped when several merges land close together.** The
  `concurrency` comment in `release.yml` says a queued run "still happens".
  GitHub keeps only one pending run per group, though, so a third arrival
  cancels the waiting one. That is what happened to the PR #11 merge
  (run 40537606714). Its code shipped in the next run's build, but the commit
  never got a release of its own. At minimum the comment is wrong.

- **The round-record check fails every Dependabot PR.** A lockfile-only bump
  under `app/` has no record, so PRs #8 and #9 are red on `documents`. Whether
  to exempt `dependabot[bot]`, exempt lockfile-only changes, or keep the check
  strict is a policy call.

- **`actions/download-artifact@v6` runs on Node 20**, which the runners have
  deprecated and currently force onto Node 24 (annotation on the trial run's
  `publish` job). It works until that shim is withdrawn. This is the same
  situation `upload-artifact` was moved off v4 for.

- **`ubuntu-latest` is moving to Ubuntu 26.** Every ubuntu job carries the
  migration notice. The Linux job's `apt` package list (webkit2gtk 4.1 and the
  rest) is the part most likely to break, and nothing has been tried against 26.

**2026-10-27 — Hives**

- **Hives and Swarm depend on each other.** Swarm imports `@hives/registry`
  and the Hives import Swarm's components and backend through `@swarm`. So
  `app/Hives` is a separate folder but not a separate module: unlike Cells, it
  could not be lifted into another host. Making it one would mean giving each
  Hive its backend through an interface, as Cells' panels take theirs.

- **Two copies of the Product AI policy check remain.** The chat uses the new
  shared `ai_run::product_policy_gate`, but `design::generate_design_strategy`
  and `architecture::generate_architecture_doc` still carry their own copies.
  I did not switch them over: they cannot be compiled here, and they are
  working code. Each switch is about twenty lines replaced by one call.

- **The chat forgets, and so does the AI.** The conversation lives in memory,
  so it is gone on restart. The outcome of an action ("Opened Develop", "Not
  done") is not sent back to the AI on the next turn, so it cannot tell
  whether what it asked for happened.

- **The old area columns are still on `roles`.** `canProduct`, `canDevelop`
  and `canTest` are copied into `role_hives` once and then unread.
  `update_role` writes their old values back unchanged. They can be dropped
  once nobody needs to roll back to a build that reads them.

- **A grant can outlive its Hive.** The backend checks a Hive id's shape, not
  that the registry has it, since the registry is frontend code. A Hive
  removed from the registry leaves its `role_hives` rows behind. Deleting a
  role clears its grants in the command, after the role is gone, not in one
  transaction.

- **The chat's actions are checked on screen, not enforced.** The role check
  and the confirmation both run in the frontend. That matches "roles are not
  an access-control boundary", but an AI action is only as governed as the
  screen that runs it. Enforcing it belongs to the Agent governance
  deliverable (the MCP server as the enforcement layer).

- **The WSL test harness is not in the repository.** The scratch crate that
  compiled the role and chat modules without Tauri lives in a temporary
  folder. A Cargo feature that builds the `db` and pure `ai` modules without
  Tauri would let anyone run those tests on a machine that cannot build the
  app.

**2026-10-27 — the Dependabot security alerts**

- **Every Dependabot PR will still fail `documents`.** This round went around
  the round-record check instead of settling it. The policy call recorded
  above is still open: exempt `dependabot[bot]`, exempt lockfile-only
  changes, or keep the check strict and fold each bump into a person's PR as
  this one does.

- **Mermaid is a major version ahead of where it was.** Only a security fix
  moved it to 12, and nothing checked its release notes against how Swarm
  uses it beyond the type check. A look at a few stored diagrams in the
  running app would close this.

**2026-10-29 — Extensions, Round 1**

- **`ActivePermissions.allHives` is now always false.** The backend's `hives`
  is the whole answer, because only installed Hives can open, and "sees every
  Hive" stopped being true for Admin. The field was kept because the
  frontend's loading default (`FULL_ACCESS`) and `canAccessHive` read it. A
  side effect: until the permissions load, a new Swarm briefly draws every
  Hive on the rail. Removing the field and starting the frontend at "nothing
  open" would make the two agree.

- **The sandbox picker still offers cells that are not installed.** The
  Admin → AI table (`SandboxTable`, in Cells) lists `wsl` and `docker` from
  `SANDBOXES` and the machine's state. Choosing an uninstalled one is refused
  with a message naming Admin → Extensions, but the option is still drawn.
  Greying it out needs the installed list passed into Cells' panel, which is
  a change to Cells' interface (`CellsBackend`).

- **Only `prepare_run` checks for an installed cell.** It is the agent-run
  path, and "start all" goes through it. Anything that starts an agent another
  way (a future command, or a terminal running `claude` by hand) is not held to
  the rule. The MCP server, once built, is where that should be enforced
  rather than requested.

- **Extensions have no update.** Installing again records the newer version
  and source, but the code is whatever this build contains, so a version
  number means nothing until Round 2 downloads code. Until then, the version
  Admin shows is the publisher's claim, not what is running.

- **The live fetch test has not run.** `reads_this_repositorys_file` is
  `#[ignore]`d and can only pass once `swarm-extensions.json` is on `main`.
  Running it once after the merge closes this.

- **WSL's git cannot run five of Swarm's tests.** Anybody using the WSL route
  above for the cargo gates gets five `merge-tree` failures that CI does not.
  Either the tests skip when git is older than 2.38, or the WSL route gets a
  newer git. The skip already exists for "git is not usable here"; it could
  check the version too.

**2026-10-29 — the framework brought up to date, and every spec re-translated**

- **A change round in a page brief cannot be cited.** `spec-lint` resolves a
  source only to a `### id —` question, and a page brief's change rounds sit
  under `## Part 4 — changes-over-time`. So what a round adds beyond the
  answers cannot enter the checked part of a spec. Every page spec says so in
  a note. The fix is the framework's (give rounds an ID) or the briefs' (fold
  each round into the answers it changes).

- **Some brief answers describe a page that no longer exists.** `developerArea`
  still describes a team list, though the team moved to Admin.
  `productPlanning` still describes a repository board, though the Product
  side dropped repositories. Each is an `UNKNOWN`, but the brief is what needs
  rewriting.

- **The framework's `update` cannot handle Swarm's layout.** It expects
  `Project_brief.md` and `tools/` in one folder, and Swarm splits them between
  `application/` and the repository root. No `.coperativeai.json` was written,
  so the next update will treat every copied file as edited.

- **The agent commands were not installed.** `.claude/commands/` and its
  siblings point at `ai-only/procedures/…` from the project root, which here
  is `application/`, not the repository root. Copying them as they are would
  give commands that point at nothing.

- **`spec-lint` is not in CI.** Neither is `check.mjs`. Adding either now would
  fail every PR until the tests are tagged.

- **The old specs are kept whole beneath the new ones.** That keeps every round
  report and test status. It also keeps old statements the new spec replaces,
  and an agent that reads past `## Round history` could follow them. Trimming
  them is a person's decision.

- **The model specs have no checks.** The database-model form has no `tests`
  question, so the 21 Swarmdb specs have nothing for `spec-lint` to trace.

- **`brief-lint` now notes a missing sign-off on all 40 briefs.** `qa/` exists,
  and no brief has a sign-off yet. It also miscounts Swarm's rounds:
  `developerArea` reads as round 112 and `agentSandbox` as round 20. These are
  notes, not failures.

- **`qa/regression.md` and `qa/signoff.md` are blank forms**, with the form's
  placeholder rows. Nobody has said how they relate to the existing
  `Manual_check.md`.

**2026-10-30 — CI's Rust job.**

- **Three `dead_code` allows wait on Install.** When the second half of
  Extensions Round 2 step 3 wires download and storage into Install, remove
  the allows on `extensions::approval_matches`, `fetch::read_code` and the
  `store` module, or clippy will not notice if any of them stops being used.
