# Page Spec — QA Test Designer

> Produced by `/translate` from [`../../CoperativeAI/qaTestDesigner.md`](../../CoperativeAI/qaTestDesigner.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
The Test environment's main page: QA designs plain-English test scenarios around work items, and the AI implements them as real tests — within each item's AI policy.

**Model & effort**
Mid-range tier (Claude Sonnet 5), medium effort.

**Depends on**
- `CoperativeAI/workItemPolicy.md`

**Actions**

| User | Can do |
|------|--------|
| QA | Pick a work item and see its scenarios. |
| QA | Add a plain-English scenario (given/when/then welcome, not required). |
| QA | Edit or remove a scenario. |
| QA | Ask the AI to implement a scenario — only if the item's policy allows generating tests. |
| QA | See which scenarios are designed vs. implemented. |

**Information shown / collected**
- Scenarios per item: description, state (designed / implemented), implemented test's file path.

**Data to store**

| Item | What it looks like |
|------|--------------------|
| Scenarios | Work items of type `test` linked via `parentItemId` — or a dedicated model if too thin; decide at build time and record it (per the brief). |

**Access & security**
No login (project security model). AI implementation goes through the single policy-checked AI call path (deny-by-default).

**Tests**
- [ ] Added scenario saves and survives restart.
- [ ] "Implement" is blocked when the policy denies generating tests.
- [ ] Implemented scenario shows its test file's location.

**Open questions**
- Scenario storage: reuse WorkItem (type `test`, parentItemId) vs. a dedicated model — flagged by the brief for a build-time decision.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| AI-implemented tests | Turning scenarios into real test files. | Send scenario + item context through the policy-gated call path; write the returned test to the repository; record its path. | Yes. |

---

## PLAN

**Summary:** Build the Test environment: scenario list per work item (stored as child work items of type `test`), and an "implement with AI" action routed through the policy gate.

**Changes:**
- Reuse WorkItem commands for scenario CRUD (type `test`, parentItemId set); add state + test-file-path fields' handling.
- Test environment page: item picker, scenario list with designed/implemented states.
- cargo tests: policy-denied implementation is blocked; Vitest for the page.

**Expected technical debt:** if scenarios outgrow the WorkItem shape (steps, expected results), promote to a dedicated model in a later round.

**Status:** built (2026-07-18) — round 2

---

## Round 2 — Testing Strategy + tests associated with Deliverables or Work Items

**Behaviour:** the Test tab is now a real environment. Pick a Product and you get a **Testing Strategy** section (test plans, test environments, required tooling, links to test cases / automated suites) and a **Test Cases** list. Each test case is a plain-English scenario that can be **associated with a Deliverable or a Work Item** — or with neither, so a test can be written before the work that satisfies it exists.

**Storage decision (the brief's open question, now closed):** scenarios get their **own `TestCase` model**, not work items of type `test`. The brief left this to build time; a dedicated model won because a scenario now needs to point at *either* a Deliverable *or* a Work Item, and `parentItemId` can only express the second. See [`../CoperativeAIdb/TestCase-model.md`](../CoperativeAIdb/TestCase-model.md).

**Implemented:**
- `db/test_case.rs` — id, productId, title, scenario, state (`designed` | `implemented`), testPath, deliverableId, workItemId. Association targets are validated when supplied, so a case never points at a row that does not exist.
- `commands/test_cases.rs` — list / create / update / delete with `TestCaseDto`.
- `pages/TestArea.tsx` — Product picker → `StrategyEditor` (area `test`, `TEST_STRATEGY_FIELDS`) + `TestCases`; wired into `WorkspaceShell` so the Test tab renders it instead of the placeholder.
- `components/TestCases.tsx` — add form and per-case controls: one association picker spanning both kinds (`d:<id>` / `w:<id>`), a state picker, and a test-file field that appears once a case is marked implemented. Adding a case updates the list immediately (optimistic insert, rolled back on error), the same pattern as the Planning board.

Deleting a Deliverable or a Work Item now **unlinks** its test cases rather than leaving a dangling id — `deliverable::delete` already did this for work items, so test cases were made to match, and `work_item::delete` gained the same for its own cases. The test keeps existing; only the association goes.

**Tests:** cargo 93/93 (test-case defaults to `designed` with no path; title and Product required; association with a deliverable *or* a work item; associations must reference rows that exist; deleting an association target unlinks the case without deleting it; marking implemented records the path; update rejects a bad state, empty title, or unknown id; delete removes only that case). Vitest 57/57 (strategy fields present, cases listed with their association, add-with-deliverable, re-associate an existing case, marking implemented reveals the test-file field, no-Products hint). `npm run build` and a full `cargo build` clean.

**Update (round 3 of the governance plan):** the **"I can't implement this" channel** this brief's AI action would need now exists — `db/ai_feedback.rs` plus the `blocked` branch in every generation schema. When the implement-a-scenario action is built it should decline through that channel rather than guessing at a thin scenario.

**Technical debt:**
- **The AI "implement this scenario" action is not built.** This round delivers the design surface and the association model; the policy-gated call that writes a real test file is still open, so `state` and `testPath` are set by hand today. The original page-skill and the policy-denied test remain outstanding.
- **A case can be associated with only one thing at a time** in the UI (one picker over both kinds). The table technically allows both `deliverableId` and `workItemId` to be set at once — nothing enforces exclusivity at the DB level.
- **`testPath` is a free-text string** — not checked against the filesystem or the linked repository.
- Test cases are **not scoped by role** yet; the Admin field-visibility gate covers the cost/profit fields only.

---

## Round 3 — the AI implements a scenario

### My Feedback

**It is still the tripod, and this was the leg AI never joined.** The brief asked
for it in round 1, round 2 built everything around it, and `allowGenerateTests`
has been a column with a gate and no caller ever since — a door with no room
behind it. This round is the room.

**Strict, deliberately.** The policy that decides whether AI may touch a piece of
work belongs to a *work item*, so a scenario with no work item has nobody to ask
— and deny-by-default means "nobody to ask" is a refusal, not a waiver. The
looser reading was available: let a Deliverable-linked case borrow the Product
policy, the way deliverable planning does. It was rejected on the grounds that
it would let AI write tests for work nobody has planned yet, and QA associating
a case with its work item is a smaller ask than that is a risk.

**Reading and editing are not permission to write a test.** That sentence is now
a test, and it is the one the brief has been carrying unticked since round 1.

**The repository context is three lines, not a file tree.** `test_runner::detect`
already knows which suites a Solution has, where they are, and how they run —
which is exactly what decides whether a generated test can even be executed. A
file tree would cost tokens on every press to say less.

**The write is the last thing that can fail.** It happens before the case is
marked implemented, so a path the containment rule refuses leaves the scenario
exactly as it was, rather than pointing at a file that was never written.

### Implemented

- `commands/test_cases.rs` — `resolve_test_implementation` (the gate, unit
  testable without a credential store or a network) and `implement_test_case`
  (the command). The gate reuses `work_items::resolve_item_ai_gate` for provider
  and effort, then `work_item_policy::is_allowed(…, AiUse::GenerateTests, …)`
  for the use-specific flag — the first caller that column has ever had.
- `ai/client.rs` — `TestDraft`, `GeneratedTest`, `TestPrompt`,
  `build_test_prompt`, `parse_test`, `generate_test`. `blocked` beats a body,
  the same reading `parse_generation` takes.
- `ai/ollama.rs` (`generate_test` + `test_schema`), `ai/claude_code.rs`
  (`generate_test`), `ai/backend.rs` (dispatch) — the shape the other six
  generation kinds already use, so a budget handover mid-scenario works.
- `files/workspace.rs` — `write_new_file`, reusing `place_for_new`'s containment
  rules. An AI-chosen path is an untrusted string: absolute, `..`, under `.git`,
  into a folder that does not exist, or over a file that already does, are all
  refused. One step rather than `create_file` + `write_file`, which would leave
  an empty file behind if the write failed.
- `db/ai_usage.rs` — the `testImplementation` purpose, so the Test area's spend
  is legible beside Product's and Develop's rather than buried.
- `lib/backend.ts` — `implementTestCase` + `TestImplementationResult`.
- `components/testing/TestCases.tsx` — **Implement with AI** on designed cases,
  disabled *with its reason* when the case has no work item; the written path
  shown on success; the AI's question shown on a decline, which leaves the case
  designed. The manual state and path controls stay — a hand-written test is
  still recordable.

A decline records against the work item through `ai_feedback::record` with kind
`needsInformation`, the channel the governance round built and this one is the
first to use for a test.

### Tests

cargo 661/661 (23 ignored, live-only), Vitest 589/589, `tsc --noEmit`,
`npm run build` and clippy `-D warnings` clean.

Ten new Rust tests and four new Vitest ones, written failing first:

- A scenario with no work item, and one linked only to a Deliverable, are both
  refused — the strict rule.
- A work item with no policy refuses deny-by-default.
- **Reading and editing are not permission to write a test** (the brief's
  outstanding test), and the same policy with the one flag on goes through.
- No Solution, and a Solution with no working copy, are refused separately and
  by name.
- An already-implemented scenario is refused before a call is paid for.
- `parse_test`: a good reply parses; a decline beats a body; half an answer
  (empty path, blank contents, or either field missing) is an error rather than
  an empty file.
- The prompt carries the scenario, the work item, and the suite command.
- A generated test is written inside the working copy or not at all: `../`,
  `src/../../`, and `.git/hooks/` refused; a real write reads back; a second
  write over the same path refused.
- Vitest: the button disabled with its reason when unlinked; a success shows
  the path and the row reloads as implemented; a decline shows the question and
  leaves it designed; a backend refusal is shown rather than swallowed.

### Your Feedback

- **The strict rule was your call and it is the right one**, but it has a cost
  worth naming: QA cannot implement a test written before its work exists — the
  very case round 2 built the "associated with neither" state for. The path
  through is to associate it once the work item appears, which is a real step
  somebody has to take.
- **Nothing runs the test after writing it.** It is written and the scenario is
  marked implemented on the strength of the file existing, not on the strength
  of it passing — or, more usefully, failing for the right reason first. That is
  the next round, and it is a bigger one than this.
- Recommendation: `write_new_file` is now the only route a generated file has
  into a working copy. Anything else that writes generated code should use it
  rather than `emit::write_generated`, which joins a relative path onto a root
  and would follow `..` out of the repository.

### Technical Debt

- **The test is never run.** No red-then-green proof, no evidence it compiles.
  A scenario can be marked implemented against a test file that does not build.
  Wiring `test_runner::run` and reporting the result is the obvious next round.
- **A second press cannot regenerate.** `write_new_file` refuses to overwrite,
  so re-implementing means setting the case back to designed *and* deleting the
  file by hand. Deliberate — an existing test is somebody's work — but the app
  offers no way to do it.
- **One file only.** A scenario needing a fixture, a factory, or a helper beside
  the test cannot express it; the model must fit everything into one file or
  decline.
- **The suite list is one level deep**, inherited from `test_runner::detect`. A
  monorepo with tests three folders down gets "no test suite was found" and the
  model guesses at the convention.
- Carried from round 2, untouched: the DB allows `deliverableId` and
  `workItemId` to be set at once; `testPath` is still free text when typed by
  hand; test cases are not scoped by role.

---

## Round 4 — the rule of three, applied

### My Feedback

**"Do the rule of three."** The check found four shapes past it, all seven or
eight copies deep, all pre-dating round 3 — and round 3 had added copy seven or
eight to three of them without looking. Two of the findings were defects in
round 3 itself and were fixed first.

**"Are we making components reusable?"** asked mid-build, and it changed the
fourth extraction. The plan said a `blockedNotice(blocked, what)` helper
returning a string — a drop-in for the five panels that push a sentence into a
`notice` state. That would have removed the duplication and left the UI as six
bare sentences. A component was the better answer, and asking the question is
what got it.

**Duplication that has already drifted is not a style question.** Two of the
four had produced real divergence: five of seven Ollama schemas had lost
`required` from their `blocked` branch, and three of six panels had lost the
guard on an empty `whatIsNeeded`, so a decline with no question showed a
dangling sentence. That is the argument for extracting, not tidiness.

### Implemented

**Fixes to round 3, first:**
- Removed an unreachable provider re-check in `resolve_test_implementation` —
  `resolve_item_ai_gate` already validates it, and has a test for it.
- `client::generate_test` was borrowing `ollama::test_schema()`, the only
  Claude-side generation not defining its own via `blocked_schema()`. It now
  has `client::test_schema`, like its six siblings.

**The four extractions:**
1. `client::blocked_in` and `client::json_of` — the 19-line refusal preamble and
   the JSON decode above it, both copied into all seven parsers. "Blocked wins
   over work" and "an empty reason is not a refusal" now live in one place.
2. `ollama::blocked_schema` — one copy of the escape-hatch schema, closing the
   `required` drift across five of seven. Deliberately *not* identical to the
   Claude one, which also sets `additionalProperties: false`: that has never
   been tried against a local model, so tightening it is its own decision.
3. `ai_run::record_failure` + `ai_run::Call` — the refusal-vs-error rule was
   written out at seven call sites. `Call` groups the invariant half because
   clippy caught the extracted function at eight arguments, and two of those
   were both `i64` (`product_id`, `latency_ms`) — swap them and the spend files
   against a Product that never made the call, silently. Same reasoning as
   `TestCaseUpdate`.
4. `components/ai/BlockedNote` + `components/ai/Notice` — one component for the
   AI declining, used by all eight sites.

**On `Notice`, and why it is a union rather than a second state.** The obvious
way to give a panel a decline is a `blocked` state beside its `notice` string —
and then every panel must remember to clear the one it is not setting. Forget
once and a stale question sits under a successful run, claiming a refusal that
did not happen. One slot holding either shape makes that unrepresentable.

`BlockedNote` is `role="status"`, not the `role="note"` round 3 used: it appears
after an async action, and `status` is a live region, so a screen reader
announces the question rather than leaving it unread. The existing PlanningBoard
and ProductStrategy tests were already asserting `status` — they were right and
round 3 was wrong.

`answerOn` exists because the planning board is genuinely different: its
question is stored on the card and rendered there by `AiQuestions`, so repeating
`whatIsNeeded` in the notice would say the same thing twice.

**Left alone, deliberately:** `backend.rs`'s seven-arm dispatch (each arm has a
different signature — collapsing it needs a macro, which the project's
`coding-guidelines` skill says to avoid, or boxed futures, which read worse);
the seven `generate_*` functions in `ollama.rs` and `claude_code.rs` (already
one-line adapters over `chat` and `turn`); and `AiQuestions` / `QuestionsPanel`,
which render stored `AiFeedback` with an answer box — a different type doing a
different job, and merging them into `BlockedNote` would be forcing unrelated
things together.

### Tests

cargo 661/661 (23 ignored), Vitest 595/595, `tsc --noEmit`, `npm run build` and
clippy `-D warnings` clean.

Six new Vitest tests on `BlockedNote` / `Notice`, covering behaviour that had
never been tested anywhere: the lead-in wording, that it is never an `alert`,
**the empty-`whatIsNeeded` guard three panels were missing**, the `answerOn`
branch, a plain sentence passing through, and the stale-decline case the union
exists to prevent.

One existing assertion changed: `WorkItemBuildPlan` pinned "Stopped rather than
inventing the rest", which is now "The AI stopped rather than inventing the
rest" — the same behaviour under one wording instead of six.

### Your Feedback

- **`CodeWindow` lost a word.** It said "The pal stopped rather than guessing";
  it now says "The AI". The pal is a named thing in this app, and that is a
  small loss traded for one wording everywhere. If the persona matters, the
  component wants a `who` prop — worth a minute's thought, not worth guessing.
- **The frontend was the thinnest-covered of the four**, which is why it went
  last and why the component got its own tests rather than relying on the
  panels'. Only one existing test needed changing, which is a better result
  than expected for eight call sites.
- Recommendation: `Notice` is the shape any panel with an AI action should use
  from now on. A panel that adds a `blocked` state beside a `notice` string is
  re-introducing the bug the union removes.

### Technical Debt

- **`additionalProperties: false` is still only on the Claude schemas.** The
  Ollama seven now agree with each other, but not with the Anthropic side. One
  local model in front of it would settle whether they can.
- **`ai_run::Call` covers only the failure branch.** The `ok` and `declined`
  branches still write out `&conn, product_id, work_item_id, &routed.provider,
  &routed.model, PURPOSE, …` at seven sites each — the same duplication, one
  step further in. `Call` was built to take them too; wiring it is the next
  small pass.
- **The lead-in sentence now has two homes, not one.** `AiQuestions` renders
  stored `AiFeedback` and opens with the same "The AI stopped rather than
  guessing:" line that `BlockedNote` owns. It was left out of the extraction on
  purpose — different type, and it carries an answer box and a resolve action —
  but that means the wording can drift between the two. **Two copies is under
  the rule of three**, which is the rule this round was asked to apply, so it
  stays; a third is the trigger.
- Round 3's debt is unchanged: nothing runs the generated test, no
  regeneration, one file per scenario, suite detection one level deep.

---

## Round 5 — finishing `Call`

### My Feedback

**A half-applied abstraction is its own smell.** Round 4 extracted the failure
branch and left `ok` and `declined` writing out `&conn, product_id,
work_item_id, &routed.provider, &routed.model, PURPOSE, …` at eight sites each —
recorded as debt, and debt of exactly the kind that never gets paid because the
code now *looks* factored. `Call` was built to take all three branches; this
wires the other two.

**The clean-up found an eighth failure branch the first survey missed.**
`strategies.rs` recorded every failed solution-strategy call as `"error"`,
hardcoded — it never classified, so it was invisible to a grep for
`e.contains("refusal")`. A model refusing a strategy was filed as a broken call,
indistinguishable in the log from a bad key or a dropped connection. Going
through the shared recorder fixes it as a side effect of removing the copy.

**The unused imports were the proof.** Deleting the last hand-built ledger row
left `Exchange` unused in six command modules. That is the abstraction being
complete rather than merely present: those files no longer know how a ledger row
is assembled.

### Implemented

- `ai_run::record_ok` and `ai_run::record_declined`, both taking `Call`.
  `record_declined` owns the `"Declined: {reason}\n{what_is_needed}"` line that
  all eight sites had spelled out, and the doc comment on it carries the
  `declined` vs `blocked` distinction — the model ran and was paid for, so
  filing it as `blocked` would understate the bill.
- Sixteen call sites converted across `architecture`, `design`, `strategies`,
  `workspace`, `work_item_plans`, `work_items` (×2) and `test_cases`.
- `strategies.rs`'s failure branch now classifies like the other seven.
- `Exchange` and `asked` imports removed from six modules that no longer need
  them.

**Left alone:** `models.rs`. Model validation runs *before* routing, so it has
no `Routed` and no single prompt — it folds several probes into one ledger row.
It cannot use `Call` without inventing a fake one, and it is a single site.

### Tests

cargo 661/661 (23 ignored), clippy `-D warnings` clean. No new tests: this
round moved existing behaviour behind a function the suite already exercises
through every generation command. The one behaviour change — `strategies.rs`
classifying refusals — is covered by the same ledger assertions as its seven
siblings.

### Your Feedback

- **One behaviour change, stated plainly:** a refused solution-strategy call is
  now recorded as `refusal` rather than `error`. That is a correction, but it
  means historical rows and new rows disagree about the same event. Nothing
  reads that field for anything but display, so no migration — worth knowing if
  the AI log ever grows a filter.
- **Every `ai_run::record` call site outside `ai_run` itself is now gone**
  except `models.rs`, which cannot use it. The ledger's shape is owned by one
  module, which is what it should have been before the second generation kind.

### Technical Debt

- **`models.rs` still writes a ledger row by hand.** One site, justified above,
  but it means `Exchange` and the outcome strings still have a second author.
- Rounds 3 and 4 debt unchanged: nothing runs the generated test; no
  regeneration; one file per scenario; suite detection one level deep;
  `additionalProperties: false` still Claude-only; the decline lead-in sentence
  lives in both `BlockedNote` and `AiQuestions` (two copies — under the rule of
  three, so it stays until a third appears).

---

## Round 6 — running the test, and what the result means

### My Feedback

**"Fold in the test names, cargo is what I use."** That was the right call and it
changed the shape of the round. Names buy two different things, and only one of
them was in the plan:

- **Narrowing** — running less. Path works for vitest, jest and pytest; cargo
  takes a *name* substring instead, so it narrows only when exactly one name was
  recorded (libtest accepts one filter, and two names cannot honestly be
  expressed as one).
- **Attribution** — deciding whose result this is. This is the one that matters
  for cargo, and it works even when the whole suite runs: the recorded names are
  matched against what the runner reported, so a scenario on a repository whose
  suite is already red is not blamed for somebody else's failing test.

Without attribution, "cargo" meant "run everything and hope"; with it, a whole
`cargo test` still yields this scenario's own verdict.

**A red result is the expected one, and nothing here grades it.** The project's
rule is "write a failing test, then just enough code to pass it" — so a test for
work that is not built yet *should* fail. `readingOf` says so: failed reads as
"expected, if the work has not been built yet"; passed reads as "either the work
is done, or the test does not exercise it," because **nothing can tell those two
apart automatically** and picking the flattering one would be a lie about
exactly the case round 3's escape hatch exists to prevent. No ticks, no crosses,
no score — a left border tints and the words carry the meaning.

**Running is not an AI call.** No provider, no prompt, no spend, so no policy
gate and no ledger row. It runs code from a repository the app already runs
whole suites from; a gate here would imply a protection that does not exist.

**Matched by suffix, not equality.** Cargo reports
`commands::login::tests::a_wrong_password_is_rejected` where the generation
recorded the bare name. That is the same match `cargo test <filter>` performs,
so narrowing and attribution agree with each other by construction.

### Implemented

- `tooling/test_runner.rs` — `suite_for` (the **deepest** suite containing the
  file, by whole path segments, so a Tauri Solution does not run cargo over a
  `.tsx`), `narrowed` (path for vitest/jest/pytest, single name for cargo,
  `None` for the rest) and `outcome_for` (this scenario's verdict picked out of
  a whole-suite run).
- `db/test_case.rs` — `testNames`, `lastRunAt`, `lastRunOutcome`,
  `lastRunSummary`, added by `ALTER TABLE` because round 2's rows hold paths
  somebody typed. `RUN_OUTCOMES` is **deliberately separate from `STATES`**:
  running does not change whether a test exists, and folding them together
  would have the app claim a scenario regressed to "designed" because its test
  correctly failed. `set_implementation` and `record_run` are their own writers
  rather than passing through `update_case`, which would mean restating a title
  and scenario the caller did not change.
- `commands/test_cases.rs` — `resolve_scenario_place` (the case → work item →
  Solution → working copy walk, now shared by writing a test and running one
  rather than written twice), `resolve_test_run`, and `run_test_case`. The run
  goes through `spawn_blocking`: `test_runner::run` shells out and blocks until
  the runner exits, which on the async runtime's own thread would stall every
  other command for the duration.
- `commands/work_items.rs` — `title_of`, for callers that have an id and need
  the title the gate's messages use.
- `ai/client.rs`, `ai/ollama.rs` — `names` on the draft, both schemas, and the
  prompt asking for them *as the runner prints them*. Required in the schema so
  the model supplies them, tolerated empty by the parser so a model that omits
  them has still written a usable test — the same required-but-tolerated shape
  `blocked` uses.
- `components/testing/RunOutcome.tsx` + `readingOf`, and a **Run** button on
  implemented cases. The stored last run shows on arrival; a fresh run replaces
  it, because only the fresh one carries the output and the command.

### Tests

cargo 673/673 (23 ignored), Vitest 605/605, `tsc --noEmit`, `npm run build` and
clippy `-D warnings` clean. Twelve new Rust tests and ten new Vitest ones,
written failing first — including:

- The deepest suite owns the file, and `src-tauri2` is not inside `src-tauri`.
- Narrowing is relative to the **suite's** directory, not the Solution root —
  the bug that would otherwise have handed pytest `api/api/tests/test_login.py`.
- Cargo narrows on one name, not on two and not on a path; go, dotnet and npm
  are not narrowed at all.
- A scenario's verdict is found among a whole suite's, by suffix; one failing
  test of its two is a failure; nothing recorded means no attribution.
- The run columns record without touching `state`; a bad outcome is refused; a
  round-two table gains the columns and keeps its hand-typed rows.
- `readingOf` calls a failure expected, gives a pass both meanings, and lets the
  unattributed reading win over the outcome's own.

### Your Feedback

- **go, dotnet and npm are not narrowed, on purpose.** Each has a filter syntax
  this codebase has never run, and a wrong filter is the worst failure available
  here: it silently matches nothing, the runner exits zero, and the scenario is
  reported as passing. Attribution still works for them wherever their parser
  reports test names, so they lose speed, not honesty.
- **`spawn_blocking` is new here and the two older commands do not have it.**
  `run_solution_tests` and `run_test_suite` call `test_runner::run` directly on
  the async runtime. Same latent stall, older code — logged rather than changed
  under this round.
- Recommendation: the names are only as good as the model's guess at what its
  runner prints. When one does not match, the result silently becomes the whole
  suite's rather than wrong — which is the right failure direction, but it means
  a quietly unattributed scenario looks the same as a genuinely unnarrowable
  one. Worth a line in the UI if it turns out to happen often.

### Technical Debt

- **Nothing proves red-then-green as a pair.** A run is a single snapshot; the
  framework's rule is about a *sequence*, and the app cannot yet say "this
  failed before the work and passes after it". That needs run history, which
  this round deliberately does not keep — only the last outcome is stored.
- **No run history at all**, by the same decision: one row per case, overwritten.
  Full runner output is returned and shown but never stored, to keep an embedded
  database from filling with runner noise.
- **The older test-run commands still block the async runtime** (above).
- **A name the runner does not print silently degrades to a whole-suite verdict**
  (above).
- Carried: no regeneration of an implemented test; one file per scenario; suite
  detection one level deep; `additionalProperties: false` still Claude-only;
  `models.rs` writes its own ledger row; the decline lead-in lives in both
  `BlockedNote` and `AiQuestions`.
