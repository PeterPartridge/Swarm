# Page Spec — Developer Workspace

> Produced by `/translate` from [`../../CoperativeAI/developerArea.md`](../../CoperativeAI/developerArea.md) round 8. Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Open a Solution's working copy, read it, and review what has changed in it against the Developer Rules — so an agent's output is reviewed rather than merely accepted.

**Depends on**
- `CoperativeAIdb/Solution-model.json` (gains `localPath`), `CoperativeAIdb/DeveloperRules-model.json`

**Tests**
- [x] The tree skips generated directories, sorts predictably, and uses forward slashes everywhere (cargo).
- [x] **A path cannot escape the Solution's folder** — `..`, `..\..`, and absolute paths all refused (cargo).
- [x] A folder that is not a git repository says so rather than reporting no changes (cargo).
- [x] A forbidden technology **introduced** by a change is a violation (cargo).
- [x] **Removing** a forbidden technology is not (cargo).
- [x] Context lines are not the change's fault (cargo).
- [x] Missing tests are a notice, cleared by a test anywhere in the change set (cargo).
- [x] Test detection reads whole path segments — `src/latest/` is not a test (cargo).
- [x] Diff header lines are not counted as changed lines (cargo).
- [x] The panel asks for a working copy and explains a GitHub link is not one (Vitest).
- [x] A truncated tree says so (Vitest).
- [x] Violations and notices render separately (Vitest).
- [x] "No rules" is distinguished from "no problems" (Vitest).

**Status:** built — round 8 (2026-07-19), stages a and the review half of c

## Round 8 — Open the Solution, review the change

### My Feedback

The plan staged this a–e: read-only Solution box, Monaco editor, Claude Code orchestration with change review, in-editor coding pal, cross-repo view. **I built a and the review half of c, and skipped b.** The reason is in the plan's own debt list: R4b and R4d rebuild parts of Cursor and Claude Code, and the platform's value — the governance around them — is available from R4c *without* them. Doing the editor first would have spent the round on the least differentiated piece.

**A Solution had no local path.** It knew its GitHub URL and nothing about a checkout, so there was nothing for a workspace to open. `localPath` was added with `ALTER TABLE` on the rule this project settled on last round: drop what the app can rebuild, preserve what only a person could have written.

