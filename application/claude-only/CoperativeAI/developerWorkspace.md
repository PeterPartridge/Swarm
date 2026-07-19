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

- **No orchestration.** Launching a work item into its repo via Claude Code is not built, for the billing reason above. The brief and capability pack that would feed it already exist.
- **Review is read-only — there is no accept/reject.** The plan wanted per-file accept or reject; this shows the diff and the findings and leaves the acting to git. Accepting or rejecting a hunk means writing to a working copy, which this round deliberately does not do.
- **`unlistedTech` is declared in the finding types and never produced.** The rules check needs a declared technology list, which a diff does not carry — inferring it from source would be guesswork. The variant is there because the type is shared with the strategy path; nothing emits it here.
- **The diff is shown as plain text.** No syntax highlighting, no side-by-side, no per-hunk collapse. A large change is a wall.
- **Only the working copy is reviewed** — uncommitted changes against HEAD. There is no way to review a branch, a commit range, or a pull request.
- **The file tree caps at depth 6 and 2000 entries.** It says when it truncated, but a large monorepo will hit both and there is no way to navigate past the cap.
- **Not run in the real app.** Tauri UI cannot be exercised in a Vite preview. `workspace.rs` is covered by tests against real temporary directories; the panel is covered by mocked tests only.
- **Standing: the Claude path is unproven live**, four rounds running.