**The containment rule is the whole security story of `workspace.rs`,** so it lives in one function with its own tests. Relative paths arrive from the frontend, and a relative path is an untrusted string — `..\..\` walks out of a repository and into the rest of the disk. Root and target are both canonicalised, which resolves `..` *and follows symlinks*, and the target must still start with the root. A string prefix check alone would pass a symlink pointing anywhere.

**The review checks what a change adds, never what it removes.** A diff deleting the last jQuery mentions jQuery on every removed line, and flagging that reports the fix as the fault. This is the third time this project has hit the same shape of mistake — the first was a model flagged for writing "No Java or PHP anywhere" in obedience — so it is now tested from both directions: removals are innocent, and unchanged context lines are not this change's fault either.

**Missing tests are a notice, not a violation.** Plenty of legitimate changes have none: a config tweak, a rename, a comment. Blocking those is precisely how a check teaches people to ignore it.

**"No rules" is distinguished from "no problems".** Silence because a Product has no Developer Rules reads exactly like silence because everything passed, and the two mean opposite things.

### Your Feedback

- **The plan's R4c assumed the ledger could report the spend for an orchestration run. It cannot.** Claude Code is an external CLI billed against its own subscription or key; this app's ledger meters the API calls *it* makes. Showing "the spend for that run from the ledger" would be showing a number the app cannot see. That is why orchestration is not in this commit — the honest version needs designing, not just wiring.
- **Reviewing a git diff turned out to be the right unit of work, and it is more useful than the plan implied.** The plan framed change review as the back half of orchestration. It is not coupled to it at all: the check is about the diff, so it works on changes from Claude Code, another tool, or a person. Building it standalone made it available immediately and simpler.
- **A redundant heading was caught by a test as an ambiguous query.** `SolutionBox` rendered the Solution's name inside a list item that already named it. The fix was to delete the heading, not to make the query more specific — the test was right about the UI, not just about itself.

### Technical Debt

- ~~**No orchestration.**~~ **Built, in the shape the constraint allows** — see the round below. The app assembles and hands over; it does not spawn the agent and shows no cost for the run.
- **Review is read-only — there is no accept/reject.** The plan wanted per-file accept or reject; this shows the diff and the findings and leaves the acting to git. Accepting or rejecting a hunk means writing to a working copy, which this round deliberately does not do.
- **`unlistedTech` is declared in the finding types and never produced.** The rules check needs a declared technology list, which a diff does not carry — inferring it from source would be guesswork. The variant is there because the type is shared with the strategy path; nothing emits it here.
- **The diff is shown as plain text.** No syntax highlighting, no side-by-side, no per-hunk collapse. A large change is a wall.
- **Only the working copy is reviewed** — uncommitted changes against HEAD. There is no way to review a branch, a commit range, or a pull request.
- **The file tree caps at depth 6 and 2000 entries.** It says when it truncated, but a large monorepo will hit both and there is no way to navigate past the cap.
- **Not run in the real app.** Tauri UI cannot be exercised in a Vite preview. `workspace.rs` is covered by tests against real temporary directories; the panel is covered by mocked tests only.
- **Standing: the Claude path is unproven live**, four rounds running.

## Round 8c — The handover, designed around what cannot be measured

### My Feedback

The plan said change review would show *"the spend for that run from the ledger"*. It cannot, and that shaped the whole design.

Claude Code bills against its own subscription or key. This app's ledger meters the API calls **it** makes. A figure presented here as the cost of a run would be a number the app cannot see — and a fabricated cost, in a tool whose entire purpose is honest cost control, would be the worst possible thing to ship. So the app builds the half it genuinely owns and says plainly what it does not.

**What it owns is assembly**, and that turns out to be the valuable half. The brief gathers everything already known about a piece of work — description, the answers a person already gave to the AI's questions, the developer rules, the build strategy and the chosen architecture option, the Solution's diagrams, the planner's risk, and what other work is waiting on it — into one document written into the working copy.

That is where tokens are actually saved, and the reason is worth stating precisely: **the expensive failure in agent coding is not the token count.** It is an agent told too little, which builds the wrong thing and has to be paid for twice. Saying everything once, in order, is the fix.

Ordering is by what an agent needs first — the job, then the constraints, then the context. A brief opening with three pages of architecture buries the request underneath it.

Two details came from thinking about failure rather than the happy path:
- **A missing description is stated, not left as an empty heading.** An agent given only a title should know that is all there was, and a person reading the brief back should see the gap.
- **A chosen architecture option is marked settled** — "build that one; do not re-open the decision" — because re-litigating a decided design is exactly how an agent burns a budget.

**The command is shown, not executed.** Spawning it would make the app responsible for supervising a long-running interactive process it cannot control, and would *still* not tell it what the run cost.

### Your Feedback

- **The plan was wrong on a load-bearing point, and finding that changed the design rather than delaying it.** "Show the spend from the ledger" was one clause in R4c, and it turned out to be the clause that decided whether orchestration could be built at all. Working around it produced something better scoped than the original — the app does the part it can do well and is honest about the rest.
- **`ChangeRun` has no cost column, deliberately.** A `cost` field would be filled with a guess or a zero, and both would be read as fact. Leaving a column out is a design decision worth recording, because the next person to look will wonder where it went.
- **Whether a change was kept is recorded from what the developer says**, not inferred. The app cannot see whether anything was committed, and guessing would put a wrong answer in the history.

### Technical Debt

- **Nothing verifies the agent ever ran.** A prepared run sits at `prepared` until someone reviews or settles it, and a brief written and forgotten looks identical to one in progress.
- **The brief is regenerated wholesale each time**, overwriting the previous one at the same path. There is no history of what an agent was told on an earlier attempt, which is the first thing you would want when a second attempt goes wrong.
- **`settle_change_run` is built and not yet wired to any button.** The command exists; the review panel does not offer kept/discarded.
- **Architecture selection is coarse** — the brief carries this Solution's documents *and* every Product-wide one. For a Product with many diagrams that is a large brief.
- **No estimate is offered either.** The estimator could price what the work *would* cost at API rates, clearly labelled — that would be honest and useful, and it is not built.

## Round 8d — The editor, the pal, and an accept that is never gated

### My Feedback

Three decisions were put to you and you took them: **full editor plus coding pal** (over my recommendation to skip both), **accept always available** (over my recommendation to gate it on a clean review), and **marketing artefacts stored** (as recommended). All three are built.

**The editor.** Monaco over the open file — edit, save, dirty state measured against the last saved content so an edit undone by hand reads as clean. Saving is the first write path this app has ever had into a working copy, so it gets the containment rule plus one of its own: **nothing writes under `.git`**. `src/../.git/config` resolves to a path *inside* the root — the containment check alone would pass it — and a write there changes what the repository *is*. The check runs on the resolved path and a test drives both spellings at a real `.git/config`. Monaco loads on demand (+4 kB startup) and is pointed at the bundled build explicitly, because the wrapper's default fetches the editor from a CDN and an offline desktop app must never do that.

**The pal.** Explain / refactor / document / draft tests, through the same gates as every other AI action — Product policy, budget router, ledger, dispatch by provider kind. The boundary that matters: **the pal never touches disk.** A revision lands in the editor buffer as an unsaved change and the developer's save is the gate; a test pins that apply calls no write. Proposals are rule-checked two ways before apply — declared technologies and the replacement code itself — and violations are shown, never enforced, consistent with the accept decision. The tests action deliberately returns no replacement: tests belong in their own file, this tool saves only the open one, and a replacement would overwrite the code under test with its own tests.

**The ungated accept.** A review now attaches to the newest unsettled handover and records its findings on the run *before* any button exists to press. Keep is then offered whatever the findings say — your decision — and keeping over a violation is confirmed as "with the broken rules above on the record", not laundered into a clean pass. A settled run stops attracting reviews. Keep/discard records the decision and touches no files.

### Your Feedback

- **Adding the pal's ledger purpose uncovered a real bug**, the worst class this platform can have: `marketingStrategy`, `designStrategy` and `architectureDoc` were never added to `ai_usage::PURPOSES`, and `ai_run::record` swallows ledger errors by design — so every R2/R3 generation ran, was paid for, and left no ledger row. The budget router has been routing on an understated bill. Two protections cancelled each other: validation raised exactly the error the swallow ate. Fixed, with a regression test that records one call per purpose the commands use and counts the rows. The rows never written are gone.
- **I recommended against two of these features and built them properly anyway.** The record should show both halves: the recommendation and the decision. The pal is the strongest version of itself I could make — cached file context, shared rules rendering, disk never touched — and the ungated accept keeps the audit trail even though it gives up the gate.
- **`user.type` into Monaco is a stub.** jsdom cannot host the real editor, so a textarea honouring value/onChange stands in. Everything the tests prove about typing is proved against the stub; the containment and write behaviour is cargo-tested against real directories, which is where the risk actually lives.

### Technical Debt

- ~~**The pal sends no selection.**~~ **Closed the next round** — Monaco's selection now travels with the ask, with a visible note, and clearing it returns to whole-file questions. The asymmetry is stated where it lives: the file is read from disk, the selection from the editor, because "this bit" only exists there.
- **The pal reads disk, not the buffer** — stated in the UI, but it means asking about unsaved work answers about the old version.
- **No inline suggestions, maintainability scoring or per-keystroke cost estimation.** Continuous completion against a metered API is a money furnace and against local models is treacle; declined knowingly rather than half-built.
- **File creation is still not offered** — the editor edits, it does not scaffold, so the tests action's output must be pasted by hand into a new file.
- **The build now needs a 4 GB Node heap** (Monaco's five workers) and takes ~68s, up from ~12s.
- **Auto-accept without review** is technically the state of the world: Keep appears after a review, but nothing forces reading it. That is the shape of the decision taken, recorded here so nobody later mistakes it for an oversight.
- **Standing: the Claude path is unproven live.**
