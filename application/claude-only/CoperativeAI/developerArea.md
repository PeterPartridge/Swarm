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

## Round 50 — the path that climbs out

### My Feedback

**`../../shared/serve.py` got neither treatment.** It is relative, so the absolute warning never fired; and it was already relative, so nothing resolved it. It still is not in the repository. That was the last hole in "whether a path travels is a fact about the path".

**Which paths escape cannot be told from the leading dots.** `../../shared/x` leaves the working copy and `../orders/api/x` climbs out and straight back into it, and they look alike. So a relative path is resolved against the root and then measured, exactly as an absolute one is — and the second is stored as `api/serve.py`, the short form it actually means.

**It has its own sentence.** "Kept as a full path — which will not be right on another machine" is wrong about a relative escape: this one *is* portable, to any machine where the repository sits beside whatever it names. `outside` went from a boolean to `null | "absolute" | "escapes"`, because one message covering both would be wrong about one of them.

**`api/../serve.py` is stored as `serve.py`**, lexically. The real filesystem is the backend's business and a symlink could make a lexical answer wrong — but the question here is what to *store*, and the short form is right on every machine rather than only where that folder happens to exist.

**On the backend, `..` is resolved rather than joined on.** A sibling checkout stays a legitimate answer; what changes is that a refusal no longer quotes back `C:\repos\orders\..\..\shared\serve.py`. And climbing above the root of the drive is refused outright, because `PathBuf::pop` on an empty path returns false and would otherwise have turned `../../..` into the current directory silently.

### Implemented

- `lib/debuggers.ts` — `StartFrom` with the three-way `outside`; `tidy` (lexical `.`/`..`) and `resolveAgainst` (where a relative path lands, keeping a POSIX leading slash that splitting would eat).
- `DebugSession` — a sentence per reason.
- `commands/debugging.rs::named_start` — segment-wise resolution with the climb-off-the-top refusal.
- Two Rust tests (a sibling resolves with no `..` left in it; climbing off the top is refused) and four Vitest ones (dots resolved, escape named, out-and-back-in kept short, and the panel's two sentences).

### Tests
cargo 651/651 (23 ignored, live-only), Vitest 585/585, `tsc --noEmit`, `npm run build` and clippy `-D warnings` clean.

### Your Feedback

- **An escaping path is stored as written, not as the absolute it resolves to.** Turning `../shared/x` into `D:/work/shared/x` would trade a portable-with-a-sibling answer for a machine-specific one — the opposite of what the rest of this does.
- **Lexical, not canonical.** `startFromFor` never touches the disk, so a symlinked folder could make it disagree with the filesystem. It is deciding what to store, and the backend's existence check at launch is what decides whether it works.
- Recommendation: `outside` is now a small union. If a fourth reason ever appears, it belongs there rather than as a second boolean beside it.

### Technical Debt

- **The backend does not report escaping at all.** It resolves and checks existence; the warning is the UI's, worked out separately. Two places computing "is this inside" is the drift this round otherwise removed — the backend's copy just happens not to draw a conclusion from it yet.
- **A Windows drive-relative path (`\api\serve.py`) is treated as absolute** by `isAbsolutePath` and so lands in the "absolute" branch, where `relativeTo` will not match it and it is warned as unportable. That is the right outcome by accident rather than by design.

## Round 49 — the typed path gets the same treatment

### My Feedback

**Whether a path travels is a fact about the path, not a memory of how it arrived.** `outside` was set by the picker and by nothing else, so an absolute path typed into the box was stored whole with nothing said — and quietly meant a different file on the next machine. That is the same failure the picker was built to avoid, reachable by typing instead of clicking.

`startFromFor(root, chosen)` is now the one place that decides, and both ways in go through it:

- **Relative in, relative out**, with backslashes tidied so a typed `api\serve.py` matches what the picker produces.
- **Absolute and inside the working copy → made relative.** That is the same answer written portably, and there is no reason to keep the machine-specific form once it can be dropped.
- **Absolute and outside → kept whole, and said to be.** A `.dll` built elsewhere is legitimate; pretending it is portable is not.

**The warning is derived, so it shows on arrival too.** A Solution that already holds an unportable path says so when the panel opens, rather than only after somebody edits the field.

**The box re-keys on what was stored**, so typing a full path inside the working copy visibly becomes the short form. Leaving the typed text on screen while storing something else would be its own small lie.

`isAbsolutePath` went next to `relativeTo` in `lib/breakpoints`, which is where this project's path handling already lives — one place that knows about drive letters, UNC shares and Windows' case-insensitivity.

### Implemented

- `lib/breakpoints.ts` — `isAbsolutePath`.
- `lib/debuggers.ts` — `startFromFor`, used by `saveStartFrom`; `browseStartFrom` now just hands the picker's answer to it.
- `DebugSession` — `startFrom` held as state seeded from the Solution, `outside` computed from it, the box keyed on it.
- Three Vitest tests on the panel (typed absolute made relative, typed outside warns, stored outside warns on arrival) and four unit tests on `startFromFor`.

### Tests
cargo 649/649 (23 ignored, live-only), Vitest 581/581, `tsc --noEmit`, `npm run build` and clippy `-D warnings` clean.

### Your Feedback

- **A sibling folder whose name merely starts the same is outside**, and there is a test for it — `C:/repos/orders-old` against a root of `C:/repos/orders`. `relativeTo` already required the separator; this pins that it stays required.
- **Silently rewriting what somebody typed is a real cost**, paid deliberately: the alternative is storing a path that works here and nowhere else. The box updating to show the stored form is what makes it honest rather than surprising.
- Recommendation: `startFromFor` is pure and has its own tests. If a fifth thing ever needs to store a repository-relative path, it should call this rather than grow a third copy of the rule.

### Technical Debt

- **A relative path is not checked to be inside the working copy.** `../../elsewhere/serve.py` is stored as typed and warns about nothing — the launch-time check will refuse it if it does not exist, but it will not say it has escaped the repository.
- **`isAbsolutePath` counts a bare leading slash as absolute**, which on Windows is drive-relative rather than truly absolute. For the question being asked — "is this relative to the working copy?" — that is the right answer, but the name is slightly stronger than the behaviour.

## Round 48 — the picker, and the relative path it has to produce

### My Feedback

**Relative storage was the whole reason this was not built last round**, and it is the whole content of this one. An absolute path is *this machine's* answer to a question the Solution asks on every machine: two people with the repository in different folders would each overwrite the other, and neither would notice until a debugger refused to start on somebody else's laptop.

So the picker opens at the Solution's own folder, and what comes back is resolved against it. The resolution is `lib/breakpoints::relativeTo`, which the debugger's stopped-file lookup already uses — Windows' case-insensitivity and its backslashes are already handled there, and a second implementation would have got one of them wrong.

**A folder for Go, a file for the rest.** Delve is given a package, so a file picker that could not select `cmd/api` would be a picker for the one language it cannot pick for.

**Outside the working copy there is no relative form.** That is kept whole and said to be — "which will not be right on another machine" — rather than stored as something that quietly resolves to a different file elsewhere. A `.dll` built outside the repository is a legitimate answer; pretending it is portable is not.

**Cancelling changes nothing**, including not clearing what was already there.

### Implemented

- `DebugSession` — `browseStartFrom` over `@tauri-apps/plugin-dialog`, `directory: language === "go"`, `defaultPath` the working copy; the box re-keys on what was picked so browsing shows; `outside` drives the warning.
- Four Vitest tests: the relative store, the folder-vs-file ask with its `defaultPath`, the outside-the-copy path with its warning, and cancelling.

### Tests
cargo 649/649 (23 ignored, live-only), Vitest 574/574, `tsc --noEmit`, `npm run build` and clippy `-D warnings` clean.

### Your Feedback

- **The dialog is the one thing here that cannot be driven**, so the tests stand it in and assert on what it was *asked* for as well as what was done with the answer. Asserting only the second would let the folder-vs-file rule rot silently.
- **No extension filter on the file picker.** Filtering to `.py` for Python would be right until somebody debugs a file without that extension, and the placeholder already says what shape is wanted.
- Recommendation: `relativeTo` is now load-bearing for two features. It has its own tests in the breakpoints suite; leave them there rather than duplicating them here.

### Technical Debt

- **The picker cannot select a path that does not exist yet** — an assembly that has not been built, for instance. The typed box still can, which is the escape hatch, but the button silently cannot help there.
- **`outside` is only set by the picker.** A full path typed by hand gets no warning, because nothing re-examines the box on blur.

## Round 47 — start from

### My Feedback

**A convention is right most of the time and impossible to argue with when it is not.** Working out what to launch is a convention per language — the first `main.py`, the built assembly, the package folder. `startFrom` is the argument, and it sits in the Solution's debug panel because that is where the refusal appears.

**It is not a Python field.** All four languages are handed the thing they start: Delve the `cmd/…` package that has the `main`, netcoredbg the `.dll` you name rather than the one the build search guessed at, js-debug the entry, debugpy the file. A field that quietly worked for one of four would be worse than none. The placeholder changes per language, because one box means four things and "a path" would be true and useless.

**Not the run command.** That is a shell line — `npm run dev` — and this is a path an adapter is pointed at. One field for both would mean typing a shell command somewhere it gets handed to a debugger as a filename.

**Checked when a session starts, not when it is saved.** It is set once and then forgotten, so the file it names outlives the memory of naming it. A rename would otherwise hand the adapters three different confusions — Delve says the package is missing, debugpy exits at once with nothing on the console, netcoredbg stops at no breakpoints — where one clear refusal naming the path and saying how to clear it is worth all three.

**It takes effect on the next start.** A launch argument is read once, at launch; a field that implied otherwise would be the breakpoint mistake again, a control that looks like it did something to a running program. Saving during a session says so.

**Where the guess is still in charge, it says which file it took.** C# gains the same line Python got last round, because a chosen assembly is as easy to forget as a chosen script.

### Implemented

- `db/solution.rs` — `startFrom` column (ALTER TABLE; a person wrote it), `set_start_from`, stored trimmed with blank clearing it.
- `commands/inspectors.rs::set_solution_start_from`; `commands/debugging.rs::named_start` resolves it against the working copy and refuses a path that is not there; every arm of `launch_arguments` honours it; `debug_start` takes the Solution and reads the field itself.
- `DebugSession` — the field, a per-language placeholder, and the note when a session is already running; `debugStart` now carries the Solution id.
- Four Rust tests (named beats convention, relative resolution, the refusal, all four languages) and four Vitest ones (saving, clearing, the Solution being handed over, the running-session note).

### Tests
cargo 649/649 (23 ignored, live-only), Vitest 570/570, `tsc --noEmit`, `npm run build` and clippy `-D warnings` clean.

### Your Feedback

- **The field is not validated on save**, deliberately. Checking then would only buy a false sense of having been checked — the folder can change afterwards, and the check that matters is the one at launch.
- **Forward and back slashes are both accepted** in a relative path, because people type `src/main.py` on Windows too.
- Recommendation: the placeholders name a shape per language (`cmd/api`, `bin/Debug/net8.0/Api.dll`). If a fifth language is added, that switch is one of the three places that has to grow — with `CAN_LAUNCH` and `launch_arguments`.

### Technical Debt

- **No file picker.** It is a typed path, and the Solution's folder is right there to browse. A picker would have to resolve back to a relative path to stay portable, which is why it is not in this round.
- **Nothing warns when `startFrom` stops matching the language.** Rename a Solution's language from Python to Go and the `serve.py` it starts from is still there, refused only at launch.
- **The C# override skips the Debug/Release check entirely.** That is right — nothing was guessed — but it also means naming a Release `.dll` gets no warning about optimised code, where the search would have given one.

## Round 46 — the Python launch shape

### My Feedback

**The difficulty was never the protocol.** Delve is handed a folder and builds it. netcoredbg is handed a built assembly, which either exists or does not. debugpy runs **exactly one `.py`**, and a folder of Python says nothing about which file that is.

So `debug::python::entry_script` looks for the conventional names in order — `main.py`, `manage.py`, `app.py`, `__main__.py`, `run.py`, `src/main.py`, `src/app.py` — then for a single package with a `__main__.py`, and **refuses when none of them is there**. A debugger pointed at the wrong file starts, runs something, and stops at none of the breakpoints; that reads as a broken debugger rather than a wrong file, which is the most expensive way this could have been got wrong. The refusal lists what was looked for, because "no entry point found" on its own leaves somebody guessing at this function's opinions.

**Two packages with a `__main__.py` is a real choice, not a tie to break.** Picking the alphabetically first would be a coin toss presented as a decision, so both are named and a `main.py` is asked for. Virtual environments and `__pycache__` are skipped — they are full of other people's `__main__.py`.

**The program runs under the interpreter that was proved to have debugpy.** Left unset, debugpy resolves one for itself, and on Windows that is routinely a different Python from the one the adapter search found — the program then fails on imports that are plainly installed. `debug_start` was reordered to find the adapter first so the launch shape can be given it, which also means a missing adapter is reported before an entry script is resolved for a debugger that is not there.

**Output comes back over DAP** (`console: internalConsole`, `redirectOutput: true`), because that is what the console pane reads; `integratedTerminal` would need the client to hand the adapter a terminal, and this app does not.

**A file chosen by anything other than `main.py` is named in the session.** A wrong guess otherwise presents as breakpoints that never hit; saying "Debugging src/app.py, chosen because…" turns that from a mystery into an easy correction.

### Implemented

- `debug/python.rs` — new: `CANDIDATES`, `entry_script`, the package scan, and seven tests covering ordering, nesting, the single-package case, a folder that is not a package, the ambiguous case, virtualenvs, and the actionable refusal.
- `commands/debugging.rs` — the `"python"` arm of `launch_arguments`, which now also takes the adapter's interpreter; `debug_start` finds the adapter before building the shape; four tests on the shape itself.
- `debug/live.rs` — an ignored live test that stops real Python on line 3 and reads `subtotal` out of scope, launched exactly as the command does.
- `lib/debuggers.ts` — `CAN_LAUNCH` gains `python`; the "Go, TypeScript and C# work today" wording in three places now names all four.

### Tests
cargo 645/645 (23 ignored, live-only — one more than last round, the new debugpy test), Vitest 566/566, `tsc --noEmit`, `npm run build` and clippy `-D warnings` clean.

### Your Feedback

- **`justMyCode: true`**, matching the C# choice. Stepping stays in the code somebody wrote rather than descending into the standard library. If that turns out to be the wrong default for this team it is one line, but it should be a decision rather than drift.
- **The entry-point list is opinionated and finite.** That is the point — it is a convention, not a search — but it means a project that starts from `serve.py` gets a refusal rather than a guess. The refusal says exactly that and asks for a `main.py`.
- Recommendation: if refusals become common, the honest fix is a per-Solution "start from" field rather than a longer list of guesses. The list is where a guess would hide.

### Technical Debt

- **No way to say which file to debug** when the convention gets it wrong. The refusal asks for a `main.py`, which is a rename rather than a setting.
- **The live test is ignored**, like the other twelve — it needs debugpy on the machine. The shape is pinned by unit tests; the protocol behaviour is pinned only when somebody runs the live one.
- **`entry_script` does not read `pyproject.toml`.** A project whose entry point is declared under `[project.scripts]` is invisible to this, and parsing TOML for it would need a dependency this crate does not have.

## Round 45 — installing it from here

### My Feedback

**Only half of these can be installed by a command.** Delve is `go install …` and debugpy is `pip install debugpy`; js-debug and netcoredbg are a download and an unzip. A button that typed "Download js-debug-dap from github.com/microsoft/vscode-js-debug/releases and extract it to ~/.js-debug" at a shell would report `command not found`, which reads as a broken app rather than a manual step. So `AdapterStatus` carries `install_command` apart from `install`: the prose instruction is always there, the runnable command only where one exists, and the button follows the second.

**Only the language crosses the wire.** A terminal is arbitrary execution, so `open_debugger_install` takes a language, matches it against this app's own adapter table, and types that table's command — the same rule `open_claude_sign_in` already follows and for the same reason. Accepting the command as a string would have made "type this into a shell" an IPC call any page could make.

**Typed into a real shell, not run behind the panel.** What ran is in the scrollback with its output, so a failed install can be read, corrected and tried again in place — the rule the sign-in and the starters both follow.

**It does not claim to know when the command finished.** A PTY does not report that, and guessing from a returned prompt would be a guess. The panel says so and puts Look again beside the terminal.

### Implemented

- `debug/adapters.rs` — `install_command` on `AdapterStatus`, populated for Delve and debugpy, empty for js-debug and netcoredbg; a test pins exactly which two, that each runnable command is the one its prose names, and that it is one line.
- `commands/terminals.rs::open_debugger_install` — looks the command up by language, refuses the download-and-unzip pair with the manual instruction, opens a home-folder shell (Solution zero) and types it.
- `DebugAdapters` — "Install it here" per missing adapter that has a command, the shell inline beneath it, one install at a time.
- Two tests in `DebugBoard.test.tsx`: the button sends only the language and disclaims knowing when it finished; no button where there is no command.

### Tests
cargo 634/634 (22 ignored, live-only), Vitest 565/565, `tsc --noEmit`, `npm run build` and clippy `-D warnings` clean.

### Your Feedback

- **One install at a time.** Two shells installing two adapters is not something anybody means to do, and the second would scroll the first out of sight — which is the half worth reading when one fails.
- **The install shell is `keepAlive`.** An install part-way through must not be killed by looking at something else.
- Recommendation: `install_command` is a single line by construction and there is a test holding it that way. If an adapter ever needs two steps, it belongs in `install` as prose with no button rather than as a `&&` chain nobody can read in a tooltip.

### Technical Debt

- **Nothing re-reads when the install shell is closed.** Closing it is a decent signal that the command is done and is not used — Look again and window focus are the two triggers.
- **`pip install debugpy` installs into whichever Python the shell finds**, which on Windows may not be the one the adapter search would pick. The command is the one the adapter table has always advertised; making it match the discovered interpreter is a separate piece of work.
- **Python still has no launch shape**, so installing debugpy from here makes the Debuggers panel go green without making Python debuggable. The panel says the first; nothing says the second in that moment.

## Round 44 — the check can stop being true

### My Feedback

**A refusal that outlives the reason for it is worse than no check at all** — it is the app insisting on something that stopped being true. Round 43 could refuse a Debug press because Delve was missing; nothing could then notice Delve arriving.

The install runs in a terminal outside this app, so nothing here can be told it finished. Three things notice anyway:

- **Returning to the window re-reads the list**, gated on the last answer having had a gap in it. Executing every candidate adapter on each alt-tab would be a lot of work for nothing when the previous answer was complete.
- **"Look again" sits beside every place the install command appears** — the run picker, the Solution's own panel, and the Debuggers list — for when focus was not enough.
- **The read is shared.** Three panels asked for the same list and each probed separately, so an install picked up in one left the others still refusing. One read, one signal, everybody hears it.

**Deduped rather than cached**, deliberately. Sharing the in-flight promise collapses the startup burst to a single probe; sharing the *result* would be a cache that has to be invalidated, and the thing it would go stale against is exactly what this round exists to notice.

**A failed re-read keeps the working answer.** Clearing on error would turn a hiccup into a refusal — the same mistake as round 43's first cut, where a failed read collapsed into an empty list and disabled debugging everywhere.

**The Debuggers panel gave up its private copy.** Two lists of the same facts, with the one on screen not being the one deciding, is the drift this app keeps removing. It reads the shared one now and its Check button is unchanged.

### Implemented

- `lib/debuggers.ts` — module-level listener set on the `workSignal` pattern; `readAdapters` dedupes the in-flight read; `recheckDebuggers()` drops it and fans out; `useDebuggers` subscribes, re-reads on `window.focus` when `anythingMissing`, and returns `recheck`.
- `DebugAdapters` reads the shared list and gains a "Look again" in its header.
- `RunBar` and `DebugSession` show "Look again" beside their install lines.
- `pages/__tests__/debuggers.test.tsx` — eight tests: one probe for three consumers, recheck reaching a panel that did not ask, focus re-reading only after a gap, a failed re-read keeping the answer, and the three readiness verdicts.

### Tests
cargo 633/633, Vitest 563/563, `tsc --noEmit`, `npm run build` and clippy `-D warnings` clean.

### Your Feedback

- **The focus gate is on "was anything missing", not "was this adapter missing".** A Product where any one adapter is absent re-probes them all on focus. Simpler, and the wrong direction to be cheap in — the point is noticing.
- **The app still does not run the install.** It could: there are PTYs, and `DevServerPanel` already types commands into a shell rather than running them behind it. That would make "after an install" literal — press it, watch it, re-read when the shell settles. Not built, because installing software is a bigger side effect than starting a dev server and it deserves to be asked for.
- Recommendation: `available` means "the binary ran". If an adapter is ever installed but broken, this will keep saying ready. `debug_check` is the stronger claim and is still a button.

### Technical Debt

- **The focus listener is per mounted consumer**, so three panels mean three listeners all calling the same deduped read. Harmless — the dedupe collapses them — but it is three subscriptions doing one job.
- **Nothing re-reads on a timer**, so a console left open on another monitor while an install runs will not notice until it is focused or asked.

## Round 43 — the adapter is checked before the press

### My Feedback

**The answer was already known and nothing was asking it.** `debug_adapters` runs every candidate rather than looking for a filename — the distinction that matters on Windows, where the `python` on PATH is usually a Store stub that prints an advert and exits. That read is shared now, so:

- **The run picker says, per Solution, what Debug will do to it** before anything is pressed: "debugs with Go (Delve)", "Go (Delve) not installed — runs in a shell", or "no debugger for its language — runs in a shell".
- **The install command is on screen and selectable**, one line per adapter rather than per Solution. A tooltip is fine for reading and useless for pasting.
- **The per-Solution Debug button is refused** where the adapter is missing, with the same command underneath — instead of offering a press that can only fail with a DAP error.
- **A Debug press that falls back says which reason it was.** "No launch shape yet" is a thing to wait for; "not installed" is one command away, and running them together would hide the fixable one.

Two edges worth stating, because both were wrong first:

**A list that could not be read is not proof of absence.** The first cut collapsed a failed read into an empty list, which made every Solution look like a missing adapter and disabled debugging across the app — a real regression, caught by seventeen unrelated tests going red at once. `null` is "nobody knows" and `[]` is "nothing is installed"; on unknown, Debug still tries, because refusing on a question that never got answered is worse than the failure this check exists to avoid.

**A Debug press has to wait for that read.** Allowing "unknown" through created a race: the first render says nobody knows, the press goes through, and the verdict arrives a moment later with nothing left to decide. `useDebuggers` reports `settled` separately from having an answer — a read that finished and failed is settled — and the board holds a debug request until then. Run and Hot reload are not held up; they do not care.

### Implemented

- `lib/debuggers.ts` — new: `debugLanguageOf`, `CAN_LAUNCH`, `canLaunchDebugger`, `Readiness`, `readinessOf`, `useDebuggers` (`{ adapters, settled }`). `DebugSession` re-exports the first two so it stays where a reader looks for them.
- `RunBar` — per-row readiness with provenance and the install line.
- `DebugSession` — the button is refused on a definite missing adapter, with the command in the panel.
- `DebugBoard` — waits for `settled` on a debug press, splits the fallback into "unsupported" and "missing", and prints the install command for the second.
- Tests: three more in `DebugBoardStart.test.tsx` (missing adapter, unreadable list, refused button) and two in `RunBar.test.tsx`.

### Tests
cargo 633/633, Vitest 555/555, `tsc --noEmit`, `npm run build` and clippy `-D warnings` clean.

### Your Feedback

- **`debug_adapters` executes every candidate**, so this is not a free read. It is done once per mounted component that needs it — the picker, the board, and each session panel — which on a Product with several Solutions is several executions of the same probe. A shared cache is the obvious next step if it is ever felt.
- **`available` is "it ran", not "it speaks DAP".** `debug_check` proves the second and is still a button on the Debuggers panel. This gate rests on the weaker claim deliberately: the stronger one costs a handshake per language, and a binary that runs but cannot handshake is rare enough to be worth finding out by failing.
- Recommendation: the install commands come from the adapter list, so they are as good as that list. Worth a glance at `debug::adapters` if any of them go stale.

### Technical Debt

- **Nothing re-reads the adapter list after an install.** Somebody who installs Delve on the strength of the message has to reopen the pane before the button comes back.
- **The `unknown` path is untested against a slow read** — only against a failed one. The race it guards is real but the test for it is the settled-and-failed case.

## Round 42 — Debug attaches the debugger

### My Feedback

**Debug is not "run, plus a debugger" — it is one or the other, per Solution.** A debug adapter *starts the program itself*: Delve launches the binary, js-debug launches node, netcoredbg launches the built assembly. Typing `go run .` into a shell as well would start a second copy, and two processes fighting over one port look exactly like a broken debugger.

So a Debug press launches the adapter for every picked Solution whose language has one and types nothing at those, and **falls back to a plain shell run for the ones that do not — naming them**. Left unsaid, that fallback reads as a debugger that takes breakpoints and ignores them, which is the most expensive thing this board could get wrong.

**Debug now reaches a Solution with no run command at all.** The previous version started whatever was *runnable*, which filtered on having a shell command — dropping exactly the Solutions Debug exists for. Run and Hot reload still filter that way, because they have nothing else to do.

Run and Hot reload are otherwise unchanged and never attach a debugger.

### Implemented

- `DebugSession` exports `canLaunchDebugger` and takes `startNow`; `start` is reached through a ref, because it closes over most of the panel's state and depending on it would relaunch the debugger on the next keystroke anywhere.
- `RunRequest.how` gains `"debug"`; `RunBar` sends every *picked* Solution rather than every runnable one.
- `DebugBoard` splits a debug request into "under the adapter" and "in a shell", queues a command only for the second, and reports the fallback by name.
- `pages/__tests__/DebugBoardStart.test.tsx` — three tests: no double start, the named fallback, and Run not attaching anything.

### Tests
cargo 633/633, Vitest 550/550, `tsc --noEmit`, `npm run build` and clippy `-D warnings` clean.

### Your Feedback

- **A second press while stopped on a breakpoint is ignored.** Starting another debugger underneath a stopped program would be two sessions on one Solution, and the panel only draws one.
- Recommendation: there are still two controls called Debug — this one, and the per-Solution button inside the board. They now do the same thing for one Solution versus several, which is better than doing different things, but the names deserve a pass.

### Technical Debt

- **A Solution launched under a debugger still gets a shell attached** with nothing typed into it. That is deliberate — it is the only way to type a command at it — but it means a process board row showing "up" for a shell nobody started anything in.
- **Nothing checks the adapter is installed before the press.** `debug_check` exists and the Debuggers panel uses it; a Debug press finds out by failing.

## Round 41 — Debug starts it, and the console comes off

### My Feedback

**Debug now starts the thing it is named after.** It opened a board on which every Solution still needed attaching and then running — three presses to reach the state the word already promised. One press now runs what the picker holds.

**What runs is a picker, not the Solution you happen to be on.** It defaults to the one being browsed, which is right nearly always and wrong exactly when it matters: the front end you are reading is not the API you need up to read it. It is a multi-select, and the selection stops following the tabs once somebody makes a choice of their own — a selection that quietly re-pointed itself would run the wrong thing and look like it had run the right one.

**Each row carries its own command dropdown** — what detection found, what that Solution has been given, and "Something else…" which is remembered against the Solution. The override used to be a form on a different panel from the button that used it.

**Run and Hot reload sit in the middle of the bar, in line with Debug.** Hot reload is disabled unless something picked actually has a watcher, and says why: a front end's Run already reloads itself, so a second button for it would do the same thing under a name promising something different.

**The console moved in with the code.** Output belongs beside the line that produced it; a console on another tab means alt-tabbing between the thing that broke and the reason.

**It drags out into a real second OS window.** 90 pixels of travel before it counts, because the header is also what you click to hide the dock and a window is not something to open by accident. There is a button as well — a drag is not reachable from a keyboard, and a console only mice can pull out is a console half the people here cannot use. **The shell survives the trip** by being adopted by id, with its recent output to catch up on. **The debugger's output does not** — it is a stream of events with no replay — so the pulled-out window says it starts from the next line rather than pretending it has the history.

**A breakpoint hitting brings you back to the code.** The file was being rendered underneath the board you were still looking at, which is the one moment the board is not what you want.

**The three breakpoint boxes became one control per breakpoint.** Closed it says "Stops every time", or "prints · conditional · after 7"; open it is a tick per behaviour, each revealing its own box. All three can be on at once because the adapters allow it — "print the total, but only after the seventh time round, and only when it is negative" is one breakpoint, and a single-choice dropdown could not say it. The expression stays free text: `model.value == -3` is not something anybody could have put in a list of values, and the grammar belongs to the adapter, not to this app.

### Implemented

- `components/code/RunBar.tsx` — the picker, the per-Solution command dropdown, Run and Hot reload; `startNow` lets the Debug button ask it to start what it holds rather than a second place re-deriving the same answer.
- `components/code/ConsolePanes.tsx` — the shell plus the debugger's output, rendered identically docked and detached.
- `components/code/ConsoleDock.tsx` — the grip, the drag threshold, and the state after pulling out.
- `pages/StandaloneConsole.tsx` + a `console` branch in `main.tsx`; `commands/windows.rs::open_console_window` (Solution-scoped, separate from the Product-scoped `open_screen_window`).
- `components/code/BreakpointBehaviour.tsx` with `summarise`; `BuildFileEditor` uses it in place of three inputs.
- `DebugBoard` takes a `RunRequest` and attaches + queues the command; `AgentWorkspace` jumps to the stopped file and mounts the dock beside the editor.

### Tests
cargo 633/633 (22 ignored, live-only), Vitest 546/546, `tsc --noEmit`, `npm run build` and clippy `-D warnings` clean.

### Your Feedback

- **An unmeasurable drag is not a drag.** jsdom has no `PointerEvent` and its fallback drops `clientX`, which made the distance `NaN` — and `NaN < 90` is false, so every twitch opened a window. The guard is in the component, not the test, because a real pointer device that reports no coordinates would do the same thing.
- **The dock is hidden while the Debug board is up.** That board has its own shell per Solution and two panels adopting one PTY would fight over its size. Worth revisiting once the board and the dock stop being two answers to "where is the terminal".
- **Unticking a breakpoint behaviour clears its box.** A condition left behind in a hidden field would still be sent to the debugger, and the breakpoint would go on not stopping for a reason nothing on screen could explain.
- Recommendation: the console pulls out per Solution and is keyed `console-<id>`, so dragging twice focuses the existing window. If you want two consoles on one Solution, that key is the thing to change.

### Technical Debt

- **The pulled-out console shows every session's debug output**, not one session's — it listens to the app-wide event and has no session of its own to filter by. With one debugger running that is right; with two it is a merged stream.
- **Debug starting the app does not start the *debugger*.** It runs the command in a shell; breakpoints still need the per-Solution Debug button in the board. Those are two things called Debug, which is the ambiguity the button's aria-label was already apologising for.
- **`RunBar` reads every Solution's command on mount**, so a Product with twenty Solutions makes twenty calls before anybody presses anything.
- **No live end-to-end run**: the browser preview cannot exercise Tauri IPC, so the drag, the second window and the PTY adoption are proven by Vitest against a mocked backend, not by the packaged app. The window itself has no test — it is a Tauri window builder call.

## Round 40 — one block per Solution, and where things live

### My Feedback

**Three places were asking about one Solution.** A ticklist of affected Solutions, the list of changes, and a block of branch/tests/notes further down — and the ticklist existed only to make the third one appear. There is one block per Solution now, holding everything about it: which families change, the things themselves, the sentence, the tests, the branch, the pictures, the approval and the generated schemas. **Picking a Solution attaches it**, because that is what "affected" means.

**The pictures come out when the block is about something somebody looks at** — a screen, a component, a route, a style — and the picture-to-screen pairing happens right there. It used to be in a section nowhere near the row naming the screen, which is exactly how a model ends up with a pile of images and a list of names.

**The New-or-existing dropdown is gone.** It asked a question the app can answer: a name the Solution already has is being changed, anything else is new. Asking meant a wrong answer was one mis-click away, and "add the Basket screen" against a Basket screen that exists is a plan that gets estimated wrong.

**Where things live is a rule now.** A folder per kind in the Develop rules — screens in `src/pages`, services in `src/services`, and so on. Agents are told it, and the build plan reads the folder to suggest what is already there. **Each suggestion says where it came from**, because a name recorded by the team and a name read off the disk are different kinds of claim, and a guess presented as a fact is how a plan ends up naming a file rather than a feature. **Nothing is scanned for a kind nobody has placed**: guessing that screens are "probably in `src/pages`" would produce confident suggestions for a repository laid out some other way.

### Implemented

- `db/developer_rules.rs` — `kindLocations` column (ALTER TABLE, because rules are written by a person), `location_of`, and JSON validation at the boundary.
- `commands/work_item_changes.rs::suggest_change_names` — recorded names first, then one level of the configured folder; `index`/`mod` files take their folder's name.
- `components/ai/DeveloperRulesEditor.tsx` — a "Where things live" row per kind, driven by the same vocabulary the build plan ticks from.
- `components/code/WorkItemChanges.tsx` — blocks derived from the plans; branch, cut-from, tests, pictures, approval and schemas moved in; suggestions with provenance; `actionFor` derives new-vs-change.
- `components/planning/WorkItemBuildPlan.tsx` — the ticklist and the per-plan section deleted; `reloadAt` tells the panel to re-read after a generate.

### Tests
cargo 633/633, Vitest 534/534 at the time, `tsc --noEmit`, build and clippy clean.

### Your Feedback

- **One box now writes to three places** — the plan's `changesRequired`, the detail on each row this pass added, and a new dated set on the work item. It is seeded from what is already saved, so it is an edit rather than a blank that clobbers.
- **The scan is one level deep on purpose.** A recursive walk of `src` returns thousands of files, and a suggestion list nobody can read is the same as no suggestions, only slower.
- **`suggest_change_names` is per Solution and per kind, asked when a kind is ticked.** Scanning a folder for a kind nobody is looking at is work nobody asked for.
- Recommendation: if `kindLocations` ends up filled in for every Product by hand, that is the app telling you it should offer per-language defaults — but they must be an offer somebody accepts, not a guess applied silently.

### Technical Debt

- **The suggestion scan does not respect `.gitignore`**, so a configured folder containing build output will suggest build output.
- **A kind can only have one folder.** A repository with `src/pages` and `src/admin/pages` needs two, and there is nowhere to say so.
- **Detaching a Solution leaves its change rows** pointing at it. That is deliberate — they are still work somebody recorded — but nothing surfaces them afterwards except the flat list at the bottom.

## Round 39 — what a change is made of, and the write button that went

### My Feedback

**"UI, logic and models" is not three words.** Asked what those families contain, the answer was that it depends on what is being built: a front end has services and view models, an API has incoming models, outgoing models and the data models behind them, a database has views and stored procedures. The vocabulary went from three ids (`screen`, `api`, `table`) to sixteen, each belonging to one of those three families, with each Solution type carrying its own subset — a website gets services and view models but no storage; an API gets the shapes either side of an endpoint kept separate from the data model, because conflating them is how a database column ends up in a public response. **The old three ids are still in the table under their own names**, so every row ever written stays valid and there was nothing to migrate.

**The change form is now the sentence that was described.** Pick a Solution, tick which families change, say whether they are new or existing, tick or name the things themselves, then write once what has to happen to them. Ticking five endpoints and writing one sentence is one pass, not five.

**Making a Solution moved into the dropdown that needs one.** It is an answer to "which Solution?", so it sits in the list of answers rather than as a button beside it. It is the same form the Map tab uses — including the language picker, whose generator runs for real — because the cut-down copy that was there offered `service`, `library` and `other`, none of which the backend recognises, while missing `database`.

**Every tick is the save; the write button is gone.** The `.md` and `.json` are rewritten after every mutation. They used to be written by pressing a button, which meant what was on disk was whatever the last person to remember had produced — an agent handed a brief three edits out of date builds the wrong thing confidently. When the pair cannot be written, because the Product has no folder yet, the panel says so; the record still saved, so it is a note rather than an error on the field just left.

**Each round of details is kept, not replaced.** What is written in "what needs to change" is appended to the work item's development details as its own dated set, headed with the Solution and what it affected. The second pass does not make the first untrue.

### Implemented

- `db/work_item_change.rs` — `Kind { id, label, heading, group, example }`, `GROUPS`, `KINDS` (16), per-type lists, `kind()`, `headings()`, `add_many()` (per-entry outcomes), `set_detail_many()`.
- `commands/work_item_changes.rs` — `change_kinds`, `add_work_item_changes`, `set_work_item_change_detail`; registered in `main.rs`.
- `files/work_item_files.rs` and `ai/client.rs` both group by `KINDS` now instead of each holding their own copy of the three headings.
- `components/product/NewSolutionForm.tsx` — new, shared by `DevelopSolutions.tsx` and the build plan's dropdown.
- `components/code/WorkItemChanges.tsx` — rebuilt: Solution blocks, grouped family ticks, new/existing, catalogue multi-select or typed names, one details box per block, "Add another Solution".
- `components/planning/WorkItemBuildPlan.tsx` — `writeFiles()` after every save, the write button removed, development details held locally and appended to.

### Tests
cargo 631/631 (22 ignored, live-only), Vitest 530/530, `tsc --noEmit` and `npm run build` clean, clippy `-D warnings` clean.

### Your Feedback

- **Splitting incoming/outgoing/data models is a rule, not a nicety.** An API Solution offers all three deliberately; if in practice everything gets filed as `dataModel`, that is the team telling you the split is not being used and it should be reconsidered rather than left as three names for one thing.
- **The catalogue is still the union of what has been recorded**, so a brand-new Solution has nothing to tick and the form says so and points at "Add new ones". That is honest, but it means the first pass on a new Solution is always typing.
- **The details box is disabled until something is ticked.** A box that accepts text it then drops is worse than one that will not take it.
- **The per-block detail writes only to rows that block put in**, not to everything sharing a Solution and a kind. Somebody else's sentence about the Basket screen is not this one's to overwrite.
- Recommendation: `kinds_for` now decides quite a lot from four Solution types. If a fifth type is wanted (a mobile app, a worker, a library), add it to `SOLUTION_TYPES` **and** to `kinds_for` — an unrecognised type silently gets all sixteen, which is permissive rather than wrong, but it is not a decision anybody made.

### Technical Debt

- **The kind colours in `styles.css` still only cover `screen`, `api` and `table`** — the other thirteen fall back to the neutral chip. Scannability is worse for them.
- **The catalogue is re-read per Solution and cached for the panel's lifetime**, so a Solution changed in another window is stale until the panel remounts.
- **Nothing dedupes across blocks**: two blocks pointed at the same Solution and kind will both offer the same tick, and the second add is refused by the backend rather than prevented by the form.
- **`write_work_item_files` still requires the Product to have a folder**, so on a Product whose framework files have never been generated the pair is never written and the panel says "Not written" after every save. That is true, but it is a per-save reminder of a one-off setup step.
- **No live end-to-end run**: the browser preview cannot exercise Tauri IPC, so the new form is proven by Vitest against a mocked backend and by the Rust suite, not by the packaged app.

## Round 38 — the breakpoints you cannot see

### My Feedback

**A breakpoint in a file nobody has open is invisible and still stops the program.** The strip added in round 27 only knows about the file in the editor, so a mark left behind in a file since closed halted a run with nothing on screen to explain it — and no way to clear it short of remembering where it was and opening that file again. The panel now lists every breakpoint in the Solution.

**What makes each one behave differently is shown**, not just where it is: the condition, the hit count, and whether it logs instead of stopping. Two rows that stop very differently would otherwise look identical, which is worse than not listing them at all.

**Removing one goes straight into the running session.** A breakpoint taken off a list while the program is stopped, and only really removed at the next launch, would be worse than one that did nothing — because you would believe it.

**Said what running a frame again cannot undo**, on the control itself. The stack is rewound; a file that was written, a row that was inserted and a message that was sent have all still happened. That is inherent to what the protocol offers rather than a gap here, and the moment before pressing is the one time it matters.

### Your Feedback

- **The list is read afresh when a run starts.** The editor's gutter writes to the same store, so a list held from mount would show whatever happened to be marked when the panel first appeared.
- **A name collision caught by the type checker was a real bug, not a typing one.** I called a local `current`, shadowing the ref that holds the session id — the session would have been written into a breakpoint store.

### Technical Debt

- **Nothing validates a condition, an interpolation, a hit count or a watch as it is typed** — and on reflection nothing here should invent a grammar to do it with, since the grammar belongs to the debugger. What would help is pushing them into a *running* session automatically, so the adapter's own refusal arrives while you are still looking at the box.
- **The thread list has no filter.** Dozens of goroutines wrap into a wall and most are runtime internals.
- **Only one js-debug child**, so a worker or a spawned process is not followed.
- **debugpy has no launch shape**, and cannot be verified here: there is no real Python on this machine, only the Store alias stubs.
- **The scratch sweep only runs when a test asks for a folder.** A suite that is never run again leaves its last set behind for good — harmless, but it is a sweep on entry rather than a sweep on exit and worth knowing.

## Round 37 — the debugger stops lying about itself

Three things the app was saying that were not true, found by using it rather than by reading it.

### My Feedback

**A breakpoint reported as unset while the program stopped on it.** Nothing is bound until the program actually runs, so the handshake's answer is provisional — js-debug replies `verified: false` with "breakpoint.provisionalBreakpoint" and binds it a moment later. The UI heard the first answer and had no way to hear the second.

**My first fix was wrong, and the real adapter said so.** I invented an event for the child session to report its own `setBreakpoints` result. Running it proved that wrong twice: the child's answer is provisional in exactly the same way — captured verbatim as `verified: false, "breakpoint.provisionalBreakpoint"` — and **DAP already has the mechanism**, a `breakpoint` event sent when a breakpoint's state really changes, which the same run produced as `{"breakpoint":{"line":3,"verified":true,…},"reason":"changed"}`. The invention is gone and the protocol's own event is handled, matched by the `id` the adapter gave when it took the breakpoint — line numbers cannot do it, because *moving* a breakpoint is the other thing this event reports.

**A log point's message and the debugger clearing its throat looked identical.** DAP marks output produced at a known place with a source and a line; an adapter's own chatter carries neither. Captured from a real Delve run:

```
{"category":"console","output":"Type 'dlv help' for list of commands.\n"}
{"category":"stdout","line":8,"source":{"path":"…/main.go"},"output":"…"}
```

So the panel shows `main.go:8` beside messages that claim a location, and the log-point test now asserts the marking is there — the thing the UI relies on is pinned against the real adapter rather than remembered from one run.

**A run that was written into is not a reproduction of anything.** Changing a value silently turns the rest of a session into a story about a program that never ran, and nothing recorded it — so "it does not reproduce" half an hour later had no way of knowing why. The panel states it for the rest of the session. Not a confirmation before the fact: that would be in the way twenty times an hour and clicked through unread. A refused write records nothing, because it changed nothing.

**And the Debug build is what gets debugged.** `built_assembly` picked the most recent, so a `dotnet build -c Release` after a Debug build meant debugging optimised code — lines moved, calls inlined, locals gone. That presents as a debugger stopping on the wrong line and unable to see variables that are plainly there, which reads as this app being broken. Debug now wins however old it is; newest only ever decides between two of the same configuration. Where only Release exists it is still used, with a note saying what to expect.

### Your Feedback

- **The new note field is neither an error nor a capability.** It is something true about what is running that would otherwise be discovered by confusion, and it is deliberately not dressed as an alert — nothing failed, and sending somebody to look for a fault that is not there is its own problem.
- **508 scratch folders in `%TEMP%` became 1.** Three test helpers each left a uniquely named directory behind. Deleting on `Drop` is the obvious answer and the wrong one: a failing test's scratch folder is exactly what you want to look at. They live under one parent now and are swept by a *later* run — six hours, enough to inspect a failure over lunch. Sweeping is forgiving by design, because tidiness must never be why a suite goes red.
- **One piece of debt turned out not to be debt.** I had written down "a hover only works in the file the debugger stopped in" as too strict. It is not: hovering a local called `i` in a *different* file would evaluate the stopped frame's `i` and show a confidently wrong answer. The gate stays.

### Technical Debt

- **Nothing validates a condition, an interpolation, a hit count or a watch as it is typed.** All four read as a breakpoint that never fires until the refusal appears on starting.
- **Restarting a frame does not undo what it did** — a file written or a message sent has still happened — and nothing says so before the press.
- **The thread list has no filter**, and nothing shows what a thread is waiting on.
- **The breakpoint strip is only for the open file**, and is three boxes wide.
- **Only one js-debug child**, and **debugpy has no launch shape** — no real Python here to verify one against.

## Round 36 — the app can sign itself in

### My Feedback

**"Why can't the app kick off OAuth?"** It can, and the comment saying it could not was stale — written before this app grew PTY terminals, and never revisited.

**`--version` was never a health check.** Proved on this machine in one line: `--version said "2.1.227 (Claude Code)"; auth says AuthState { logged_in: false, auth_method: "none" }`. A dead sign-in leaves the version answering perfectly happily, which is why the Test button reported a working provider right up until the first real turn failed. `claude auth status` answers directly, runs no model — so it costs nothing off the plan — and comes back in about a second. A non-zero exit is the signed-out answer rather than a failure; the JSON prints either way.

**And there was now a way to fix it from inside the app.** `open_claude_sign_in` opens a terminal on the Build board and types `claude auth login` into it. **Typed into a shell rather than run as the terminal's own program**, deliberately: the login can then be answered, abandoned and run again in the same panel, and what it printed stays on screen. A PTY that *was* the login would close on the first mistake and take the reason with it.

**The setup panel said, in as many words, that none of this was possible** — "This app cannot check it — proving it would mean spending your allowance every time this page opened." Both halves were wrong. It now has a real state line, a Sign in button, and being signed in counts towards being ready: a provider that is installed, added and first in the chain still cannot run a single turn without it.

### Your Feedback

- **One test asserted the old claim and was right to at the time.** It now asserts the opposite and says why it changed, rather than being quietly deleted.
- **`claude_code_auth` was removed after one commit.** I added it, then folded the sign-in into `claude_code_status` — and two commands answering the same question drift.
- **A doc comment on a Rust function parameter is a compile error**, which I found the direct way. It moved to the function's own doc, where it reads better anyway.

## Round 35 — the app stops accusing models it never reached

### My Feedback

**Five probes returned nothing, and the report said what the model had done wrong.** "The model invented architecture kinds." "Proposed a technology the developer rules forbid." "Invented work from a brief with nothing in it." Nobody had seen it do any of those things — every call had failed before reaching a model. Each probe honestly recorded "no usable answer", and then the suggestions were looked up by **probe name alone**, ignoring why it failed.

**This is the failure the platform exists to prevent, committed by the platform.** A verdict about behaviour needs an answer to have been read. `ProbeResult` now records whether the model answered at all, and only an answered probe can produce a behavioural finding. Declining counts as answering — a model that used the escape hatch on a complete brief has shown its judgement and is judged.

**And the reason was buried.** Claude Code exited non-zero, and that path returned the raw JSON envelope — four hundred characters of `usage` and `session_id` with the useful field in the middle, truncated out of sight as often as not. The envelope's `result` said "Failed to authenticate: OAuth session expired and could not be refreshed", and `read_output` already knew to append the one step that fixes it — but nothing reached `read_output`, because the exit-status branch returned first.

### Your Feedback

- **My first summary was itself repetitive.** It added a sixth copy of a sentence already on all five rows, and put a generic "check it is installed and signed in" checklist beside a message that named the cause *and* the fix. Vague advice next to a specific diagnosis only makes the specific one look less certain. It now says it once when every probe failed identically, and quotes the error only when the failures actually differ.
- **A test's premise was out of date.** It said a failed turn exits 0. The same failure has now been seen exiting both 0 and 1, so the exit status is not the signal — the envelope is, and the comment says so.

## Round 34 — changing a value in a running program

### My Feedback

**The last obviously-missing piece of an ordinary debugger**, and the one with real consequences: the program carries on from here with a value it would never have computed. It is the fastest way to reach a branch you cannot otherwise get to, and the fastest way to convince yourself of something untrue about a real run.

**The assertion is deliberately not "the write succeeded".** Nor "the row now reads 5000" — either would pass against an adapter that acknowledged the write and changed nothing. It is that **a later evaluation of a different expression reflects it**: after setting `tax` to 5000, `subtotal + tax` came to **16810**, which the adapter has to work out afresh and can only reach if the program's own memory really changed.

**Two requests, not one with a fallback.** `setVariable` names a value by its **container and its name**, so it cannot touch `order.Items[0].Price` — nothing holds that under that name. `setExpression` takes the expression itself. Delve reports the first and not the second, so for Go a local can be changed and a watch cannot, and that is a fifth thing the three adapters disagree about.

**Which meant `Variable` had to remember where it came from.** A value read without keeping its `variablesReference` cannot afterwards be set — there is no identifier of its own to name it by. So every variable carries its parent, and an evaluated expression carries zero, which is exactly why it needs the other request.

**Nothing is parsed here.** The new value goes to the adapter in the debuggee's own language — `5000` for an int, `"desk"` with its quotes for a Go string — for the same reason a breakpoint condition is not parsed: the grammar belongs to the debugger. And what comes back is what the value **became**, not what was typed, because an adapter may round, truncate or reformat.

**A write re-reads the frame rather than patching the row.** It can change more than the row it was made on — an aliased pointer, a field two structs away, a watch over the lot — so replacing only that row would leave everything else on screen quietly stale.

### Your Feedback

- **Escape leaves the program exactly as it was**, which is the only safe thing a half-typed value can do, and is tested.
- **One row at a time.** Writing into a running program is not something to be doing in three places at once without noticing.
- **No editing at all where the adapter cannot write.** A value that opened and then refused would be worse than one that never opened.
- **The re-read goes through the frame that is actually selected**, taken out of the stack. My first attempt handed `showFrame` a fabricated frame with `line: 0` — and since that function also tells the workspace where the program is, it would have moved the editor's highlight to a line the program was never on. Caught by the type checker, but it was a real bug and not a typing one.
- **The edit box opens on the current value**, so a small change is a small change rather than a retype.
- **All fifteen real-adapter tests pass.**

### Technical Debt

- **Nothing warns that a write is a write.** Setting a value silently changes a running program, and the UI treats it like editing a text field. A confirmation would be wrong — it would be in the way twenty times an hour — but nothing marks the session as having been interfered with either, so a later "it does not reproduce" has no record of why.
- **A hover only works in the file the debugger stopped in**, and only for a word rather than a selection.
- **The thread list has no filter**, and nothing shows what a thread is waiting on.
- **Restarting a frame does not undo what it did**, and only js-debug can do it at all.
- **Nothing validates a condition, an interpolation, a hit count or a watch as it is typed.**
- **Log output is not marked as coming from a log point.**
- **The breakpoint strip is only for the open file**, and is three boxes wide.
- **debugpy has no launch shape** and cannot be verified here — no real Python on this machine.
- Carried: only one js-debug child; the root's provisional breakpoints reach the UI; `built_assembly` picks the newest build rather than a configured one; the Rust suite leaves scratch directories in `%TEMP%`.

## Round 33 — hover to evaluate

### My Feedback

**Where somebody instinctively looks first.** A name in the editor, under the pointer, while the program is stopped — one request away from what the watch pane already did.

**`context` is not a label.** It is the protocol's word for *why* this is being asked, and it changes the answer rather than annotating it. `"watch"` and `"hover"` both mean a value being displayed rather than a command being run; `"hover"` additionally says "a pointer moved", which is what `supportsEvaluateForHovers` gates. Verified both ways against Delve: **the hover answer had to equal the watch answer** for the same name in the same frame, because a tooltip telling a different story from the pane beside it would be worse than no tooltip.

**A fourth thing the adapters disagree about.** js-debug and Delve answer hovers; netcoredbg does not — it evaluates perfectly well, so the watch pane works there, but it has not said it wants one call per pointer movement. That is refused before it reaches the wire rather than sent and hoped for, and the C# refusal test now asserts it alongside the other two.

**The editor follows the selected frame, not only the stop.** This had to change for hover to be right: picking a caller and hovering a name there is a different question, and evaluating it in the innermost frame would have quietly answered the wrong one. So selecting a frame now moves the highlight to its line as well — which is what selecting it should have meant all along.

**No debugger, no provider.** The hover is registered only when there is something to ask, and only for the open file's language. An editor answering every hover with "no debugger" would be worse than one that stays quiet, and a provider that always returns nothing still costs a round trip through Monaco per pointer movement.

### Your Feedback

- **The provider is disposed when the editor goes.** Monaco's providers belong to a *language*, not to an editor, so one left registered would have a closed file still answering hovers through a callback pointing at a session that has ended.
- **An empty result is treated as nothing.** An adapter answers an unknown name with an empty string rather than an error, and a tooltip reading `total = ` is worse than none.
- **A thrown error is silence too.** Hovering `func` or a comment is not a failure — it is a word that is not an expression, and the editor should say nothing rather than raise anything.
- **The callback is held in a ref**, because the provider is registered once on mount and would otherwise capture the first render's copy and go stale the moment the program stepped.
- **The type is a separate line** in the tooltip, so a long generic does not crowd the value out of the first one.
- **A doc comment on a function parameter is a compile error in Rust** — it moved to the function's own doc, where it reads better anyway.

### Technical Debt

- **Nothing can be changed.** `setVariable` and `setExpression` are both in DAP and both are reported by these adapters, and there is still no way to put a value into a running program. This is the last obviously-missing piece of an ordinary debugger.
- **A hover only works in the file the debugger stopped in.** Open a different file of the same Solution and there is nothing, even though the frame is perfectly evaluable — the gate is stricter than it needs to be.
- **Hovering an expression is not offered, only a word.** Selecting `subtotal + tax` and hovering the selection is what a person would try next.
- **The thread list has no filter**, and nothing shows what a thread is waiting on.
- **Restarting a frame does not undo what it did**, and only js-debug can do it at all.
- **Nothing validates a condition, an interpolation, a hit count or a watch as it is typed.**
- **Log output is not marked as coming from a log point.**
- **The breakpoint strip is only for the open file**, and is three boxes wide.
- **debugpy has no launch shape** and cannot be verified here — no real Python on this machine.
- Carried: only one js-debug child; the root's provisional breakpoints reach the UI; `built_assembly` picks the newest build rather than a configured one; the Rust suite leaves scratch directories in `%TEMP%`.

## Round 32 — watch expressions

### My Feedback

**What the variable list cannot answer.** That list shows what happens to have a name in scope. A watch shows what somebody actually wants to know — `subtotal + tax`, `len(items)`, `order.Customer.Region` — and none of those are variables anywhere, so none can be read off a scope no matter how well it is displayed.

**The test asserts an expression that is not a variable**, deliberately. `subtotal + tax` came back `12995` and `len(items)` came back `2` — a call into the program's own standard library. A "watch" that merely looked names up in the variable list would pass for `subtotal` and fail both of these, which is exactly why the assertion is not `subtotal`.

**Evaluated in the frame, by the adapter, in the program's language.** The same expression against a caller is a different question: verified by evaluating `subtotal + tax` against `main`, where those parameters do not exist, and getting an error — **and then evaluating `tax` in the inner frame again to prove the session was still perfectly usable**. That second half matters more than the first.

**So an out-of-scope watch is an ordinary answer, not a failure.** You set it for a different frame; the message goes on that one row and the other watches are untouched. Each expression is asked for on its own, so one failure cannot blank the pane.

**A watch that comes back a struct opens like any variable**, through the same machinery — because it is the same kind of answer. Only the top row differs: it carries an expression rather than a name, and can hold a problem instead of a value.

**The expression outlasts the session; the answer does not.** The list is per Solution on this machine, like breakpoints, because it is one person's questions about shared code. The values are thrown away the moment the program moves, since a number under an expression that was true one step ago is worse than nothing.

### Your Feedback

- **Worked out on adding, not at the next stop.** The reason somebody types an expression is to see it now — waiting for the next step would make the box feel broken.
- **Order is insertion order, not sorted.** Sorting would move a watch you just added away from where you were looking.
- **A duplicate is refused**: two rows that always agree are noise, and a second request per stop for an answer already on screen.
- **The watches are held in a ref for evaluation**, so typing in the add box does not re-make the callback that fetches variables and cause a re-fetch on every keystroke.
- **`context: "watch"`** is sent rather than `"repl"`, which tells the adapter this is a value being displayed rather than a command being run — side effects avoided where the adapter can avoid them.
- **All fourteen real-adapter tests pass.**

### Technical Debt

- **Nothing can be changed.** `setVariable` and `setExpression` both exist in DAP and both are reported by the adapters here; there is no way to put a value into a running program yet, which is the other half of a watch pane.
- **Hovering a variable in the editor shows nothing.** `evaluate` with `context: "hover"` is the same request this round added, and the editor is where somebody would first reach for it.
- **The thread list has no filter**, and nothing shows what a thread is waiting on.
- **Restarting a frame does not undo what it did**, and only js-debug can do it at all.
- **Nothing validates a condition, an interpolation or a hit count as it is typed** — nor a watch, which now joins them.
- **Log output is not marked as coming from a log point.**
- **The breakpoint strip is only for the open file**, and is three boxes wide.
- **debugpy has no launch shape** and cannot be verified here — no real Python on this machine.
- Carried: only one js-debug child; the root's provisional breakpoints reach the UI; `built_assembly` picks the newest build rather than a configured one; the Rust suite leaves scratch directories in `%TEMP%`.

## Round 31 — every thread, not just the one that stopped

### My Feedback

**The case this exists for is deadlock**, and it is the reason this was the largest remaining gap. The thread that stops is rarely the one holding the lock, so a debugger that only ever showed the stopped thread could not show you the problem at all — the interesting stack belongs to somebody else.

**Verified against Delve, deliberately not racily.** A Go program starts three goroutines that signal a `WaitGroup` *before* parking on a channel nothing sends to, and `main` waits on that group. So by the time the breakpoint is reached all three exist, rather than the test depending on whether the scheduler got round to them. Delve listed them, and — the assertion that matters — **a thread that was not the one that stopped still had frames of its own**.

**"Thread" is the protocol's word, not the runtime's.** Delve reports Go goroutines here, js-debug reports one per execution context, netcoredbg reports real OS threads. All three are the thing you can ask for a stack, so all three go under the protocol's name rather than a translated one that would be wrong for two of them.

**Stepping now acts on the selected thread — and this time it really does.** Last round's finding was that a step cannot be pointed at a frame, because `next`, `stepIn` and `stepOut` carry a `threadId` and nothing else. That same fact is what makes this legitimate: a thread is exactly what a step *can* be aimed at. Pick a thread, step it, and the request goes to that thread.

**The list is read at every stop, never kept.** Threads come and go while a program runs, and DAP's `thread` events are advisory — an adapter is not obliged to send one for every start and exit. A list carried over from the last stop would be offering threads that have since ended.

### Your Feedback

- **No picker for one thread.** A control with a single option cannot do anything, and the ordinary single-threaded case should not grow furniture.
- **The list goes away while the program runs**, for the same reason it is re-read: it is a snapshot of a moment that has passed.
- **"Stopped here" is marked separately from selection.** With every thread stopped, "which one is stopped" is not a useful question — "which one is *why*" is.
- **A thread with no frames clears the pane** rather than leaving the previous thread's stack sitting under this one's name. It is a real answer: a thread that has not started, or has just finished.
- **The threads wrap rather than scroll.** A Go program can have dozens of goroutines, and hiding them behind a scrollbar would put the interesting one out of sight — which is the exact failure this round is fixing.
- **All thirteen real-adapter tests pass.**

### Technical Debt

- **Nothing is watched.** No expression box, so a value not in scope as a named local cannot be looked at. This is now the largest gap.
- **The thread list has no filter.** Dozens of goroutines wrap into a wall; most are runtime internals, and there is no way to say "only mine".
- **Nothing shows what a thread is waiting on.** Delve puts it in the name — `goroutine 17 [chan receive]` — but that is Delve being generous rather than something the app asks for, and the other two adapters say nothing of the sort.
- **Restarting a frame does not undo what it did**, and only js-debug can do it at all.
- **Nothing validates a condition, an interpolation or a hit count as it is typed.**
- **Log output is not marked as coming from a log point.**
- **The breakpoint strip is only for the open file**, and is three boxes wide.
- **debugpy has no launch shape** and cannot be verified here — no real Python on this machine.
- Carried: only one js-debug child; the root's provisional breakpoints reach the UI; `built_assembly` picks the newest build rather than a configured one; the Rust suite leaves scratch directories in `%TEMP%`.

## Round 30 — the frame you select, and the one that gets stepped

### My Feedback

**The debt I had written down was not fixable, and finding that out was the round.** "Stepping does not follow the selected frame" had been carried for four rounds as a thing to build. It cannot be built: DAP's `next`, `stepIn` and `stepOut` carry a `threadId` **and nothing else**. Stepping is a thread operation, so it always acts on the innermost frame however the stack is selected. There is no version of this app that could make it do otherwise.

**So the fix is to say so, in the place where the mismatch is visible.** Select a caller and the panel says: stepping always acts on `inner`, the innermost frame — the debugger steps a thread, not a frame. It names the frame rather than saying "the innermost one", because that is the thing somebody is about to be surprised by.

**And then to offer what DAP *does* give per frame.** `restartFrame` is the only request in the protocol that names a frame, and it is what "do something with the frame I picked" actually means: the program is put back at the start of that call. Verified against js-debug — stopped deep inside `inner`, restarting `outer` put the program back at the top of `outer` with `inner` gone off the stack entirely. **The assertion is that it went backwards**, which is the only thing that distinguishes this from any other resume.

**Gated twice, because there are two different reasons it might not work.** The adapter-wide `supportsRestartFrame` — js-debug reports it; Delve and netcoredbg do not — and DAP's per-frame `canRestart`, because a runtime or native frame is on the stack and cannot be restarted even where its neighbours can. Either being false means no button rather than a button that fails.

### Your Feedback

- **Not offered on the innermost frame.** Restarting the call you are already in is "step out and step back in", which the step controls already do — and it would be the one place the button looked like it was about the selection when it was not.
- **The restart is not treated as a resume.** The adapter answers with a fresh `stopped`, so the highlight and the stack are replaced by that event rather than guessed at optimistically.
- **The per-frame button sits under its frame, not inside it.** The frame row is already a button — the one that selects it — and a button inside a button is not a thing.
- **`canRestart` defaults to true**, per DAP: an absent field means "assume yes if the adapter supports it at all", so the capability is the outer gate and the field only ever narrows it.
- **All twelve real-adapter tests pass**, one of them new.

### Technical Debt

- **Restarting a frame does not undo what it did.** The stack is rewound; a file that was written, a row that was inserted and a message that was sent have all still happened. That is inherent to `restartFrame` rather than a gap here, but it is worth a word in the UI that is not there yet.
- **Only js-debug can do it**, so for two of the three languages selecting a frame still does nothing but show its variables.
- **Still one thread.** This is now the largest remaining gap: every session shows the thread that stopped, and a deadlock is exactly the case where the others matter.
- **Nothing is watched** — no expression box, so a value not in scope as a named local cannot be looked at.
- **Nothing validates a condition, an interpolation or a hit count as it is typed.**
- **Log output is not marked as coming from a log point.**
- **The breakpoint strip is only for the open file**, and is now three boxes wide.
- **debugpy has no launch shape** and cannot be verified here — no real Python on this machine.
- Carried: only one js-debug child; the root's provisional breakpoints reach the UI; `built_assembly` picks the newest build rather than a configured one; the Rust suite leaves scratch directories in `%TEMP%`.

## Round 29 — hit counts, and the first real difference between the adapters

### My Feedback

**The triple is finished**: a condition, a message, and now a hit count on every breakpoint. The hit count is the one a condition cannot express — "stop the seventh time this line is reached" needs no variable to test against, and works on a line where nothing in scope counts the iterations.

**The interesting finding is that the adapters differ, and I read their answers rather than assuming.** Writing the test against Delve failed on the capability assertion, so I probed all three:

| | conditions | log points | hit counts |
|---|---|---|---|
| js-debug | ✅ | ✅ | ✅ |
| Delve | ✅ | ✅ | ❌ |
| netcoredbg | ✅ | ❌ | ❌ |

So the hit-count test runs against **js-debug**, and it stopped on the seventh hit — `i == 6`, because the hit count is one-based and the loop counter is not. That off-by-one is exactly what the assertion pins down.

**The refusal path is now verified against an adapter that really cannot do it.** netcoredbg reports neither log points nor hit counts, which makes it the proof that holding a breakpoint back is real rather than a branch nothing reaches: both extras were refused with the reason named, and **nothing was armed** — no stop arrived in twenty seconds. That last assertion is the point. DAP has no failure for an unsupported extra; the field is ignored, so a log message sent anyway becomes an ordinary breakpoint and **stops**, which is the opposite of what was asked for.

**The grammar belongs to the adapter, not to this app.** js-debug takes `7`; Delve takes `== 7`. DAP says only that `hitCondition` is something the adapter understands. So it is passed through verbatim and the debugger's own complaint is what a person sees, rather than this app inventing a grammar and being wrong for one of them.

**The Debuggers panel now reports all three**, and says the absences plainly: "No log points or hit counts, so a breakpoint using that is held back rather than armed plain." That is the round-27 mismatch again — a capability the app now uses, and a panel that was still only reporting two of them.

### Your Feedback

- **The probe was temporary and was removed.** It existed to read the three capability replies; the answers are in the table above and in the module note, so keeping a test that only prints would have been keeping a thing nobody would run again.
- **The store has grown three times**, so the load defaults every field individually. There is now a test per intermediate shape — bare line numbers, line-plus-condition, and line-plus-condition-plus-message — because each is a real thing to find on somebody's machine.
- **The hit-count box is narrower than the others** on purpose: it holds a number or a short comparison, and equal width would crowd out the message.
- **All eleven real-adapter tests pass**, two of them new.

### Technical Debt

- **The breakpoint triple is done, and the UI is now three boxes wide.** It works, but a row of `line 8 | condition | hits | message` is dense, and a breakpoint list for the whole Solution would be a better home for it than a strip above one file.
- **Nothing validates any of the three as it is typed.** A bad condition, a bad interpolation and a bad hit-count grammar all read as a breakpoint that never fires until the refusal appears on starting.
- **Log output is not marked as coming from a log point**, so a message and the program's own output look alike in the panel.
- **Conditions, counts and messages are only editable in the open file.**
- **Still one thread**; **stepping does not follow the selected frame**; **nothing is watched**.
- **debugpy has no launch shape** and cannot be verified here — no real Python on this machine.
- Carried: only one js-debug child; the root's provisional breakpoints reach the UI; `built_assembly` picks the newest build rather than a configured one; the Rust suite leaves scratch directories in `%TEMP%`.

## Round 28 — log points

### My Feedback

**The feature that removes a rebuild.** A message on a breakpoint makes the line print and carry on instead of stopping — the `println` you would otherwise add, without the edit, the rebuild or the tidying up afterwards. `{expr}` inside it is evaluated in the running program.

**The assertion is the *absence* of a stop.** Verified against Delve on a Go loop of three with `round {i}` on the line inside it: three messages, `round 0`/`1`/`2`, and the program ran to `terminated` without ever stopping. A log point accidentally sent as a plain breakpoint would stop on the first iteration — and a test that only checked "the message was printed" would not catch it, because the message arrives either way. So the test fails on the first `stopped` it sees.

**A dropped `logMessage` is worse than a dropped condition**, which is why it is refused the same way. DAP has no failure for either: an adapter that lacks the capability just ignores the field. A dropped condition stops *every* time; a dropped log message **stops**, at a breakpoint whose whole purpose was not to. So `supportsLogPoints` is read from `initialize` and the breakpoint is held back with a message saying which thing the debugger cannot do.

**A log point gets its own glyph** — hollow, in the neutral colour rather than the alarming one. A mark that looks like a breakpoint and never stops reads as a debugger that is broken, and the gutter is the only place the difference is visible before the program runs.

**`Honours` replaced two loose `bool`s.** Conditions and log points are read together, passed together, and would be swapped sooner or later if they were ever passed positionally.

### Your Feedback

- **The store has grown twice now**, so fields are defaulted one at a time rather than by shape: a mark written between the two versions — a line and a condition, no message — is a real thing to find on somebody's machine, and it loads.
- **Clearing a message turns a log point back into an ordinary breakpoint** rather than removing it. It is the same mark in the gutter either way.
- **The condition box changes what it promises** when a message is set: "log every time" rather than "stop every time", because the line no longer stops at all.
- **One assertion was wrong and was removed rather than weakened.** The test also checked the program's own `fmt.Println` output arrived — it does not: Delve gives the debuggee its own console rather than relaying it as DAP `output`. `terminated` already says the program reached the end, without ambiguity.
- **`{` is userEvent's keyboard syntax**, so typing `round {i}` in a test types a key called `i`. Escaped as `{{`, with a note, because the next person will hit it too.
- **All nine real-adapter tests pass** — `setBreakpoints` changed again, and it is the one request all three debuggers depend on.

### Technical Debt

- **No hit counts.** `hitCondition` rides on the same request as the two fields now sent, and "stop the 500th time" is the one of the three this app still cannot express.
- **A bad message is only found on starting**, same as a bad condition: nothing checks the interpolation as it is typed.
- **Log output is not marked as coming from a log point.** It arrives in the debugger panel mixed in with everything else the adapter says, so a message and a program's own output look alike.
- **Conditions and messages are only editable in the open file.** There is still no list of every breakpoint in the Solution.
- **Still one thread**; **stepping does not follow the selected frame**; **nothing is watched**.
- **debugpy has no launch shape** and cannot be verified here — no real Python on this machine.
- Carried: only one js-debug child; the root's provisional breakpoints reach the UI; `built_assembly` picks the newest build rather than a configured one; the Rust suite leaves scratch directories in `%TEMP%`.

## Round 27 — conditional breakpoints

### My Feedback

**The mismatch this closes.** The Debuggers panel already reported that every adapter here supports conditional breakpoints, and there was nowhere to set one — a capability displayed and not offered. Each breakpoint in the open file now gets a condition box under the header.

**The assertion that matters is not "it stopped" but which iteration it stopped on.** A Go loop of ten with `i == 7` on the breakpoint stopped once, at `i == 7`, with `total == 21` — 0+1+…+6, so the six earlier iterations really did run through. A dropped condition would have stopped at `i == 0`, and a test that only checked "it stopped somewhere" would have passed either way.

**A condition an adapter cannot evaluate holds its breakpoint back rather than arming it.** DAP has no failure here: an adapter that does not support conditions simply ignores the field and stops **every** time — the opposite of what was asked for. So the capability is read from `initialize`, and a conditional breakpoint aimed at an adapter without it is not sent at all, and comes back as a refusal saying why and what to do about it. The file is still sent, empty if need be, because `setBreakpoints` replaces a file's whole set and an unsent file keeps whatever was last armed.

**A refusal now carries the adapter's own words.** "3 could not be set" is not an answer; "this debugger cannot evaluate breakpoint conditions, so this breakpoint was not set — clearing the condition would arm it" is.

**The stored shape changed, so it migrates.** Breakpoints were a bare list of line numbers per file and are now a line plus a condition. The old shape is read and converted on load rather than discarded — somebody's marks are not worth losing over a shape change, and being per machine there is nowhere else to migrate them.

### Your Feedback

- **The condition box says whose language it is in.** The adapter evaluates the expression inside the running program, so a Go Solution takes a Go expression — not JavaScript, and not anything this app parses. Saying so beats letting somebody find out.
- **Clearing a condition keeps the breakpoint.** "Stop every time" and "stop caring" are different intentions and the box only expresses the first.
- **A condition on a line with no breakpoint returns the store unchanged**, rather than inventing a breakpoint to hang it on.
- **The strip appears only when the file has a breakpoint.** An always-present empty panel would be a control with nothing to act on.
- **The capability is said once per session too**, on starting, because that is the only moment the adapter's own answer is known — the boxes in the editor are there whether or not a session exists.
- **Every one of the eight real-adapter tests still passes**, which was the point of having them: `setBreakpoints` changed shape and it is the one request all three debuggers depend on.

### Technical Debt

- **No hit counts and no log points.** DAP carries `hitCondition` and `logMessage` on the same request that now carries `condition`, and neither is offered — a log point in particular is the thing that saves a rebuild.
- **A bad condition is only found on starting.** Nothing checks the expression as it is typed, so a typo reads as a breakpoint that never hits until the refusal appears.
- **Conditions are only editable in the open file.** There is no list of every breakpoint in the Solution, so one set in a file since closed can only be changed by opening it again.
- **Still one thread**; **stepping does not follow the selected frame**; **nothing is watched**.
- **debugpy has no launch shape** and cannot be verified here — no real Python on this machine.
- Carried: only one js-debug child; the root's provisional breakpoints reach the UI; `built_assembly` picks the newest build rather than a configured one; the Rust suite leaves scratch directories in `%TEMP%`.

## Round 26 — variables open

### My Feedback

**A struct opens now.** The flat list was never the interesting half: a stop showed `order` as `main.Order {...}` and said "has fields" beside it, which is a label where a control belonged. Verified against Delve with a real struct — `order` opened to `Subtotal = 11810` and `Tax = 1185` read out of the live process.

**Levels are fetched one at a time, on opening.** A `variablesReference` is a handle to something the adapter has not sent, so walking them eagerly means reading the whole object graph on every stop: a linked list would be followed to its end and a cyclic one would never finish.

**Every handle dies when the program moves**, so an expansion left open across a step would redraw memory that has since been reused, under the old name. Opening state is cleared on `continued`, on the program ending, and on selecting a different frame — and the fields are re-fetched on the next opening rather than cached.

**Rows are keyed by path, not by the adapter's reference number.** Two variables can hold the same reference once the program has moved, and keying on it would open the wrong row. The index is in the path too, because an array's elements share a name and duplicate keys would collapse them into one row.

**A scalar gets no caret.** "has fields" was replaced by a control that does something, and a variable with nothing inside keeps the column for alignment without offering a click that would fail.

### Your Feedback

- **`expand(0)` is an error, not a request.** A zero reference is not a handle, so asking is a caller bug and is refused here rather than sent to the adapter to be refused there.
- **The scope read and the expansion are the same DAP request** against a different handle, so they share one `read_variables` rather than two copies that would drift.
- **A failed expansion says why, on the row it failed on.** Drawing an empty struct instead would read as "it has no fields", which is a different and wrong claim.
- **The caret turns before the fields arrive**, so a slow adapter does not read as a click that did nothing.
- **Closing a row drops everything nested under it**, or reopening would show the children of a row that has since been refetched.
- **The stale `launch_arguments` doc comment saying "Go only, for now" was fixed** — it had been wrong since round 24 and wrong again since round 25.

### Technical Debt

- **Still one thread.** Every session shows the thread that stopped; a deadlock is exactly the case where the others matter, and exactly the case this cannot show.
- **No conditional breakpoints**, though the adapters report supporting them and `debug_check` already displays that they do — a capability shown and not offered.
- **Stepping does not follow the selected frame.** Clicking a caller and stepping steps the innermost frame, which is not what the selection implies.
- **Nothing is watched.** There is no expression box, so a value not in scope as a named local cannot be looked at.
- **debugpy has no launch shape** and cannot be verified here — no real Python on this machine.
- Carried: only one js-debug child; the root's provisional breakpoints reach the UI; `built_assembly` picks the newest build rather than a configured one; the Rust suite leaves scratch directories in `%TEMP%`.

## Round 25 — C# debugs, and the stdio pipe stops hanging

### My Feedback

**A breakpoint stops a real C# program.** Same bar as Go and TypeScript: a scratch console app, `dotnet build`, a breakpoint on `int total = subtotal + tax;`, and an assertion that it stopped on that line with `subtotal = 11810` and `tax = 1185` read out of the live process. **Three of four languages debug for real now.**

**The stdio hang from round 24's debt is fixed, and it had to be fixed first.** A pipe has no `set_read_timeout`, so the socket poll added for js-debug covered TCP only — an adapter that simply went quiet blocked the calling thread forever with its deadline unreachable. The reader moved to its own thread handing chunks back over a channel, so the wait is a `recv_timeout` the deadline can win. One shape for both transports rather than a socket-only special case. netcoredbg is the first stdio adapter driven end to end, so it is what proves that fix rather than only asserting it.

**netcoredbg, not vsdbg.** Microsoft's `vsdbg` is the better debugger and its licence permits use only from Visual Studio and VS Code, so driving it from here would be a licence breach. Samsung's netcoredbg is MIT and speaks the same protocol.

**C# is the first language whose launch target is not source.** Delve is handed a folder and compiles it; js-debug is handed a `.js` and runs it; netcoredbg is handed a **built `.dll`** that has to exist already. Finding it is less obvious than it looks — `obj/` holds intermediate assemblies, `ref/` and `refint/` hold reference assemblies with no code in them at all, and the output folder holds every dependency. The signal used is a sibling **`.runtimeconfig.json`**, which the SDK writes only for an assembly meant to be executed. Matching on the folder name would break the moment a project is named differently from its directory.

**Nothing built is a real state and is said plainly** — "run `dotnet build` there first" — rather than starting a debugger against a file that is not there.

### Your Feedback

- **It passed first try**, which is worth noting only because the two before it did not: the two-session work for js-debug and the reader-thread fix had already absorbed the problems netcoredbg would otherwise have surfaced.
- **The extraction path caught the same trap as js-debug.** The release zip contains a `netcoredbg/` folder, so unpacking it into `~/.netcoredbg` — the obvious thing, and what this app suggests — nests it once. Discovery looks in both, as it already did for the js-debug tarball.
- **The install string the app shows was wrong before it was ever used**, in the same way `@vscode/js-debug` was: it said "put it on PATH" with no source. It now names the release zip and the folder to extract to.
- **`built_assembly` has five unit tests and no adapter**, because every failure mode is a filesystem shape — an unbuilt project, an `obj/` tree, dependencies beside the program, two target frameworks. Those are cheap to test properly and expensive to debug through a live debugger.
- **The netcoredbg handshake gets its own test** beyond the breakpoint one, because it is the first stdio adapter here and so it is the regression guard for the pump.

### Technical Debt

- **debugpy is the last one, and it cannot be verified here.** There is no real Python on this machine — `python.exe` on PATH is a Microsoft Store alias stub that prints "Python was not found". Building a launch shape for it would be unverifiable, which is the position js-debug was in before it was installed and the reason nothing was built for it then either.
- **C# is only launched, never attached.** A running ASP.NET process cannot be debugged; `attach` is a different request shape and untested here.
- **`built_assembly` picks the newest build, not the configured one.** A project built in Release after Debug will be debugged in Release, where the optimiser moves lines around and variables vanish. There is no configuration picker yet.
- Carried: variables do not expand; one thread only; no conditional breakpoints; stepping does not follow the selected frame; only one js-debug child; the root's provisional breakpoints are reported to the UI.

## Round 24 — TypeScript debugs, and a session becomes two connections

### My Feedback

**A breakpoint stops a real Node program.** Verified the way Go was: a scratch program, a breakpoint in the middle of it, and an assertion that it stopped on that line with `subtotal = 11810` read out of the live process. Nothing weaker would prove it.

**`Live` is built around a `Channel` now** — one DAP connection, with its own `seq`, its own pending-request map and its own `initialized` flag. Delve gets one and never grows a second, because it never sends a reverse request. js-debug gets two, and `Core::talker()` routes every request about the running program to the child once one exists.

**Three things that fall out of the two-session model and are each easy to get wrong:**

1. **Every reverse request is answered**, not only `startDebugging`. An unanswered one leaves js-debug waiting forever, which presents as a program that never starts.
2. **`supportsStartDebuggingRequest` must be declared in `initialize`.** Without it js-debug never offers the child, and the program runs with nothing watching it — no error, just a breakpoint that never hits.
3. **The breakpoints are kept on the session** so the child's handshake can re-send them. The root's copy comes back `verified: false` ("provisionalBreakpoint") and only becomes real when the child claims it.

**Only the root closing ends the session.** A child ending is one program finishing, which `terminated` has already reported — treating it as the end would have made every completed run look like a crashed adapter.

### Your Feedback

- **Both Delve tests still pass**, which was the point of having them: this refactor touched every path, and the Go debugger is the one that already worked.
- **The child is registered as `active` before its handshake**, not after — a `stopped` arriving mid-handshake must be answerable against the right connection.
- **The `configure_and_launch` sequence is shared** between root and child rather than written twice. It is the part of DAP that is easiest to get subtly wrong, and two copies would drift.
- **Committing first was worth it.** Rounds 22–23 went onto `debug-adapter-protocol` as two commits before this refactor started, so the working Go debugger had a known-good point to return to.
- **Clippy's `type_complexity` lint caught two real readability problems** — the wired-connection tuple and the event sink are named types now.

### Technical Debt

- **debugpy and netcoredbg still have no launch shape**, and neither is installed here, so building one would be unverifiable — the same position js-debug was in before it was installed.
- **The stdio transport still has no read timeout.** Only TCP got one; a pipe has no `set_read_timeout`, so a silent stdio adapter can still hang. Both remaining languages are stdio, so this must be fixed before either lands.
- **Only one child.** js-debug can nest further sessions (a worker, a child process); the second `startDebugging` would replace the first as `active`.
- **The root's provisional breakpoints are reported to the UI**, so a TypeScript session briefly says a breakpoint could not be verified when it simply has not been claimed yet.
- Carried: variables do not expand; one thread only; no conditional breakpoints; stepping does not follow the selected frame.

## Round 23 — js-debug: four bugs found by actually talking to it

### My Feedback

**Installing it found the first bug immediately.** `npm install -g @vscode/js-debug` returns a **404** — that package does not exist, and it is what the app's own Debuggers panel told people to run. js-debug ships as a GitHub release tarball (`js-debug-dap-vX.Y.Z.tar.gz`) and inside the VS Code extension. Discovery now looks in both, scanning the versioned `ms-vscode.js-debug-<version>` extension folders and preferring the newest, and knows the tarball nests a `js-debug/` folder when unpacked.

**Then three bugs that only a real conversation could have found:**

1. **js-debug binds `::1` and nothing else.** Delve is told `--listen=127.0.0.1:PORT` and binds IPv4; js-debug binds IPv6 loopback. Connecting to `127.0.0.1` got "actively refused", which reads exactly like an adapter that failed to start. Both are tried now, from one shared `loopbacks` helper.
2. **A blocking read could never time out.** `read_message` checked its deadline *between* reads, but the read itself blocks until something arrives — so an adapter that simply goes quiet hung the client forever, with the timeout unreachable. The socket has a 250ms poll timeout now and a timed-out read means "nothing yet", not failure.
3. **js-debug never answers `disconnect`.** Waiting for that reply hung shutdown. It is sent and not awaited; killing the child is what actually ends it.

**(2) and (3) also protected Go** — that path was one silent adapter away from the same hang, and both Delve tests still pass.

**js-debug's handshake is verified end to end.** Its launch is not wired, and now for a documented reason.

### Your Feedback

- **The launch model is a capture, not a reading of the spec.** js-debug answers `launch` with a **`startDebugging` reverse request**; the client must reply and open a **second connection** to the same port, and the child session is where `stopped` arrives. A breakpoint set on the root comes back `verified: false` ("breakpoint.provisionalBreakpoint") until the child claims it. That sequence is written into `live.rs` so the next round implements a known thing rather than a guessed one.
- **I stopped short of wiring it deliberately.** It needs reverse-request dispatch and request routing to a child channel — a real refactor of `Live`, at the end of a very long turn, around the one debugger that currently works. Half a refactor there would have been worse than none.
- **The install instruction being wrong is the kind of bug this project cares about**: an app that confidently tells you to run a command that 404s is worse than one that says it does not know how.
- **js-debug was downloaded and left on the machine** at `~/.js-debug` (1.2 MB). `Remove-Item -Recurse ~/.js-debug` removes it; discovery then reports TypeScript unavailable again, correctly.

### Technical Debt

- **js-debug launch: reverse requests and the child session.** The whole of what is left for TypeScript, now fully specified in the module note.
- **`Live` has one channel.** A child session needs request routing — `stackTrace` and every step must go to the child, not the root.
- **debugpy and netcoredbg still have no launch shape**, and neither is installed here to verify against.
- **The stdio transport has no read timeout** — only TCP got one, because a pipe has no `set_read_timeout`. A silent stdio adapter can still hang; it needs a reader thread with a channel.
- Carried: variables do not expand; one thread only; no conditional breakpoints; stepping does not follow the selected frame.

## Round 22 — The stopped line, and where the controls had to go

### My Feedback

**A stop opens its file and highlights the line** — a band across it and an arrow in the glyph margin, scrolled into view if it was off screen. Amber, matching every other "stopped" in this app: green would read as "fine", and this is the state you are meant to act on.

**The stepping controls had to move.** Opening the file replaces the Debug board with the editor, and a debugger whose Continue button disappears at the moment it stops is no use at all. `DebugToolbar` sits above the middle pane instead, which is where every editor puts it and for the same reason. It exists only while stopped — a toolbar that is always present with everything greyed out is furniture.

**`relativeTo` is the inverse of what breakpoints send.** An adapter reports where it stopped as an absolute path; the editor works in repository-relative ones. Separators are normalised and case is folded **only on Windows** — folding a POSIX path would match two genuinely different files, and there is a test for exactly that.

**Two decoration sets, not one.** `deltaDecorations` replaces whichever set it is handed, so sharing one between the breakpoints and the stopped line would clear the dots every time the program stepped.

### Your Feedback

- **A frame the working copy does not contain resolves to nothing, on purpose.** The Go runtime, a dependency under `GOPATH`: real frames at real paths that no Solution here can open. The toolbar still appears and the stack still lists the frame; no file is opened and nothing is highlighted. Guessing at a file would be worse than showing none, and `C:/repos/orders-api` is not inside `C:/repos/orders` however similar the prefix looks — also tested.
- **The highlight clears before the step is sent, not after it answers.** The program is already moving by the time the adapter replies, and an arrow left on the old line for that gap points at somewhere it no longer is. `resume` in the panel does the same, because not every adapter sends `continued` for a step.
- **The callbacks are held in refs.** The event listener is registered once; a parent re-render would otherwise leave it calling a stale copy — the same reason the session id is a ref.
- **The shell died mid-round.** Every command, including `node --version`, returned exit 107 with no output for several minutes. It recovered and the full gates ran clean; worth knowing it can happen, and worth not reporting a round as verified in the window where it cannot be.

### Technical Debt

- **The highlight only reaches a file the workspace can open.** A stop in a dependency shows in the stack and nowhere else.
- **Stepping does not follow the frame you select.** Clicking a lower frame shows its variables but does not move the highlight to it.
- **The toolbar names the innermost frame only**, so a stop deep in a call chain says the least useful name of the ones available.
- **Nothing scrolls the file if it was already open at another line** beyond Monaco's reveal-if-outside-viewport, which does nothing when the line is technically visible but at the very edge.
- Carried: js-debug, debugpy and netcoredbg have no launch shape; variables do not expand; one thread only; no conditional breakpoints.

## Round 21 — The stepping UI: stop, look, step

### My Feedback

**`DebugSession` sits inside the process card** for the Solution it debugs. Running something and stopping it mid-line are two questions about the same repository, and separating them would mean two places to find one program.

**Everything hangs off `stopped`.** The event names a thread → the thread gives a stack → the innermost frame gives the variables. Nothing polls: an adapter says when it has stopped and says nothing in between, so asking repeatedly would only be a way to be wrong between answers.

**Continue / over / into / out, and only while stopped.** A step control on a running program has nothing to step, so it is disabled rather than sending a request the adapter would refuse.

**Sync breakpoints** pushes the gutter's current set into the live session. A breakpoint set mid-run that only took effect on the next run would be worse than one that did nothing at all, because you would believe it.

**Which language a Solution debugs as is a guess, and says so.** `Solution.language` is explicitly "a record of what it was begun as, not a claim about what it is now", so `debugLanguageOf` reads it and the panel names the language it is offering. Only Go's launch is built, so the button is disabled for the rest with the reason beside it.

### Your Feedback

- **The event listener reads the session id from a ref, not from the closure.** Registered once, it would otherwise capture the id from the render that created it and stop recognising its own session the moment a second one started. There is a test that a second session's events are ignored.
- **A frame with no source is still a frame.** Runtime internals get "no source" rather than being filtered out — a stack that hides them lies about how the program got there.
- **Variables report `has fields` rather than a caret.** Children are counted by the adapter but expansion is not built, and a disclosure triangle that does nothing is the failure this whole sequence has been avoiding.
- **Leaving the panel ends the session.** A debugger and the program under it are two real processes; unlike Debug's shells, nobody asked for these to outlive the pane.
- **The Solution bar's Debug chip had to be renamed.** The board it opens now holds a "Debug <solution>" button per card, and two controls reading as "Debug" is ambiguous by label — it is "Open the Debug board" now.
- **The `act()` warnings were fixed rather than tolerated.** Adapter events are state updates from outside React; wrapping them keeps the run clean so a real warning is visible later.

### Technical Debt

- **js-debug, debugpy and netcoredbg still have no launch shape** — js-debug's server/child lifecycle is the substantial one.
- **Variables do not expand**, so a struct, slice or map shows as its summary only.
- **One thread only.** `stopped` names a thread and the stack is fetched for it; two threads stopping at once is not modelled.
- **The editor does not sync breakpoints by itself** — the panel has a button, but toggling a dot mid-session does not push on its own.
- **No conditional or hit-count breakpoints**, though the capabilities are read.
- **The stop is not shown in the editor.** The stack names the file and line; nothing highlights it in the open buffer or opens the file if it is not showing.
- **No test drives the real UI against a real adapter** — the panel is tested against emitted events, and Delve is tested from Rust; nothing joins the two.

## Round 20 — A breakpoint that really stops a Go program

### My Feedback

**`debug/live.rs` replaces the handshake shape with a real one.** Round 19's `Session` sends one thing and waits for its answer; a running session cannot work that way, because the interesting half is **unsolicited** — `stopped` when a breakpoint hits, `output` whenever the program prints, `terminated` when it ends. So: one reader thread, a map of outstanding requests keyed by `seq`, and a sink for everything that is not a reply.

**The launch sequence is the protocol's, not a preference**, and getting it wrong is the classic way a debugger appears to work and never stops anywhere:

1. `initialize` → capabilities back, then an `initialized` **event** when it is ready for configuration.
2. `launch` — **sent, not awaited**; several adapters do not answer it until configuration is done, so waiting in place deadlocks.
3. On `initialized`: `setBreakpoints` per file, then `configurationDone`.

Breakpoints set before `initialized` are dropped on the floor by most adapters, silently.

**Proved end to end.** The integration test writes a small Go program, sets a breakpoint on `total := subtotal + tax`, and asserts the program stopped on that line with `subtotal == 11810` and `tax == 1185` read out of the live process. Nothing weaker proves it: a debugger that never stops looks identical to one nobody asked to.

**In the editor, the gutter.** A click in Monaco's glyph margin toggles a breakpoint, drawn as the dot everybody already recognises. Stored per machine in localStorage by the same rule as the map's layout — a breakpoint is one person's way of looking at shared code.

### Your Feedback

- **I wrote a deadlock and it cost a ten-minute hang.** `send()` took the writer's mutex and then took it again inside `and_then` to flush — a non-reentrant mutex against itself. Delve started, nothing was ever sent, and it presented exactly as "the adapter will not answer". One guard, taken once, and a comment saying why. The stale test binary then held the linker's output file, which is the second thing to kill when a hung integration test blocks a rebuild.
- **`setBreakpoints` replaces a file's whole set**, so the store deletes a file's entry when its last line goes rather than leaving `[]`. "This file, with none" and "this file, unmentioned" are different messages to an adapter, and only the first clears it. It has its own test.
- **Absolute paths, always.** An adapter matches against what the compiler recorded. A repository-relative path matches nothing and the program runs straight past — no error, just silence.
- **Breakpoints are reported back where they landed.** An adapter slides one to the next executable line; showing the requested line instead would be a lie about where the program will stop.
- **Go launches, the other three do not.** They are found and they speak DAP — that was round 19 — but a launch shape is per adapter, and js-debug's especially: it is a *server* that spawns a child adapter per session, which is a different lifecycle rather than different arguments. `launch_arguments` says so by name rather than starting something that never stops.

### Technical Debt

- **js-debug, debugpy and netcoredbg have no launch shape.** js-debug needs its server/child lifecycle; the other two need their argument sets.
- **No stepping UI.** The commands exist and are tested from Rust; nothing in the window drives them yet, so the gutter records intent that only a `debug_start` would act on.
- **Breakpoints are not sent to a running session on change** — `debug_set_breakpoints` exists, the editor does not call it.
- **`variables` does not expand.** Children are counted and reported but a struct cannot be opened.
- **Only one thread is handled.** `stopped` names a thread and the stack is fetched for it; a program stopping on two threads at once is not modelled.
- **No conditional or function breakpoints**, though the capabilities are read.
- **The Go integration test needs Delve and a Go toolchain**, so it is `#[ignore]`d and CI does not run it. The wire, discovery and breakpoint-store tests do run.

## Round 19 — DAP: the wire, the search, and a real handshake with Delve

### My Feedback

**Three pieces, all landed and tested.**

`debug/wire.rs` — the envelope, and nothing else. `Content-Length` framing, **counted in bytes**: a body containing `C:/répertoire/naïve.ts` has a byte length larger than its character count, and a decoder that counts characters takes the wrong number of bytes and then every message after it is misaligned. That is a permanent desynchronisation from one accent, and it has its own test. Decoding is written as "take one whole message out of a buffer if there is one", because a read is not a message: pipes hand over half a message, or three.

`debug/adapters.rs` — four languages, found by **running** each candidate. On this machine `python.exe` is on PATH and prints "Python was not found" — it is the Store alias stub. PATH would have called Python available and the first breakpoint would have been the discovery. Extensions are tried before the bare name for the npm shell-script-vs-`.exe` reason this repo has hit before.

`debug/session.rs` — starting an adapter over **either transport** (Delve and js-debug listen on a port; debugpy and netcoredbg use stdio) and completing `initialize`.

**Verified against a real debugger.** Delve 1.25.2 is genuinely installed here, and the ignored-by-default test starts it, handshakes, and asserts `configurationDone`. That is the whole foundation proved against something not written here.

**netcoredbg, not vsdbg**, for C#. vsdbg is the better debugger and its licence permits use only from Visual Studio and VS Code, so driving it from this app would be a breach.

### Your Feedback

- **Breakpoints are not built, and the gutter stays unclickable.** You asked for DAP knowing it was a round of its own; this is the round that makes the next one plumbing rather than new ground. Shipping a gutter now would have been the exact failure the last five rounds avoided.
- **`debug_check` exists because finding is not proving.** A binary that runs is not necessarily one that speaks the protocol — the button starts the adapter and completes a handshake, so "this machine can debug Go" is demonstrated rather than inferred.
- **`argv` is separate from `program`.** My first cut had one display string and the Delve test split it back apart — which failed immediately, on a path with no spaces in it, exactly as it would have failed later on one with spaces. The struct carries both now: one to read, one to run.
- **Clippy's dead-code gate did real work.** It rejected `PROBE_TIMEOUT` (premature), `LANGUAGES` (existed only for its own test) and `Capabilities.raw`. The first two went; the third is surfaced to the UI instead, because what an adapter says about itself is the answer to "why will it not do X?" long before this app models the flag.
- **On this machine, only Go is ready.** Node is here but js-debug is not; there is no runnable Python; dotnet is here but netcoredbg is not. The panel says so per language with the install command, which is the honest state rather than an empty list.

### Technical Debt

- **No launch, breakpoints, stepping, stack or variables.** Next round: `setBreakpoints`, `launch`/`attach`, `configurationDone`, then `stopped` events and `stackTrace`/`scopes`/`variables`.
- **`wait_for_response` discards events**, which is right for a handshake and wrong the moment a session runs — it becomes a queue.
- **The session is synchronous and blocking**, on a spawned thread per call. Real sessions need one reader thread and a channel, like the terminals have.
- **`free_port` is racy in principle** — bound, released, then handed to the adapter.
- **js-debug's launch shape is unimplemented.** It is a *server* that spawns per-session children, so it needs more than the single-session model here.
- **Nothing is cached.** Every `debug_adapters` call re-probes, which is several child processes.
- **The ignored Delve test does not run in CI**, which has no Go toolchain; the wire and discovery tests do.

## Round 18 — The process registry, one Files pane, and what Admin can now answer

### My Feedback

**The registry was half-built already and nobody could see it.** `Terminals` is Tauri-managed state that lives for the life of the app, so the shells never actually belonged to the window — but there was no way to *ask* what was in it, so `TerminalPanel`'s unmount had no option but `close_terminal`. Two commands close that: `list_terminals` (which also prunes shells that ended on their own — the only place that notices `exit` with no window watching) and `attach_terminal`.

**The replay buffer is the part worth arguing about.** A reattached dev server that has been up an hour would otherwise open on an empty box, which reads exactly like a shell that failed. So each session keeps a **bounded 64 KiB in-memory tail**, handed over on attach. The page brief's rule — terminal output is never persisted — still holds: this is in memory, capped, and dies with the process, precisely as the xterm widget's own scrollback used to. What changed is only *which* thing it dies with.

**`TerminalPanel` gained `keepAlive` and `adoptId`.** Debug sets both; the Code tab sets neither, so a terminal nobody asked to keep is still closed with its panel.

**The Files pane is one pane now.** Picking a Solution to open and then browsing its files were two steps for one intention, and the first was a dropdown you had to find before the second could start. No Solution picked shows every Solution in the Product as a foldable root; the Solution bar scopes it. **"All Solutions" is a real tab**, not the absence of a selection.

**Any click on a file opens it**, in `BuildFileEditor` — the editor half of `CodeEditor` without its second explorer and Solution picker, which Build already has three of.

**Admin counts the models.** Installed and usable / awaiting install / failed validation, installed first, with a filter.

### Your Feedback

- **DAP is not built.** You chose it over `debugger;` statements, and I said when offering the choice that it would be its own round — it is per-language adapter work (js-debug, CodeLLDB, debugpy), a protocol client in Rust, and a UI for stack and variables. Building a gutter this round with nothing behind it would have been the exact failure the last four rounds have been avoiding. **Next round.**
- **`Replay::push` trims on a character boundary**, and that is the line that would have panicked. A PTY splits multi-byte characters across reads, so the trim point lands inside one sooner or later, and `String::drain` on a non-boundary byte index panics — in a reader thread, taking the stream with it. Tested with three-byte characters.
- **`list_terminals` prunes as it reads.** A shell someone typed `exit` into is not something to offer picking up.
- **Removing the default Solution broke two ship-rail tests, correctly.** With "All Solutions" as the opening state there is no working copy to review until one is chosen, so those tests now pick the agent first — which is the real flow, since the rail is labelled by the agent.
- **Admin lists everything by default.** My first cut defaulted to the installed-only filter and broke three tests by hiding the Install buttons — which is the other half of what that panel is for. The counts and the ordering answer your question; the filter narrows.

### Technical Debt

- **DAP breakpoints, the whole feature.** Next round.
- **A shell still dies when the app closes.** The registry is process-lifetime, not machine-lifetime; nothing reattaches across a restart.
- **`attach_terminal` does not resize before replaying**, so a tail written into a narrower widget than it was produced for wraps where the original did not.
- **The replay is per session with no total cap** — eight attached shells is 512 KiB of held output.
- **`BuildExplorer` reads every Solution's tree when nothing is picked**, in parallel but unpaged; a Product with a dozen large repositories will feel it.
- **The file editor has no tabs.** One file at a time; opening another replaces it, and an unsaved buffer is reloaded from disk when you come back.
- **Nothing links a file's diff and its editable copy** — the tree opens the editor, the workbench's Changes tab opens the diff, and they are separate places for one file.

## Round 17f — The 77px dropdown, and paying down the debt from 17–17e

### My Feedback

**The dropdown padding was a real bug, and app-wide.** `min-height: 5.5rem` and `resize: vertical` sat on the shared `input, select, textarea` rule, so **every select and every single-line input in the app was 77px tall** — a one-line control with an inch of dead space under the text, which reads as enormous padding. A minimum writing area is a fact about writing prose, not about form controls. Scoped to `textarea`; selects are now 31px and inputs 29px, verified across all four areas. `input[type="color"]` got its own size too — the shared padding was putting a pale frame around the colour it exists to show.

**Debt cleared, by area:**

*Debug* — shells stay alive behind other Build panes (mounted on first use, then hidden, with `TerminalPanel` refitting xterm on the way back rather than staying measured at zero); **Restart** sends Ctrl-C then the command, both as keystrokes so they land in the scrollback; the **likely port** is shown and labelled a guess; the uptime clock moved into its own component so one number no longer re-renders every shell and run panel once a second; Solutions with no working copy can be hidden.

*Map* — ⌘/Ctrl + wheel zooms **about the pointer** (a plain wheel is deliberately left alone: this sits in a scrolling page and swallowing the wheel would trap the scroll); zoom and pan persist under their own localStorage key, clamped on the way in; the surface grows from the content instead of stopping at a fixed 3000×2000.

*Rules* — "where agents stopped" windows to 7/30/all days with the older ones **counted rather than silently dropped**; which field leads is a property of the field list (`StrategyField.lead`) instead of a name passed at the call site; the strategy fields are cards like the rules beside them.

*Work* — a row with an agent on it links into Build; `readinessOf` is exported and unit-tested directly, which caught nothing but pins each of the five checks independently where the UI only ever showed a total.

*Build* — the Solution palette went from five hues to eight.

**`guessDevUrl` moved to `lib/devServer.ts`** when Debug started labelling ports with it — two copies of that table would drift the first time a framework was added to one.

### Your Feedback

- **The Ready row had to be restructured, not just extended.** The link into Build meant a second control in a row that was one big `<button>`, and an interactive element inside a button is neither valid HTML nor reachable by keyboard. The row is a list item holding two buttons now.
- **Restart is offered only once a shell reports itself open**, so it cannot be pressed at something that is not running.
- **Eight hues is a reduction, not a fix.** A Product with nine Solutions still has two sharing a colour. It is keyed on the Solution id rather than its position on purpose: a colour that changed when somebody else created a Solution would be worse than a collision.
- **I broke `DebugBoard.tsx` mid-round and rewrote it.** A patch script assumed LF in a file that had picked up CRLF, so `split` produced three lines and the splice deleted everything after the restart callback. Caught immediately by reading it back. The Ctrl-C byte is now a named `INTERRUPT` constant rather than an invisible control character inline in a template literal — unreadable in a diff and only surviving a careless edit by luck.
- **Two tests broke and both were right to.** The Ready row's clickable target moved, and the enforcement panel's new 7-day default filtered out a fixture dated 2023. Fixed the fixtures rather than the defaults.

### Technical Debt

**Needs Rust, deliberately not attempted here:**
- **A process registry** so shells survive leaving Build entirely, not just moving between its panes.
- **`list_product_plans`** so Ready can score the test plan without a call per item.
- **A per-run test filter**, so Build's Tests pane runs the agent's tests rather than the Solution's.
- **A reason code on `AiJob`**, so a rule-block and a scoping-block are distinguishable without reading prose.
- **`ENFORCED`** is still a constant in the component; if Rust checks a second rule, nothing makes the badge follow.
- **"Where agents stopped" still reads every job and windows in the webview.**

**Frontend, still open:**
- **The map's inspector indexes `solutionId`-scoped documents only**; a whole-Product document about one Solution cannot be attributed.
- **Ready has no assignee filter** of its own.
- **`BuildExplorer` reads the whole Product's changed files** to mark one Solution's tree — deliberate, so the marks and the rail cannot disagree, but it fetches more than it draws.
- **No test covers any of the stacked narrow layouts**; jsdom has no layout engine, so they stay browser-verified.
- **Wheel zoom is untested** for the same reason — the pointer-anchoring arithmetic is checked, the event path is not.

## Round 17e — A Debug feature that is real, and a page frame that stops shouting

### My Feedback

**Debug now exists, and it is a genuine capability rather than the design's chrome.** A green ▶ chip in the Solution bar opens `DebugBoard`: a real PTY per Solution, in that Solution's own working copy, with its detected run command ready to type in. **Several run at once** — the front end, the API and the worker all up together — which is precisely what the Code tab's single terminal could never do and the reason this was worth building.

It is assembled from `DevServerPanel` and `TerminalPanel`, both already tested, rather than a new terminal implementation.

**Nothing is attached until asked.** A shell is a real child process, so opening one per Solution on arrival would spawn several the moment somebody clicked Debug to look. Attach mounts one; Detach unmounts it and `TerminalPanel`'s existing cleanup closes it. Leaving Debug unmounts the board, which is deliberate — several shells alive behind a hidden pane is how an afternoon ends with eight of them.

**It sits in the Solution bar, not the workbench.** Debug runs the real Solutions in their real working copies, which is a Product-wide thing; putting it inside one agent's workbench would have implied it ran that agent's worktree.

**The page frame.** `.environment` padding 1.25/1.5rem → 0.6/0.85rem, the heading tightened, `.develop-area` gap 1rem → 0.6rem, and the Product picker moved onto the tab row inside a new `.develop-bar` which now owns the rule the tab strip used to draw. That is a whole row reclaimed from a control that changes about once a session.

### Your Feedback

- **The debugger is still not there, and that is the point.** Step in/over/out, a call stack, variables you can edit mid-run, breakpoints, per-run env overrides — there is no debug adapter in this app and no environment management. Every one of those controls would have been furniture that looks like it works, and **a breakpoint that silently does nothing is worse than no breakpoint**, because you would trust it. The board says so in the panel, not only in a comment.
- **No CPU or memory columns.** The design has `8% cpu · 214 MB` per process. The app does not read the process table. A test asserts no `N% cpu` or `N MB` string appears.
- **Uptime is honest and narrow.** It counts from when *this window* opened the shell, which is the only start the app can claim to know — not from when the process began if something else started it.
- **The assertion had to move from words to controls.** The first version of the honesty test failed on the panel's own disclaimer, which necessarily contains "call stack". It now asserts there is no step/continue/pause/breakpoint *button*, and separately that the disclaimer is present — the panel has to be free to name the things it is disclaiming.
- **A Solution with no working copy cannot be attached**, and the button is disabled with the reason beside it rather than failing on the press.
- **`Product` went next to the tabs, not into the app topbar.** The topbar is app-wide; Product only scopes Develop, Product and Test, so a picker up there would be visible in Admin where it means nothing.

### Technical Debt

- **Leaving Debug kills every attached shell.** Correct for leaks, wrong if you wanted a dev server to survive a trip to the Map tab. A persistent process registry in Rust would fix it properly.
- **No port is shown**, though `PreviewPanel` already guesses one from the run command — the guess is not shared.
- **Stopping a process means closing its shell**; there is no "restart" that keeps the terminal.
- **`DebugBoard` renders every Solution**, with no filter, so a Product with a dozen is a long scroll.
- **Uptime ticks a 1s interval while anything is attached**, re-rendering the whole board.
- **The padding change is global** — every area got the tighter frame, not just Develop. That is probably right, but Product/Test/Admin were not re-checked at the new size.

## Round 17d — Rules, restyled: two levels because there are two, and no scoreboard

Source: the same design file, its **Strategy & rules** view. Restyle only, as asked.

### My Feedback

**A restyle, and the word is accurate.** `StrategyEditor` and `DeveloperRulesEditor` keep their fields, their saves and every aria-label; `AdminArea`'s rules editor is untouched. What changed is how they read.

**Architecture requirements leads.** It gained an optional `lead` prop naming one field to draw as the standing direction — same textarea, same save, larger. Optional so Test, where no field leads, is unchanged.

**Each rule is a card with a level.** Written and unwritten rules look different (a dashed border), because a rule nobody has set is not the same as a rule that says nothing.

**`RulesView` is the page**, composing the two editors and the new sidebar; `DevelopSolutions` renders it instead of stacking them.

### Your Feedback

- **Two levels, not three.** The design had Blocking / Warn / Advisory. This app has `disallowedTech`, which is stated as a prohibition **and** read back against the answer, and six others which are stated and believed. That is *Enforced* and *In the prompt*. Marking all seven "Blocking" would have been the flattering lie, and the one that matters — because somebody would then trust the other six to stop something.
- **No per-rule counts.** "212 checks · 4 blocks this week" beside every line: nothing in this app counts rule firings. The panel says so in as many words, and a test asserts no `N checks` or `N blocks` string appears.
- **No opening scoreboard.** "68% of agent PRs merged first try", "11m median ticket to review", "4/4 rules enforced" — the app watches no pull requests, times no tickets, and enforces one rule of seven. All three were dropped rather than approximated.
- **The sidebar is real, and renamed.** The design calls it "Rule enforcement / where agents got stopped this week" and lists rule violations with outcomes. The record this app actually keeps is the **job queue**, so the panel lists `blocked` and `failed` jobs with the reason each gave. It is called **"Where agents stopped"**, not "violations", because a blocked job is more often a missing acceptance criterion than a rule that bit — naming it after rules would misattribute most of its own contents.
- **Two unmocked calls found.** `listAiJobs` (new) and `getDeveloperRules` (pre-existing) were falling through to the real `invoke` in `DevelopSolutions.test.tsx`, so both panels rendered their error state while all nineteen tests passed. Both mocked now, with tests over the content.

### Technical Debt

- **`ENFORCED` is a constant in the component**, not read from the backend. If Rust ever starts checking a second rule, nothing makes this list follow.
- **"Where agents stopped" reads every job and filters in the webview** — there is no `list_blocked_jobs`, so a Product with a long history fetches all of it.
- **No date range.** The design said "this week"; this lists every stopped job ever, newest first.
- **A job blocked for a rule and a job blocked for a missing criterion look identical** — `AiJob` has no reason code, only prose.
- **The strategy `lead` is hard-coded to `architecture`** in `RulesView` rather than being a property of the field list.
- **`.strategy-fields` still styles the five non-lead fields as plain textareas**, so the Technical Strategy is now two visual languages in one card.

## Round 17c — The map gets three panes, and loses two things it was never entitled to say

Source: the same design file, its **Planning & Architecture** view.

### My Feedback

**`SolutionMap` is the design's three panes now.** The palette down the left (add a Solution, counts by type, map checks, shortcuts), the canvas in the middle, the inspector down the right. Everything that was already there — Arrange, Connect with its dependency kind, the localStorage layout, Save to `.drawio` — is unchanged behind it, and its five tests passed without edits.

**Zoom, pan, snap and a grid.** The canvas is a fixed viewport with a transformed surface inside it, so the boxes' stored coordinates stay in one space and the saved `.drawio` is the arrangement on screen at any zoom. Drag maths divides by the scale, which is what keeps a box under the pointer rather than drifting from it as you zoom — verified in the browser at 1.4× with a pan applied, exact to the pixel. Snap is 10px and the grid is drawn at 20px, so the grid *is* the snap made visible.

**The inspector links to Build.** An agent inside a Solution shows a mark on the box and a row in the inspector that opens its work item in Build. That closes the loop the other way from 17b: the lane links out to Work, the map links across to Build.

**Documents are read once.** `DeveloperPlanning` already loads `listArchitectureDocs` for the previews below, so it hands them to the map's inspector rather than the map reading them again — the inspector is an index of them, not a second copy.

### Your Feedback

- **The health light is gone.** The design gave every module a red/amber/green dot. This app never reads the code behind a Solution, so that dot would have been a verdict on something it has not looked at. The dot is still there and still means something real: **whether there is a working copy on this machine**, with a title saying so.
- **Owner, size and coverage are gone too.** Three confident figures with nothing behind them, in the panel most likely to be believed. The inspector shows working copy, repository and what the Solution was started as — all three read from the row. A test asserts the words *owner*, *coverage* and *LOC* do not appear in the panel.
- **Map checks are the honest version of the design's.** It listed "two modules have no owner" and "review_state migration is pending". Ours are the three things the app can genuinely see: Solutions with no working copy, with no repository linked, and joined to nothing — each **naming the Solutions**, because a count you cannot act on is not a check.
- **A box is still a real Solution.** The design's palette adds modules to the picture. Adding here creates the Solution, because a box that exists only on the canvas would be a claim about code that does not exist.
- **A settled run does not mark a box.** `kept` and `discarded` mean the agent finished and left; marking the module would say somebody is still standing in it. Tested.
- **Edges stayed straight lines.** The design routes them orthogonally, which reads well on its layered grid and badly on boxes dragged anywhere. Straight lines with an arrow marker were already here and are more robust to free-form arrangement.

### Technical Debt

- **Zoom is toolbar-only** — no wheel or pinch, which is what anybody will try first.
- **Pan and zoom are not persisted**, unlike the box positions; reopening the tab returns to 100% at the origin.
- **The surface is a fixed 3000×2000**, so a map dragged past that has nowhere to go.
- **Nothing prevents a box being dragged under the inspector** and left there — the viewport clips, and only Tidy brings the view back.
- **The inspector's document index shows `solutionId`-scoped documents only.** A whole-Product document that is really about one Solution does not appear against it, because nothing records that.
- **`arch-map` styling now assumes the three panes**; the old flat `.solution-map` rules are gone, so any other caller of this component would need the new markup.

## Round 17b — Work opens on Ready, and the lane links instead of launching

Source: the same design file, its **Work items** view — plus your two decisions from round 17's questions.

### My Feedback

**Work opens on Ready**, a new first view beside Board, Sprint and List. It leads because it is the only one that answers the question somebody standing in Work is asking: *is this scoped well enough to hand over?* Board says where an item is, Sprint says when, List says everything at once, and none of them can say that. The other three are untouched.

**Five checks, and every one is a column.** What is asked for (`description`), a Solution (a run exists), how to build it (`developmentDetails`), nothing blocking (no open questions), and **plan approved** — which the design did not have and which matters most here, because `prepare_run` is what actually refuses. A readiness list that omitted the gate the backend enforces would be claiming an item was ready that the backend would then reject.

**Three reads, not two per item.** `Run.planApproved` and `listOpenQuestions(productId)` are both Product-wide and between them answer four of the five checks for every row at once, so a fifty-item Product costs three calls rather than a hundred. The briefing panel loads the selected item's plans in full, because that is one item at a time.

**The lane links.** `AgentLane` gained a card that opens the first work item with no agent, routed `AgentWorkspace → DevelopSolutions → WorkItemViews → WorkReadiness` with the usual `{ id, at }` shape so asking twice for the same item still moves.

### Your Feedback

- **No "ready %".** The design showed a percentage under the heading *"Scope it properly and the agent lands it first try"*, which reads as a prediction about how the work will go. It is drawn as `4 of 5` with a bar — the same shape as the ship rail's ring, for the same reason. A test asserts no `%` appears on a row.
- **The checks are labelled, not just dotted.** Five bare dots would be unreadable without a legend somewhere else on the page, and the legend is the useful part.
- **`1 of 5` is the floor, not `0`.** An item with nothing filled in still passes "nothing blocking", because it has no questions against it. That is correct and slightly counter-intuitive, so the briefing spells out what is missing rather than leaving the number to be interpreted.
- **The lane card does not start a run**, per your decision. Handing work over is approving a plan and pressing Start, both on the build plan, and a second entry point would have been a way around the approval gate rather than a shortcut to it. A test asserts `startRun` is never called from it.
- **No model picker in the briefing.** The design has a Claude/Codex/Qwen row; which model and how hard it tries is the work item's AI policy, set once in its own editor. Two places to choose would mean two answers and no way to tell which the run used — so the briefing states the policy read-only and says where to change it.
- **The user filter is hidden on Ready.** It belongs to the three views that list by person; Ready sorts by what the work still needs, which is not a fact about who it is assigned to.

### Technical Debt

- **The test plan is not one of the five row checks.** `unitTests` lives on `WorkItemPlan` and there is no Product-wide plan read, so scoring it would be a call per item. It is in the briefing, where one item is loaded anyway. A `list_product_plans` command would close this.
- **`WorkReadiness` re-reads `listRuns` and `listOpenQuestions`** that the Build view also reads; they are two components in two tabs and share no cache.
- **"agent · prepared" on a busy row is a dead end** — it names the state but does not link back to that agent in Build, which is the obvious next click.
- **`readinessOf` is not exported or unit-tested on its own**; it is covered through the rendered rows.
- **Ready ignores the assignee filter entirely** rather than offering its own; on a large Product the list is every item in it.

## Round 17 — The Build view: four panes, and the three numbers the design asked for that we refused to invent

Source: Claude Design project `14eae620-8042-4de9-942c-0b2ba4d6a77b` — *Rust app iOS vscode redesign*, file `Develop Workspace.dc.html`.

### My Feedback

**Develop's tabs are the design's four**: Rules, Work, Build, Map. Tests and Git are gone as tabs — they answered across the whole Product and so could never say which agent an answer belonged to. Both are inside Build now: per agent as workbench panes, Product-wide under the "queue, questions and runs" entry, so nothing was lost, only re-filed.

**Build is the design's four panes.** `AgentLane` (who is working) → `BuildExplorer` (where they have been) → the workbench (what they did) → `ReviewShipRail` (the decision). The lane card carries what you need before deciding to open it — the Solution, the stage, the last thing the agent said, and the branch — where the old rail was a title and a badge, which meant opening every agent to find out which had stopped.

**The change review is owned by the Build view, not by the panes that draw it.** The workbench draws the diffs and the rail draws the totals; if each ran git for itself the two could disagree about the same working copy while sitting a foot apart on screen.

**Hue is keyed on the Solution, not the model.** The design coloured by agent identity (Claude / Codex / Gemini / Qwen), which is not an axis this app has — a run belongs to a *repository*. So the same hue and the same two-letter mark appear on the Solution tab, the lane card, the workbench header and the file's mark in the tree, and "which repository is this agent inside?" is answerable at a glance.

**Picking a file in the tree opens its diff.** That linkage is the only reason the tree and the workbench are worth putting side by side, so it is wired rather than implied.

### Your Feedback

- **Three figures in the design were not built, and each for the standing reason.**
  1. The **per-agent progress bar** (`68%`, with a shimmer). The app cannot see how far through its work an agent is. The card shows the **stage** instead — Plan → Code → Review → Done, every one of them a state `runs` actually holds. A test asserts no `%` appears on a card.
  2. The **`412k ctx` token chip** in the header. Same rule as Claude Code spend: a figure the app cannot see.
  3. The **debugger** — call stack, variables you can edit live, breakpoints, per-run env overrides. This app has no debugger and no env management, so all of it would have been furniture. That tab is `Run`: the real dev-server command and the real PTY terminal.
- **The ship checklist is derived, never ticked.** The design had four checkboxes a person clicks. That would make the progress ring a record of what somebody *claimed*. Every line is read back from the change review, the test run and the run's settled state, and there is no checkbox in the rail at all — a test asserts that too.
- **"No rules set" is not a pass.** `noRules` leaves the Rules line *unknown* rather than green, because silence for want of rules reads exactly like silence for want of problems.
- **There is no Commit button**, and the design's "Commit & push to GitHub" / "Open PR without merging" pair is not there. The app hands over a command and records the decision; it does not run git for you. Keep and Discard write that decision against the run, which is the thing this app can actually do — and Keep is still never gated on the checks, so keeping a change over a broken rule is recorded as exactly that.
- **Test counts appear only when they were read.** A suite known solely by its exit code reports "Passed — by exit code" and no numbers, and the verdict handed to the rail carries the `counted` flag rather than a total nobody parsed.
- **Everything is in theme variables plus one inline `--agent-hue`.** The design is dark-only hex; expressing it as `color-mix` over the existing tokens means the light theme works — verified in the browser, surfaces invert and the status colours darken rather than glow.

### Technical Debt

- **`--agent-hue` cycles a five-colour palette by `solutionId % 5`.** A Product with six Solutions gets a repeat, and nothing warns.
- **`BuildExplorer` calls `productChangedFiles` for the whole Product to mark one Solution's tree.** Correct (the marks and the rail's counts come from one read so they cannot disagree) but it fetches more than it draws.
- **The workbench's Tests pane runs *every* suite in the Solution**, not the tests the agent wrote — `runSolutionTests` has no per-run filter, and the design's per-agent test list implies one.
- **`Rules / Work / Map` are unstyled against this design.** They keep their current look; the design's Strategy page, work-item readiness scores and canvas toolbar are not built.
- **The lane has no "hand a work item to an agent" action.** The card counts unassigned items and says so, but pressing it does nothing — submitting for planning is still done from the work item's build plan.
- **No test covers the narrow (`max-width: 75rem`) stacked layout**; it was checked in the browser only.

## Round 16c — One section, two notations

### My Feedback

You were right that they were the same thing. `infrastructure` was **already an architecture-document kind** — the two sections were the same feature filed twice, one storing Mermaid in the database and the other writing draw.io to disk, with two builders, two previews and two ways to say "this is the system".

They are one now, and the merge is real rather than cosmetic:

**draw.io became a *format*, not a section.** It sits beside `mermaid`, `plantuml` and `jsonGraph` in `diagram::FORMATS`, and the same validator judges it — `looks_like_drawio` is the one place that decides, so the file writer and the document check cannot disagree about what a draw.io file is.

**One draft, two renderings.** `draft_architecture(product, format)` works the boxes out once from the Solutions and applies the notation at the end. That is the load-bearing part: which notation a diagram is written in is a choice made *after* deciding what is in it, so the two halves cannot disagree about what the architecture is.

**What differs is only what happens on save.** Mermaid is text: it goes in the document and renders inline. draw.io is a file as well: it goes in the document *and* is written beside the Product's framework files, so the real editor can open and rearrange it. Everything before that — drafting, adding boxes, connecting them, the preview — is identical.

**The preview is the boxes**, so it is the same picture either way. That falls out of the merge rather than being built twice.

**The dead component is gone.** `InfrastructureDiagrams.tsx` is deleted and its preview extracted to its own module. Leaving it as a file imported only for one export would have been the same duplication you asked me to remove, one level down.

### Your Feedback

- **Two renderers now exist in two languages**, and they are pinned to each other: the Rust `to_mermaid` renders the draft, the TypeScript `buildMermaid` renders later edits, and both suites assert the same output for the same input. Without that a diagram would change notation halfway through being built.
- **A dash ends a Mermaid id** and our own ids are `solution-3`, so they are sanitised — and a pipe inside an arrow label closes it early and takes the rest of the line. Both are tested on both sides.
- **`DiagramView` explains draw.io and PlantUML differently.** Both show source rather than a picture, but for unrelated reasons — one because rendering it would post a private architecture diagram to a third party, the other because draw.io draws its own files. Saying "not drawn here" for both would suggest either could be fixed the same way.
- **The AI half is offered only for the notations it can write.** draw.io is drafted from the Solutions and then arranged in draw.io, which is better at layout than any prompt.

### Technical Debt

- **The Rust and TypeScript renderers are still two implementations.** Tests hold them together; nothing stops a third being written.
- **A draw.io document saved twice writes the file twice** and the second overwrites the first, including any arrangement done in draw.io between. The round trip is still one-way — the debt named last round, now more visible because the two paths share a save button.
- **`plantuml` and `jsonGraph` get no builder**, which is honest but means the section is two-speed: two notations you can draw, two you must write.
- **Nothing migrates the diagrams written before this round** into architecture documents — the files are still on disk and still listed by the old command, but they are not documents.

## Round 16b — Drafting from what the app already knows, and a preview that agrees with the file

### My Feedback

**The diagram drafts itself from the Solutions.** This was the debt I flagged at the end of the last round and you went straight for it: the Solutions, their types and the links between them are already recorded, so the first draft should not be typed in again. Database Solutions draw as stores, everything else as services, and the recorded links become the arrows in the same words the Develop area uses — an arrow reading `callsApi` would be the database's word for it rather than a person's.

Deliberately **a first draft, not the answer**. It draws what the app knows, which is the Solutions — not the queue, the load balancer or the third party they all depend on. The builder stays for exactly that, and the button says so.

**Boxes are keyed by Solution id, not name.** Two Products can hold Solutions called the same thing, and an edge matched on name would join the wrong pair. A link whose other end is in another Product is left out rather than drawn, because draw.io opens a dangling edge as something that looks like a corrupt file.

**The preview draws from the same grid as the file.** That is the part worth being careful about: a preview laid out differently from what gets written would be a picture of a diagram nobody is about to get, which is worse than showing none. The constants live once in `drawio.rs`, are mirrored in the component, and **both sides carry a test asserting identical coordinates for the same input** — so the two cannot drift without something going red.

It renders from the nodes in hand rather than by parsing the XML back, which is what lets it update as boxes are added, before there is a file at all — and again after a save.

**The language question is now the starter picker.** You were right that this is where it should start. Asking it twice — once as prose, once as a dropdown — invites two different answers, and the one the generator acts on would not be the one anybody read. The picked label is stored as the answer, so the brief that reaches the AI reads "Rust (cargo)" rather than `rust`.

**"Something else" asks for the language name as well as the command**, and the backend refuses without either. A Solution recorded as having been started in "custom" tells nobody anything a year later; recorded as "Elixir" it does.

### Your Feedback

- **Drafting replaces the builder's contents rather than merging into them.** A merge would silently duplicate every box on a second press, and a draft is meant to be a starting point you then correct.
- **Drafting from a Product with no Solutions says so** rather than blanking a diagram somebody was part-way through.
- **Removing a box takes its arrows with it** — already true, now tested, because the alternative writes a file that opens as a dangling edge.

### Technical Debt

- **The draft cannot know about infrastructure that is not a Solution.** Queues, load balancers, third parties and environments are all invisible to it, which is stated in the UI but does mean the draft is never the whole picture.
- **A second draft discards hand-added boxes.** The warning is that it replaces; there is no merge that keeps what you added.
- **The preview lays out on a fixed grid and does not route arrows** — lines go centre to centre and cross each other freely. draw.io does that properly, which is the argument for the preview being a preview.
- **Nothing re-reads an existing `.drawio` back into the builder.** Save, open in draw.io, rearrange — and the builder still holds the version it wrote, not the version on disk.
- **`kind_for_solution` is two cases.** A website that is genuinely third-party still draws as a service.

## Round 16 — Renamed tabs, draw.io, and commits that happen by themselves

### My Feedback

**The tabs now say what they hold.** Planning → **Strategy and Rules**; Workspace → **Planning and Architecture**, with Developer Planning moved into it and put at the top, because architecture is what someone comes to that tab to think about and the Solution list below is where the thinking gets built.

**draw.io: this app writes the file, draw.io edits it.** You took the recommendation, and it is the honest shape. Embedding the real editor means loading app.diagrams.net over the network on every open — which breaks offline and sends your infrastructure to a third party — and building a substitute would be a worse draw.io that could not open anything anyone else made. So `.drawio` mxGraph XML is the contract: what this writes opens in the desktop app or the VS Code extension, and what they save comes back as a diff. The files land in the Product's folder rather than app data, because a diagram that is not versioned with the code it describes goes stale without anybody seeing it happen.

Boxes are laid out four to a row rather than left at the origin — draw.io opens everything-at-0,0 as one unreadable pile, and the first thing anyone would do is drag them apart. Kinds get real shapes, so a database is a cylinder rather than another rectangle.

**Auto-commit asks committing and pushing as two questions**, which was your correction to mine — I had offered it as one choice with three answers, and you were right that it is two. The consequence of each is written under the toggle rather than left to be discovered: local commits stay on the machine until you push and a bad one is a `git reset` nobody saw; pushed ones are on the branch other people pull, where undoing means rewriting history everyone has.

**The automatic commit message is only ever the list of files**, as you asked. A generated sentence explaining the change would be worse than the list, because whoever read it later would trust it. Ten files then "and N more", since a hundred-file subject is unusable in every git tool there is.

**Auto-commit refuses during a merge.** A conflicted tree staged wholesale is how `<<<<<<< HEAD` gets committed, and an automatic commit is precisely when nobody is watching.

**The Code tab now offers a Solution rather than sending you elsewhere.** Nothing open is the ordinary state on arriving, so the explorer frame stays with the picker where the tree will be — the page does not change shape under you when you choose.

**Manual commits sit beside the files**, as a tab of the explorer: committing is part of writing code, not a separate errand. The Git tab up in Develop answers "where does everything stand"; this one answers "ship what I just did".

**Branch history is drawn from `git log --all --date-order`**, with lanes assigned the way every git viewer does it. A merge's *second* parent is what opens a new lane, which is the entire reason the picture beats a list.

### Your Feedback

- **The SSH private key never reaches the frontend, the database or a log.** `ssh-keygen` writes it with the permissions ssh expects and this app only ever handles the public half — a test serialises the status and asserts no private key can be in it. It matters more here than for the API keys: a leaked private key is push access to every repository the account can reach.
- **The key gets its own name**, `id_ed25519_coperativeai`. Generating one must never overwrite a key somebody already relies on, which would lock them out of every host that trusts it with no way back.
- **The app does not add the key to your GitHub account.** It shows the public half and copies it; you add it in GitHub's own settings. Reaching into someone's account settings is not a thing a desktop tool should do quietly on their behalf.
- **`ssh -T git@github.com` exits 1 on success**, because GitHub offers no shell. Treating that as failure is the classic mistake, so the greeting is what is checked.
- **The timer reads its interval from the policy and the backend still refuses if the mode is not `interval`.** A timer left running by a stale closure cannot commit for someone who turned it off.

### Technical Debt

- **Nothing generates a diagram from the architecture the app already knows.** The Solutions, their types and the repo links are all recorded, and the draw.io builder is hand-fed — that is the obvious next round.
- **No diagram preview.** The file list says what exists and opens it; seeing it means opening draw.io.
- **Auto-commit is per Solution and only runs while its tab is open in the Code editor.** Close the tab and the timer stops, which is defensible but is not what "every 5 minutes" sounds like.
- **`.gitignore` is the only thing standing between auto-commit and a committed secret.** Nothing here scans for keys before committing.
- **The branch graph is 120 commits and has no way to load more**, and lanes are recomputed on every render rather than memoised.
- **Nothing tests the SSH or draw.io paths end to end** — the pure parts are tested, but generating a key and opening a file both need a machine.

## Round 15b — Paying off the debt

### My Feedback

You asked for the debt to be fixed, so this round builds nothing new and closes seven things.

**The structured list now reaches the model.** This was the one I flagged myself and the largest of them: the team wrote screens, endpoints and tables, and the prompt was handed only the prose beside them — so the schemas came from a summary of the plan rather than from the plan. They now travel grouped by kind, each under **"this is the complete list"**, which is the load-bearing sentence: without it a model reads the names as examples and adds a few of its own. Add and change render differently, because they are different work.

**Screens and pictures are one thing now.** A screen can name the mockup that shows it, and the prompt renders it as `Basket — now shows delivery (shown in basket.png)`. Previously the model got a pile of images and a list of names and had to guess the pairing. The reference is only written **when the picture was actually attached** — a "shown in basket.png" beside an image that was never sent is a reference to nothing.

**Unassigned asks are reported, not dropped.** A screen Product asked for that reaches no Solution is exactly the thing that goes missing until somebody notices it was never built, so the run now names them: *"not assigned to any Solution, so not designed: Basket"*. Same rule as the skipped pictures.

**Duplicates are refused**, case-insensitively and per Solution — two rows for the same endpoint is not a plan, it is a plan and a typo. The same name against a *different* Solution is still allowed, because an endpoint the API serves and a screen the web app shows are genuinely different work.

**The terminal now kills the process tree.** Killing the shell alone left an `npm run dev` holding its port, which presents much later as "port already in use" with nothing visible using it. Done through `taskkill /T` on Windows and a negative PID on Unix — one command each, no new dependency. Best effort by design: a child that has already exited must not stop the panel from closing.

**A failed starter is no longer a dead end.** It can be re-run against the Solution that was created anyway, so a missing toolchain is installed and retried rather than requiring the answers to be retyped.

**The pragma spelling cannot come back quietly.** A test walks the source for `SELECT … pragma_table_info` and fails the build with the reason. That bug cost every Product anyone had ever created, and the fix was a convention — which is only as good as the next person who has not heard of it.

### Your Feedback

- **One starter is now run for real.** Every other starter test drove `echo`, which proves the plumbing and nothing about whether the commands are right. The Rust one really runs `cargo init` and asserts the slugged package name landed in `Cargo.toml` — and **skips rather than fails** when cargo is absent, because it asserts that *our template* is right, not that every machine has Rust.
- **The empty case is tested too.** A Solution with nothing structured against it must not grow a "Screens — this is the complete list:" heading followed by nothing, which reads as a deliberate instruction to build no screens.
- **The mockup is named by file, not by path.** The model is shown the picture, not the disk, so the folder is noise that costs tokens on every call.

### Technical Debt

Deliberately still open, with reasons:

- **Nothing resizes an image.** A 4 MB screenshot is still sent at full resolution. Fixing it means an image-decoding dependency and a quality judgement about what a downscale loses; that is a decision, not a cleanup.
- **The image limits, and `kinds_for`, are still constants rather than Admin policy.** Both are opinions that have not yet been wrong in practice, and moving them is a feature, not a debt payment.
- **One shell per Solution tab**, and scrollback still dies with the panel — the latter is the page brief's own instruction.
- **The Ollama half of the AI window is still a description, not a control.**
- **Standing: the Claude path is unproven live.** `ANTHROPIC_API_KEY=sk-... cargo test -- --ignored caching_is_live`.

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

---

## Round 51 — "Where things live" leaves the rules

### My Feedback

**Three statements, one conclusion.** "This should not exist. Developer set
where things live when they create solutions." "All solutions when developed are
never a set plan — as a product becomes more successful you may add more
solutions or change the architecture to allow for heavier loads." "Product
people do not set software architecture or solutions." Each rules out something
different, and together they leave exactly one place for a folder layout: **on
the Solution, editable whenever, in Develop.**

**It was wrong twice over, not once.** Held in `developer_rules`, keyed by
`productId`, it was a per-repository fact in a per-Product store — a Product
with a Rust backend and a React front end could give one answer to "where do
screens live", and this project is that Product. And it was an architecture
decision owned by the Product entity, which is the boundary the third statement
draws. The tabs already respected that boundary; the schema did not.

**The consumer proves it.** `suggest_change_names(solution_id, kind)` took a
*Solution*, then walked `solution → product_id → developer_rules → location_of`.
It answered a per-Solution question out of a per-Product answer.

**Architecture moving is what makes the stale case normal.** `names_in` returns
an empty list when the folder cannot be read, so a renamed folder and an unset
one produced identical silence — no suggestions, no reason. That is fine when
layouts are settled and wrong when they are not, which is the second statement's
whole point. A folder that was named and is no longer there now says so.

### Implemented

- `db/solution.rs` — `kindLocations` column (additive; `localPath` and the test
  and run commands set the precedent), `set_kind_locations`, `location_of` moved
  here from `developer_rules`, and `adopt_product_layouts`, which copies a
  pre-move Product-wide map onto that Product's Solutions. It **seeds and never
  reasserts**: a Solution with its own answer keeps it, so running it twice — or
  after a correction — does not put the old guess back. Reads the old column
  only if it is still there.
- `db/developer_rules.rs` — the field, the column, the validation and
  `location_of` gone. What is left is what the *team* does: coding standards,
  architecture principles, maintainability, frameworks, allowed and disallowed
  tech, AI constraints.
- `commands/work_item_changes.rs` — reads the Solution's own layout, and pushes
  a "`src/pages` was named as where these live, and is not in the working copy
  any more" entry when the folder has gone.
- `commands/solutions.rs` — `set_solution_kind_locations`, and `kindLocations`
  on `SolutionDto`.
- `components/product/SolutionBox.tsx` — the rows, in **Develop → Solutions**,
  beside the working copy the paths are relative to. It asks only about the
  kinds *this* Solution can hold (`changeKindsForSolution`), where the rules
  editor used the global list and asked a database where its screens live.
- `components/ai/DeveloperRulesEditor.tsx` — the section deleted, with a comment
  saying where it went and why.

### Tests

cargo 675/675 (23 ignored), Vitest 607/607, `tsc --noEmit`, `npm run build` and
clippy `-D warnings` clean. Five new Rust tests and two new Vitest ones:

- **Two Solutions in one Product lay themselves out differently** — the bug that
  prompted this, now impossible to reintroduce without failing.
- A layout that is not a map reads as "nothing said" rather than crashing;
  whitespace is trimmed; an unknown Solution is refused.
- The Product's old layout is copied onto its Solutions, and a second run does
  not overwrite an answer a developer has since given.
- The rows offer only this Solution's kinds; clearing a folder stores "nobody
  has said" rather than a blank that later fails to parse.

### Your Feedback

- **The same shape is still wrong for four more fields**, and I did not widen
  the change to them: `preferredFrameworks`, `allowedTech`, `disallowedTech` and
  `architecturePrinciples` are all per-repository facts in a per-Product store.
  A Product with a Rust backend and a React front end has no single "preferred
  frameworks". `disallowedTech` is the only rule here with teeth — it is checked
  against AI output — so moving it deserves its own round and its own tests
  rather than riding along with a folder field.
- **What stayed is what should stay.** Coding standards, maintainability and AI
  constraints are how the team works. They are not architecture, they do not
  change when a Solution is added, and one answer is the right number.
- Recommendation: the emitted solution spec still has no `scaffold.fileLayout`
  block, even though the framework's own form asks for one and the app now holds
  the answer. Rendering it there would close the loop — what a developer types
  in Develop becomes the spec the framework builds from.

### Technical Debt

- **The `developer_rules.kindLocations` column is left in place on existing
  installations**, unread after the migration copies it out. Dropping it needs
  either `ALTER TABLE DROP COLUMN` support in turso or a table rebuild, and
  rebuilding a table whose other columns hold hand-written rules to reclaim one
  dead column is the worse trade.
- **Four more per-repository fields are still Product-scoped** (above).
- **The emitted spec has no `scaffold.fileLayout`** (above).
- **Develop-side components are still filed under `components/product/`** —
  `SolutionBox`, `NewSolutionForm`, `SolutionRepo`, `GithubCard`, `SshCard`.
  Harmless to users; the folder names now say the opposite of the boundary.

---

## Round 52 — the build plan's two answers to one question

### My Feedback

**"Lands in" was not clutter, it was a contradiction.** Two fields answered
"which Solution does this work touch", and nothing kept them in step:

- `attach_solution_to_work_item` created a plan and left `work_items.solutionId`
  alone.
- The **Lands in** picker set `solutionId` and created no plan.

So a work item could have a plan against the API while Lands in said the front
end, or nothing. And the readers were split down the same crack: the **agent
handover gate** and **where an AI-written test is placed** read `solutionId`,
while the runs and the build plan read the attached plans. Whichever field you
filled in, half the app disagreed with you.

**Attaching is now the only way to say it.** The first Solution attached claims
the landing; a second does not steal it, because work touching two repositories
still lands in the one it was pointed at and moving that should be deliberate.
Detaching hands it to whatever is still attached, and detaching the last one
leaves it with nowhere to land — which stays a real answer, since plenty of work
is not code.

### Implemented

- `db/work_item_plan.rs` — `attach` sets the landing when the item has none;
  `detach` reads the plan **before** deleting it (afterwards there is no way to
  know which item it belonged to) and hands the landing on, or clears it.
  `set_landing` is its own statement rather than going through
  `work_item::update_item`, which replaces every field it is given and would
  make this caller restate a title, a risk and six commercial fields it is not
  touching.
- `components/planning/WorkItemBuildPlan.tsx` — the **Lands in** picker deleted.

### Tests

cargo 677/677 (23 ignored), Vitest 608/608, `tsc --noEmit`, `npm run build` and
clippy `-D warnings` clean. Two new Rust tests and one Vitest:

- Attaching sets the landing; a second attach does not steal it; detaching the
  one it landed in hands it to what is left.
- Detaching the last Solution leaves nowhere to land.
- The build plan has no second picker — pinning the removal so it cannot drift
  back as a "convenience".

### Your Feedback

- **The other two are scattered, not duplicated, and I have not moved them.**
  *Development details* is one field with one editor; the per-Solution box in
  "What this changes" appends dated entries into it, which is why it reads as a
  log with prose at the top. *Questions for Product* is a separate mechanism —
  it produces clarifications, which the change detail does not.
- **What you are pointing at with "this should already be in What this
  changes" is real, but it is a design change rather than a deletion**: a
  question would be asked *against the change that is unclear*, so it arrives
  with its context instead of floating at the bottom of the item. That means
  anchoring `ai_feedback` to a change rather than only to a work item — its own
  round, with its own migration.
- Recommendation: if the goal is fewer boxes on one screen rather than a
  different model, the cheap version is rendering the questions inside the
  "What this changes" section as it stands. That is a reorder and I can do it in
  minutes; the anchored version is the one worth planning.

### Technical Debt

- **Questions are not anchored to a change** (above), so a developer asking
  about one screen among six writes the screen's name into the question by hand.
- Two `PlanningBoard` tests assert the Lands-in picker is absent from Product's
  board. They still pass, but now trivially — the control exists nowhere, so
  they no longer prove the boundary they were written for.

---

## Round 53 — the MCP servers an agent may use

### My Feedback

**This is the deferred item from 2026-08-15 coming back** — "MCP servers per
agent as rule enforcement" — and asking for it as a *developer rule* is the
answer to how it should work. It is a constraint on the AI, so it belongs with
the other constraints an agent is handed, not in a config file the rules
document never mentions.

**Silence is stated, not left blank.** An agent that reads nothing about MCP
servers can take that as permission and reach for whatever happens to be
configured on the machine. So the rules document always carries a line: either
the named list, or "none have been named for this Product. Do not use one unless
a person names it." That is the same reasoning as naming disallowed
technologies rather than hoping the model infers them.

**It is a Product-level rule, and that is consistent** with the boundary drawn
in round 51: which servers a team has approved is how the team works, like the
coding standards and the AI constraints. It is not a per-repository fact the way
a folder layout is.

### Implemented

- `db/developer_rules.rs` — `mcpServers`, added by `ALTER TABLE` (rules are
  hand-written; the table is altered, never rebuilt).
- `files/pack.rs` — the line in `developer_rules_doc`, written either way. The
  "no rules set yet" sentence is now counted **before** it, or a Product with no
  rules at all would have read as though it had one.
- `commands/strategies.rs`, `lib/backend.ts` — carried through the DTO and the
  rule-field list, so it is one more box in the existing editor rather than a
  new panel.

### Tests

cargo 678/678 (23 ignored), Vitest 608/608, `tsc --noEmit`, `npm run build` and
clippy `-D warnings` clean. One new Rust test: the named list reaches the rules
document, and silence is stated as a prohibition rather than left out.

One existing assertion changed: the test I wrote first expected "No MCP
servers"; the implementation reads "**MCP servers:** none have been named". The
intent — silence must be stated — is unchanged, and the test now also pins that
it is phrased as a prohibition.

### Your Feedback

- **Nothing enforces it.** Like six of the other seven rules, this is stated to
  the model and believed. `disallowedTech` is the only one read back against the
  answer. An agent that ignores the list is not caught, so this is a rule in the
  same sense the others are — worth knowing before relying on it.
- It is a free-text list, not a picker. The app does not know which MCP servers
  exist on the machine, and offering a list it cannot verify would be a worse
  lie than a box somebody types into.

### Technical Debt

- **The MCP list is not enforced or validated** (above) — no check that a named
  server exists, and no check that an agent used only what was named.

---

## Round 54 — Development details, removed

### My Feedback

**"Covered by the rules and what needs to change"** is the whole argument, and it
holds: the standing conventions are the Developer Rules, and the specifics are
per Solution — which is also the only one of the two that is about the
repository an agent is actually standing in. One box holding both was a third
place to write the same thing, and it doubled as an append-only log nobody
could tidy.

**It reached further than the box.** Removing it meant finding every reader:

- The agent brief's **"## How to build it"** section — gone. The rules travel
  with the brief and the per-Solution "changes required" is written below it.
- The **QA test-generation prompt's** `build_notes` — now the `changesRequired`
  of the plan for that scenario's Solution, which is the more precise answer
  anyway.
- The **readiness check "how to build it"** — removed rather than repointed.
  Keeping it would have marked every work item permanently unready against a
  field that can no longer be filled in. Readiness is four checks now, not five.
- The **briefing panel** — shows each Solution's "what has to change" instead,
  which it already had loaded.

### Implemented

- `db/work_item.rs`, `commands/work_items.rs`, `commands/work_item_plans.rs`,
  `files/work_item_files.rs` — the field, the column from the SELECT and the
  UPDATE, the DTO, and the brief's section.
- `commands/test_cases.rs` — `build_notes` now comes from the plan.
- `components/planning/{WorkItemBuildPlan,WorkReadiness}.tsx`,
  `lib/backend.ts` — the box, the dated-append path (`appendNote` and the
  `onNote` prop), the now-dead `saveItem`, and the type.

**`saveItem` went with it**, which is worth noting: with "Lands in" gone in
round 52 and this gone now, the build-plan panel writes nothing to the work item
at all. It reads the item and writes to its plans.

### Tests

cargo 678/678 (23 ignored), Vitest 608/608, `tsc --noEmit`, `npm run build` and
clippy `-D warnings` clean. Two Rust assertions inverted — the brief must **not**
contain "How to build it", and the JSON must **not** carry `developmentDetails`
— so the removal is pinned rather than merely done. Readiness counts updated
from five checks to four.

### Your Feedback

- **Nothing was migrated, on your instruction.** Anything typed into that box on
  an existing database is no longer read by anything. The column is still on the
  table, so it is recoverable by hand if something important was in it, but the
  app will not show it again.
- **The readiness score changed meaning slightly.** "4 of 4 ready" is now
  achievable without anyone writing how the work should be built — the check
  that used to demand it is gone, and its replacement is per Solution, which the
  list does not load. The briefing panel still says when nothing has been
  written; the score no longer counts it.

### Technical Debt

- **`work_items.developmentDetails` is a dead column** on existing databases,
  read by nothing. Same trade as `developer_rules.kindLocations`: rebuilding a
  table that holds a team's actual plan to reclaim one column is the worse move.
- **Readiness no longer counts whether anyone said what has to change** (above).
  Repointing it at the plans would mean loading plans for every row in the list,
  which is a query per item — worth doing deliberately, not as a side effect.

---

## Round 55 — the handover prepares itself

### My Feedback

**"Get rid of a manual step. This should save what you're doing and as we save
we prepare."** The codebase already agreed with the principle and had only half
applied it: `writeWorkItemFiles` carries a comment saying *"Every save, no
button"*, for exactly this reason — files written only when somebody remembers
are files three edits out of date. The handover brief was the one thing left
behind a press.

**It could not simply be called on save, and finding that out was the point.**
`prepare_handover` computed an attempt number from the run history and created a
**new run row and a new brief file every time**. Wired to a blur, that is one
run and one file per edit — a runs list nobody could read, from a change meant
to remove friction.

So `change_run::prepare` is idempotent now: while a run is still `prepared` —
nobody has started it — re-preparing rewrites *that* attempt and updates where
its brief is. Once a run has moved past `prepared` an agent has been at it, so
the next preparation is a genuinely new attempt and goes beside the old one.
That is the distinction that makes "prepare on every save" safe.

### Implemented

- `db/change_run.rs` — `prepare` finds an unstarted run for this item and
  Solution and updates it, inserting only when there is none. The brief path
  follows the file, because a run pointing at a superseded brief is worse than
  no run.
- `components/planning/HandoverPanel.tsx` — the button gone; an effect prepares
  on mount and whenever the panel above says something was saved. Cancelled on
  unmount, so a slow prepare landing after the panel has moved to another work
  item cannot overwrite its brief with the previous one's.
- `components/planning/WorkItemBuildPlan.tsx` — a `savedAt` stamp bumped in
  `run()`, the one path every save passes through.
- The failure is a **`status`, not an `alert`**: the usual reason preparing
  cannot run is that the Solution has no working copy yet, which is a state to
  fix rather than an error in what somebody just typed.

### Tests

cargo 681/681 (23 ignored), Vitest 608/608, `tsc --noEmit`, `npm run build` and
clippy `-D warnings` clean. Three new Rust tests: re-preparing an unstarted run
is the same run; a run that has been reviewed gets a new attempt beside it;
re-preparing updates where the brief is.

Two existing tests changed, and the change is worth naming: both built history
by calling `prepare` twice in a row, which idempotence now collapses into one
run. They review the first attempt before preparing the second — which is what
actually happens now, so the tests describe the real sequence rather than a
shortcut that no longer exists.

### Your Feedback

- **The brief is now assembled on every save, which costs a little work each
  time**: it reads the item, its plans, the changes and the rules, then writes a
  file. All local, no network, and the same work the button did — but it happens
  far more often, so if a large work item ever feels sluggish on save, this is
  the first thing to look at.
- **The Copy button stayed.** It is not a step in preparing — the brief is
  already written by then — it just saves selecting a command by hand.

### Technical Debt

- **Nothing prunes superseded brief files.** Each new attempt writes a new one
  beside the last, and re-preparing overwrites only the current attempt's file.
  A work item that goes through several agent runs leaves a small pile in
  `.coperativeai/briefs/`.

---

## Round 56 — the Product side, read-only, and the questions as a chat

### My Feedback

**Asked for three times before it was built.** That is on me — it was the
largest of the outstanding items and it kept losing to smaller ones. It is
built now.

**Read-only is the point, not a limitation.** Product sets what customers get:
what the work is, what could go wrong, which screens they want. Develop decides
how it is built. A developer needs every word of the first and must not be able
to quietly reword it — **a requirement edited by the person implementing it
stops being a requirement.** So the Product tab renders prose, not fields, and
the only control on it is asking a question.

**The questions are the way across that line**, which is why they belong here
rather than in a box at the bottom of the build plan. They read as a
conversation: what was asked, what came back. Each answer still becomes a
clarification on the work item, so it reaches the AI without anyone re-typing
it — the mechanism is unchanged, only where it lives and how it reads.

**Per work item, not per change.** I had flagged this as the open decision and
then kept deferring the whole feature on it, which was the wrong trade. Per work
item is what `ai_feedback` already supports, what the clarifications already
flow from, and what makes the tab useful today. Anchoring a question to the
individual change it is about is a real improvement and still worth doing — it
is a migration, and it can be done under a chat that already exists.

### Implemented

- `components/planning/FromProduct.tsx` — what Product asked for (description,
  risk, the changes wanted), read-only, and the conversation. `role="log"` on
  the chat so a screen reader reads new entries as they arrive. An empty half is
  **said** — "Product has not described this yet" — because silence reads as
  "Product had nothing to say", which is a much more comfortable and quite
  different claim.
- `components/planning/WorkItemBuildPlan.tsx` — two tabs over the two sides,
  reusing `SectionTabs` (`as="buttons"`, since the page has a tablist already).
  The Product tab carries the count of unanswered questions in its label, so a
  developer sees there is something waiting without switching to look.
- The develop side is **hidden, not unmounted**, when Product's tab is showing:
  it holds unsaved edits in its own boxes, and switching tabs must not throw
  away something half-typed.

### Tests

cargo 681/681 (23 ignored), Vitest 612/612, `tsc --noEmit`, `npm run build` and
clippy `-D warnings` clean. Four new Vitest tests on `FromProduct`:

- What Product asked for is shown, and **the only textbox on the panel is the
  one for asking a question** — the assertion that pins "read-only" as a fact
  rather than an intention.
- An empty description and an empty ask-list are each said out loud.
- The questions read as a conversation, with an answer box on the open one and
  none on the settled one.
- Asking and answering call through.

Three existing assertions moved to the new home: the questions are behind the
Product tab now, and the waiting list became a `log`.

### Your Feedback

- **The handover block you asked about is unchanged and I did not touch it.**
  `.coperativeai/briefs/<item>.md` is the file the app writes into the working
  copy holding everything it knows about the work; the `claude "Read … and
  implement it."` line is what you paste into a terminal to start an agent on
  it; "Show the brief" reads that file back in-app. It is the **manual** route.
  The Runs panel's **Start** does the same thing and more — worktree, terminal,
  types the command — so this block is arguably redundant now. Worth deciding
  deliberately rather than leaving two routes that look like alternatives.
- **The `.md`/`.json` line is about a different pair of files** — the work
  item's own documents, not the brief. Two sentences about files, next to each
  other, describing different things: confusing, and worth merging into one
  statement about what is on disk.

### Technical Debt

- **Questions are still per work item, not per change** (above). A developer
  asking about one screen among six writes the screen's name into the question
  by hand.
- **Two routes to an agent, side by side**, and nothing says which to use.
- **Two adjacent sentences about written files** describing different files.

---

## Round 57 — one route to an agent, one sentence about files

### My Feedback

**Two routes to an agent, side by side, is a choice nobody made.** This panel
wrote a brief and offered a command to paste; the Runs panel's **Start** writes
the brief, makes a worktree, opens a terminal and types the command itself.
Checking before deleting mattered: `start_run` calls `change_run::prepare` and
builds its own brief, so **Start was never depending on this panel having
prepared anything** — nothing was lost by removing it.

That also removed the reason for round 55's prepare-on-save: it existed to keep
this block's brief fresh, and with the block gone it had no consumer. Round 55's
*idempotence* fix stays useful — it now guards Start being pressed twice.

**The Code tab's hand-over stays**, and is a different thing: it sends the
command into a shell already open beside the editor rather than offering one to
copy.

### Implemented

- `components/planning/HandoverPanel.tsx` and its test — deleted.
- `WorkItemBuildPlan` — the block, the import, and the `savedAt` wiring gone.
- The two adjacent file sentences merged into one: what is written on save, and
  where the agent's brief actually comes from.

### Tests

Vitest 608/608, `tsc --noEmit`, `npm run build` clean. cargo untouched
(681/681 from round 55).

### Your Feedback — two things that already exist

Both were asked for as if missing, and building them again would have made a
third place to say the same thing, which is what this run of rounds has been
removing:

- **Branch name and unit tests are already editable**, per Solution, inside
  "What this changes" — `WorkItemChanges` saves `branchName`, `cloneFrom` and
  `unitTests` on the plan. If they are hard to find that is a layout problem,
  not a missing feature.
- **Product's mockups already reach the agent.** A change carries its mockup
  path, the brief writes "(shown in …)" beside the change it belongs to, and
  `build_change_plan_prompt` takes the images themselves for generation. What is
  missing is not the plumbing but a statement in the brief telling the agent to
  go and look at them.

### Technical Debt

- **The brief names a mockup but does not tell the agent to open it.** The path
  is there; nothing says "read this picture before building the screen".

---

## Round 58 — Plan and Execute, and the silence around them

### My Feedback

**"I clicked Plan and nothing happens" was two separate silences, and neither
was a swallowed error.**

1. **The button was disabled and said nothing.** `submit_for_planning` returns
   at once and the panel does show a notice on success and an error on failure —
   nothing was lost. But with no Solution attached the button was greyed with no
   reason given, and a disabled button that says nothing is indistinguishable
   from a broken one.
2. **Planning runs elsewhere and the panel never listened.** It is queued and
   returns immediately, so the panel looked identical before, during and after;
   the plan appeared only if somebody happened to reopen the item. The backend
   has emitted `ai-job-changed` on every job move all along, and `workSignal`
   already fans it out — this panel simply had nobody listening.

**Execute is the approval, not a bypass of it.** `start_run` refuses an
unapproved plan and generating clears the approval, so "plan then execute
automatically" would always have been refused unless the app approved on the
user's behalf — which is the framework's core promise. Pressing Execute *is* a
person saying go, knowingly. It also stops dead on a decline: an AI that said it
could not write the plan is not an AI whose plan should be handed to an agent.

**A description could be written once and never corrected**, which the new
validation exposed rather than caused: it was set at creation and appeared in no
update path, so the one field an agent builds against was the one field a typo
was permanent in. And the validation pointed at a box that did not exist.

### Implemented

- **Plan / Execute**, replacing Submit / Generate. Plan queues; Execute plans,
  approves and starts.
- **`whatIsMissing`** — a pure function listing *every* reason a plan cannot be
  asked for, not just the first, so they are fixed in one pass.
- **Job status in the panel** — queued, running, failed with its message,
  blocked pointing at the question. Both buttons wait on an in-flight job: a
  second submission plans the same item twice and pays twice.
- **`work_item::set_description`** and a **"What this is" box on the Product
  board** — its own writer rather than a field on `WorkItemFields`, which is
  replaced wholesale and would have made a description edit able to silently
  unassign somebody.
- **The brief tells an agent to open the mockups.** The paths were already
  there; nothing said to look at them, which wasted the one artefact Product
  produces that says what a screen should look like. Written only when there is
  a picture — an agent told to open mockups that do not exist goes looking.
- **`vcs::list_branches` and a "Branch from" datalist.** A list you can still
  type into, deliberately: the repository may not be on this machine, so an
  empty list is legitimate, and a branch can be made between the list being read
  and the run starting. Remote branches are included under their short name,
  because the branch you cut from is usually one you have never checked out.

### Tests

cargo 685/685 (23 ignored), Vitest 613/613, `tsc --noEmit`, `npm run build` and
clippy `-D warnings` clean. New: the queued/running/failed states and that both
buttons wait; every reason listed rather than the first; plan-approve-start in
one press and **not** past a decline; a description written after creation and
cleared back to "nothing said"; remote branches under their short name and
`origin/HEAD` excluded; the brief's mockup instruction, present only with a
picture.

Two test-shape notes worth keeping: the branch test caught my own bug — the
first version stripped `feature/` from a local branch `feature/checkout` — and
the mockup test builds its own document rather than adding a screen to the
shared fixture, which would have given every other test a screen it did not ask
for and broken the one proving an empty kind gets no heading.

### Your Feedback

- **"Branch from" is a datalist, not a `select`.** A closed dropdown would be
  wrong the moment the working copy is missing or a branch is made elsewhere.
- **The status is text, not a spinner.** Queued and running are different
  states, and a spinner on a queued item claims it is working when it is
  waiting its turn.
- **Two things asked for already existed** — branch name and unit tests are
  editable per Solution under "What this changes", and Product's mockups already
  reached the agent. Only the instruction to open them was missing.

### Technical Debt

- **The work item's own `status` is untouched by planning.** The panel says
  planning is running; the item still reads `planned` on the board. Moving it
  would need a rule about what happens when planning fails, which nobody has
  written.
- **Questions are per work item, not per change.**
- **`Execute` starts every attached Solution in turn**, and a failure partway
  through leaves earlier ones started — there is no "all or nothing".

---

## Round 59 — policy is Admin's, and two settings that were buried

### My Feedback

**"Product should not be setting AI policy."** Right, and the codebase already
agreed with you in writing: the Developer Rules editor carries the comment
*"Editable in Admin, where policy lives"*, and Admin's own AI section says
*"Set by Admin rather than by whoever is doing the planning."* The **per work
item** policy simply never followed the rule it was written beside — it sat on
the planning card, putting a governance decision in front of the one role that
should not be making it.

**Two things you asked for already existed and were buried**, which is its own
kind of missing:

- **Model and effort per complexity** — exactly what you described, defaults
  and all (Sonnet/low, Sonnet/medium, Fable/xhigh). It was **two folds deep**:
  Admin → AI → Claude setup → *Advanced* → AI settings → tiers. A setting that
  decides what every routed call costs does not belong behind two disclosures.
  It is now the first thing in Admin → AI.
- **A work item's description** had no editor at all — settable at creation and
  never afterwards. That is why the new validation pointed at a box that did not
  exist. Product's board now has a **"What this is"** field.

### Implemented

- `PolicyEditor` moved from the Product board to **Admin → AI**, under a work
  item picker for the chosen Product. `onClose` became optional — it is a
  popover there and a section here, and a Close button on a page section is a
  button that does nothing.
- `ClaudeTiers` lifted out of the Advanced fold to the top of Admin → AI.
- `work_item::set_description` + `set_work_item_description` + the Product-board
  box, as its own writer rather than a field on `WorkItemFields` — that struct
  is replaced wholesale, so a description edit through it could silently
  unassign somebody.
- The build plan's validation now checks the **policy** too, so deny-by-default
  is said before the press rather than discovered as a failed job.

### Tests

cargo 685/685 (23 ignored), Vitest 614/614, `tsc --noEmit`, `npm run build` and
clippy `-D warnings` clean. The board's policy test moved out and became its
opposite — *"does not offer AI policy on a planning card"*, pinning the
boundary — plus a new one for writing a description after the item exists, and
assertions that no permission and no provider are each named before the press.

### Your Feedback

- **The redesign you described next is not a rename and I have not started it.**
  Moving permission to a Product or Solution, keeping provider and effort per
  work item with defaults, and letting QA set their own effort splits one
  concept into two — *may the AI touch this* and *which model runs it* — and
  changes the gate every AI call in the app passes through. It needs its own
  round and some answers first.

### Technical Debt

- **Permission is still per work item**, which means an item created today is
  denied until somebody visits Admin and permits it — the friction that
  prompted the redesign.
- The work item's own `status` is still untouched by planning.

---

## Round 60 — permission moves up: the data layer

### My Feedback

**"Product with a per-Solution override, and a developer and QA default."** That
splits one table into two ideas, and the split is the whole point:

- **Permission** is governance — *may the AI touch this at all*. A Product's
  policy, overridden per Solution where a repository genuinely differs.
- **Routing** is a working decision — *which provider, how hard*. A default per
  area, which a developer may override on one work item.

They were one row in `work_item_policy`, which is why a new work item was denied
until somebody permitted it individually, and why permission had to be granted
again for every item forever.

**"There are none"** settled the migration question, so this is a clean build
rather than a data rescue.

**The override is total, not per-flag.** If a Solution has a row it is the
answer, including when it is more restrictive than the Product's — a partial
override would mean reading two rows to know what is permitted, and the
commonest reason to override at all is to say *less* than the Product does.

**Reading is the floor.** Editing and generating tests both imply reading, so
neither is permitted while reading is not. A policy that allowed writing a test
for work the AI may not look at would be incoherent.

### Implemented — the data layer only

- `db/ai_permission.rs` — the walk (**Solution override → Product → no**), the
  `Verdict` carrying *where the answer came from*, and `refusal` turning that
  into a sentence naming what to go and change. Deny-by-default survives: no
  override and no Product policy is still no.
- `db/solution_policy.rs` — the override table. **Absent means "not
  overridden", not "denied"**, which is the distinction the whole walk rests on.
- `db/product_policy.rs` — gains `allowEdit` and `allowGenerateTests` by
  `ALTER TABLE`, so a Product can express everything a work item could. A
  policy is somebody's decision about what an AI may do to their work;
  rebuilding the table to add a column would silently revoke it.

### Tests

cargo 693/693 (23 ignored), clippy `-D warnings` clean. Eight new: permitting a
Product permits its work; a Solution override beats the Product's, including
when more restrictive; an override on one Solution does not leak to another;
reading is the floor under edit and generate-tests; work with no Solution reads
the Product's policy; a refusal names where to go; an override round-trips and
clears back to following the Product; unknown Solutions and efforts refused.

### Your Feedback

**This is deliberately half a round.** What is built is additive and proven —
nothing is half-wired, and every existing gate still behaves exactly as before,
because nothing reads the new walk yet. What remains is where the risk is, and
it should start fresh rather than at the end of a long session:

1. **Rewire the three gates** — `resolve_item_ai_gate`,
   `resolve_test_implementation`, and deliverable generation — onto
   `ai_permission::verdict`, then stop reading `work_item_policy`'s permission
   columns.
2. **Routing defaults**: a developer default and a QA default per Product, with
   the work item's own provider and effort as the developer's override.
   `work_item_policy` keeps only those two columns.
3. **Admin UI**: permission per Product with a Solution list for overrides, both
   defaults, and the per-item permission editor removed.

### Technical Debt

- **The new walk has no callers yet.** Permission is still resolved per work
  item, so the friction that prompted this is still there until step 1 lands.
- `work_item_policy` still carries permission columns that will stop being read.

---

## Round 61 — the regression, and finishing what round 60 left

### My Feedback

**"AI planning policy doesn't work" was mine, and it is the interesting part.**
Round 60 added two arguments to the `set_product_policy` command and did not
update its caller. The Tauri boundary is **not typechecked** — the frontend
passes an object, the backend deserialises it — so `tsc` was clean, all 614
Vitest tests passed, clippy passed, and the panel was broken the moment it was
loaded. Every gate this project runs was green over a feature that could not
save.

That is worth writing down: **a changed command signature is a contract change
with no compiler on the other side.** The only thing that would have caught it
is a test that goes through `invoke`, and there is none.

**"Still here" was also fair.** I stopped round 60 after the data layer and said
so, but from the screen's side nothing had changed — the section still said "per
work item" two messages after being asked to change it. Explaining a partial
delivery is not the same as delivering.

### Implemented

- **The regression fixed**: `setProductPolicy` and the `ProductPolicy` type
  carry `allowEdit` and `allowGenerateTests`, and the panel has switches for
  them — the two permissions that moved up from the work item.
- **"What the AI may do, per work item" is gone.** In its place, **per
  Solution**: each of the Product's Solutions listed, each following the
  Product's policy until somebody overrides it. `SolutionAiPolicy` says which
  state it is in and offers the way back — "Follow the Product instead".
- `get_solution_policy`, `set_solution_policy`, `clear_solution_policy` and
  their wrappers.
- `PolicyEditor` is no longer rendered anywhere.

### Tests

cargo 693/693 (23 ignored), Vitest 614/614, `tsc --noEmit`, `npm run build` and
clippy `-D warnings` clean.

### Your Feedback

- **Nothing yet reads the new walk.** The gates still resolve permission per
  work item, so what you set on a Product or Solution does not gate anything
  until `resolve_item_ai_gate`, `resolve_test_implementation` and deliverable
  generation are rewired. **The screen now describes a model the backend is not
  yet enforcing**, which is a worse state than either end being consistently
  old — it should be the very next thing done.
- **The routing defaults are not built.** Provider and effort are still per work
  item only, with no developer or QA default to fall back on.

### Technical Debt

- **A command signature can change with nothing to catch its caller.** No test
  crosses `invoke`; every one of them mocks it. Worth one end-to-end check per
  command, or at least a generated type for the boundary.
- **The UI is ahead of the gate** (above) — the highest-priority item.

---

## Round 62 — the gates now read the walk

### My Feedback

**The UI stops describing a model the backend was not enforcing.** What you set
on a Product, or override on a Solution, is now what actually gates the AI.

**One question, asked as the use it is.** The test gate used to permit for
*reading* and then check a second flag for *writing tests* — two reads of two
tables to answer one question, and a refusal that named neither. It now asks
`resolve_item_ai_use(…, GenerateTests)` once, and the refusal says which policy
said no and whether to change the Product's or override the Solution's.

**Permission moved; routing stayed.** That is the split you asked for and it is
visible in the resolution order:

- **Permission** — the Solution's override, then the Product, then no.
- **Routing** — the work item's own provider and effort if a developer set
  them, otherwise the permitting policy's.

So `work_item_policy` survives as a **routing override**, not as a permission.
Its permission columns are no longer read by anything.

**The verdict carries the effort**, which it did not when I first wrote it — the
gate would otherwise have had to invent a default when an item had no override,
and a guessed effort is a guessed bill.

### Implemented

- `commands/work_items.rs` — `resolve_item_ai_use` (the real gate) with
  `resolve_item_ai_gate` kept as the `Read` case, so every existing caller works
  unchanged.
- `commands/test_cases.rs` — asks for `GenerateTests` directly; the second check
  and its hand-written message are gone.
- `db/ai_permission.rs` — `Verdict` gained `effort_tier`.
- Deliverable generation left alone deliberately: it is gated on the **Product**
  policy already, which is the model you asked for — it was right before this.

### Tests

cargo 694/694 (23 ignored), Vitest 614/614, `tsc --noEmit`, `npm run build` and
clippy `-D warnings` clean.

The new one is the one that matters: **the item overrides the routing the
permission defaults to** — a Product permits and names a cheap provider at low
effort, the gate uses it, then a developer says this item is harder and names a
dearer one, and that wins. Three existing tests changed from granting on the
work item to granting on the Product, which is the behaviour change stated as
tests rather than described in a comment.

### Your Feedback

- **A work item with no Solution falls to the Product**, which is right for the
  plenty of work that is not code — but it means a Solution override cannot
  restrict work nobody has attached to a repository yet. Worth knowing; the
  alternative is refusing unattached work outright, which would block planning
  before the Solution is chosen.
- **The routing defaults are still not built.** The fallback today is the
  permitting policy's own provider and effort, which is a reasonable stand-in —
  but there is no separate **developer default** and **QA default** yet, so QA
  generation and developer planning share one fallback.

### Technical Debt

- **`work_item_policy` still has permission columns nothing reads.** They should
  go, along with the parts of `is_allowed` no longer called.
- **No developer/QA routing defaults** (above) — the last piece of the model you
  described.
- **Nothing crosses `invoke` in the tests**, which is how round 60's regression
  shipped green.

---

## Round 63 — the defaults, and two bugs the redesign caused

### My Feedback

**"Allow reading… won't turn on" was the same mistake as round 60, one layer
along.** `ProductPolicyDto` did not carry the two new permissions, so the panel
loaded a policy without them, sent `undefined` back, and the Rust command failed
to deserialise — **every** switch on that panel, including the two that had
nothing to do with the change. Second time the Tauri boundary has done this in
four rounds. It is no longer a slip; it is a missing guard.

**"The Plan button is greyed out" was me too, and it is the sharper one.** The
validation still asked `getWorkItemPolicy` — the *work item's* policy — for
permission, after permission had moved to the Product. So it read `null`,
concluded nothing was permitted, and disabled the button **for exactly the
friction this redesign existed to remove.** The screen and the gate were asking
different questions about the same thing.

The fix is the general one rather than a patch: `check_item_ai_permission`
exposes the gate's own walk, and the panel asks *that*. A button and a backend
that disagree is how a screen ends up blocking work the backend would have
allowed — the only way to be sure they agree is to have them ask the same
question.

**The stale message you saw** — "Set its work-item AI policy" — was a stored job
record from before the rewire, shown as though it were current. It now reads as
*the last attempt*, which is what it is.

### Implemented

- **The defaults**: `db/routing_default.rs`, one per Product per area
  (`develop`, `test`). Resolution in the gate is now **three places, most
  specific first**: what a developer said about this item → this area's default
  → the policy that permitted it. Each is somebody's decision; none is a guess.
  `area_of` sends `GenerateTests` to QA's default and everything else to
  Develop's — writing tests is QA's work whoever pressed the button.
- **`ProductPolicyDto` carries the two new permissions** (the bug).
- **`check_item_ai_permission`** and the panel using it (the other bug).
- **Planning says both outcomes**: "Planning passed — the plan is below" as well
  as the failures, because a run that finished silently is indistinguishable
  from one that never happened. Failures are worded as *the last attempt* and
  the button is available again, which it already was.

### Tests

cargo 698/698 (23 ignored), Vitest 614/614, `tsc --noEmit`, `npm run build` and
clippy `-D warnings` clean. Four new on the defaults: each area keeps its own;
nothing said is `None` rather than a guessed model; setting twice replaces;
unknown area, effort or Product refused.

### Your Feedback

- **`whatIsMissing` now takes the backend's own refusal text** rather than
  composing its own. Less pretty, and correct: there is one wording, from the
  code that actually decides.
- **The QA default is wired but has no UI yet**, and neither does Develop's.
  They resolve correctly and fall back to the permitting policy, so nothing is
  broken — but until Admin can set them, the fallback is all there is.

### Technical Debt

- **Nothing in the test suite crosses `invoke`.** Two shipped regressions now
  have come through that gap, both invisible to cargo, Vitest, tsc and clippy.
  This should stop being a debt line and become a test.
- **No Admin UI for the two routing defaults** (above).
- `work_item_policy` still carries permission columns nothing reads.

## Round 64 — the stuck queue, the boundary test, and a plan you can argue with

### My Feedback

**"The Plan and Execute are grayed out" was a job nobody would ever pick up.**
`fail_interrupted` swept `running` at startup and left `queued` alone, on the
reasoning that a queued job "never started, so it is still waiting". That is
only true if something later reads the queue. Nothing does — the runner is
spawned when a job is *submitted*, and no sweep looks at the queue on launch. So
a job queued when the app closed waits forever; `submit` refuses a second job
while one is outstanding; and the panel, which disables both buttons while a job
is in flight, greys them out permanently. Three correct-looking rules, one dead
row, and a screen that looks broken.

**The boundary test exists now, and it found a live mismatch on its first run.**
`setModelPrice` sent `inputPencePerMTok`; the command takes
`input_pence_per_mtok`, which is `inputPencePerMtok` on the wire. Neither
direction would have worked. Nothing in the UI calls it yet, so nobody had hit
it — which is exactly the kind of thing a gate should catch before somebody
does. Three shipped regressions had already come through this seam, all invisible
to cargo, Vitest, tsc and clippy. It is a test now rather than a debt line.

**"A single text box is not user friendly" is the right complaint about the
plan.** The model returns one long line — `src/main.rs (console entry point:
…); src/greeting.rs (pure function …)` — and it was rendered as a `<pre>` at
the bottom of the panel people type into. The plan is the thing somebody is
being asked to *approve*, and it was formatted as something to scroll past, with
no way to correct a wrong path short of paying for another generation.

### Implemented

- **`fail_interrupted` sweeps `queued` too**, with the message saying which it
  was — a running job may have spent money, a queued one certainly did not.
- **`TauriBoundary.test.ts`**: reads `generate_handler!`, every
  `#[tauri::command]` signature and every `invoke(…)` in `backend.ts`, and
  compares them. It follows `{ ...rules }` to the interface behind it, because
  spreading a typed object is how the longest argument lists are sent — and a
  long argument list is where a new parameter goes unnoticed. Unreadable
  payloads report nothing rather than guessing.
- **The AI planning tab** (`AiPlanReview.tsx`): per Solution, a row per file
  with its reason beside it rather than concatenated into it. `parseFiles`
  splits at paren depth zero, because the notes are prose and prose has
  semicolons in it. Two ways to change a plan: **edit it yourself** — no model
  call, nothing else moves — or **tell the AI what to change**, which sends the
  instruction *with the current plan* so it revises rather than starting over.
  Both go through `set_generated`, so both withdraw approval; that rule lives
  one layer down and neither route can forget it.
- **`save_plan_schemas`** and `generate_change_plan(work_item_id, instruction)`.
- **The `<pre>` blocks are gone from "What this changes"**, replaced by one line
  pointing at the tab. Same rule as every other duplicate this app has removed:
  one place, or they drift.

### Tests

cargo 700/700 (23 ignored), Vitest 634/634, `tsc --noEmit`, clippy `-D warnings`
and `npm run build` clean. New: two on the revision prompt (it carries the plan
being revised and says to keep the rest; a first generation is not described as
a revision), seven on the boundary in both directions, and thirteen on the
planning tab — including the real string from your report, and a semicolon
inside a note.

### Your Feedback

- **The plan tab shows every Solution, and a revision rewrites all of them.**
  The command generates per work item, not per Solution, so "change this one" is
  not something the button can honestly offer yet. The hint says so.
- **Editing the plan withdraws approval**, including for a one-character path
  fix. That is deliberate — consent belongs to the version that was read — but
  it will feel heavy if you are tidying paths.

### Technical Debt

- **Still no Admin UI for the developer/QA routing defaults.** Carried from 63.
- **The boundary test does not compare DTO shapes**, only argument names. The
  `ProductPolicyDto` regression in round 63 was a missing *field* on a returned
  struct, and this would not have caught it.
- `work_item_policy` still carries permission columns nothing reads.
- Nothing prunes superseded brief files; work item `status` is still untouched
  by planning.

## Round 65 — the plan reaches the briefing, and Plan bows out

### My Feedback

**Execute was re-planning what was already planned.** It generated
unconditionally, then approved and started. Once the AI planning tab existed
that became actively wrong: pressing Execute threw away the plan somebody had
just read — and possibly corrected by hand — and charged for the replacement.
So Execute now generates *only* when there is nothing planned, and the Plan
button disappears once there is. Planning again is still available, in the one
place it belongs: beside the plan, on the AI planning tab.

**"Every, not any."** `isPlanned` requires every attached Solution to have
something generated. One planned and one not is not a planned work item —
Execute would start an agent on the unplanned half with nothing to build from.

**The briefing was the one screen that could not show the plan.** Develop →
Work → Ready draws an "Agent briefing" down the right whose entire job is *this
is what an agent would be handed* — description, Solutions, branch, tests,
open questions, readiness. It said nothing about the files the AI worked out.
It does now, per Solution, using the same parser the planning tab uses.

**Which meant an extraction, not a copy.** `parseFiles`, `formatFiles` and
`isPlanned` moved to `lib/plan.ts`. Two readers of a plan that parsed it their
own way would eventually disagree about what the plan says — and the second
reader is a list view, which had no business importing a panel with
`generateChangePlan` behind it just to split a string.

### Implemented

- **`lib/plan.ts`** — the plan-reading rules, pure, no React.
- **`isPlanned` drives both the buttons and the wording**: Plan is not rendered
  once there is a plan, Execute's hint changes to say it approves what is there,
  and the running message says "Approved and started" rather than claiming to
  have planned.
- **"What the AI planned" in the agent briefing**, with a `planned` /
  `not planned` chip on the block head and the model's reason under each path.
  Named per Solution only when there is more than one — a flat list of paths
  across three repositories does not say which repository each is in.

### Tests

Vitest 639/639, `tsc --noEmit` and `npm run build` clean; cargo and clippy
untouched this round. Five new: `isPlanned` on four shapes, only Execute once
planned, Execute running the plan that is there without calling the model, and
the briefing showing the files — and saying so when there are none.

### Your Feedback

- **I read "Develop → work → agent Tree" as the Agent briefing** in the Ready
  view — the panel under Develop → Work that lists what an agent would be
  handed. If you meant the file tree in Build, or the agent lane down its left,
  say so and it goes there instead; the parser is shared now, so it is a small
  change either way.
- **The briefing shows files, not the API and page schemas.** They are long
  enough to push the readiness list off the screen, and the tab is one click
  away.

### Technical Debt

- Carried: no Admin UI for the routing defaults; the boundary test compares
  argument names but not DTO shapes; `work_item_policy` keeps permission columns
  nothing reads; nothing prunes superseded brief files; planning still does not
  move the work item's `status`.

## Round 66 — git as a first-class thing, and three panes that were one

### My Feedback

**"`…\hello-world` is not a git repository" was a dead end inside the app.**
Every route out of it — status, worktree, run — refused for that same reason,
and not one of them offered `git init`. The panel that talked about
repositories talked only about GitHub, so a folder with no `.git` read as "No
repository linked" — and linking one would not have fixed it. Two different
questions had been collapsed into one.

**Initialising has to leave a repository a run can actually use.** `git init`
alone swaps one refusal for another: `add_worktree` branches from a commit, so
a fresh repository fails with "invalid reference: HEAD", which reads like the
app doing nothing twice. `init_repo` commits what is in the folder, names the
branch `main` rather than leaving it to whatever git is configured with, and is
idempotent — pressing it on a working repository says so instead of erroring,
because somebody who cannot tell whether it worked will press it again.

**The console was a debugging tool sitting under the code at all times.**
"Terminal will open in Hello world / Open terminal / Debugger output / Nothing
printed yet" occupied the bottom of the screen for everyone reading code. It is
a tab now, and the tab does not exist until Debug has been pressed.

### Implemented

- **`vcs::repo_state` and `vcs::init_repo`**, `solution_git_state` and
  `init_solution_repo`. Three states, not a bool: no folder, a folder that is
  not a repository, and a repository with nothing committed — each needs a
  different sentence and a different button.
- **`SolutionRepo` is the one git panel** and loads its own state, which is what
  lets it be dropped wherever a Solution is looked at. It now leads with the
  local folder, and offers *Make it a git repository* beside *Link existing* and
  *Create new*. Visibility is two radios rather than a "Private" tick —
  publishing is the consequential half and a checkbox says it in the negative.
- **Three placements**: a **Git tab** on the build plan (Develop → Work), the
  **Map inspector** (Develop → Planning), and the Solutions list where it was.
  The inspector's two dead facts — "Working copy: not set", "Repository: not
  linked" — are now the place they are fixed.
- **Code / Work item tabs in Build.** Picking an agent used to stack its
  workbench and the code pane in one column: a file's diff above the file
  itself. Hidden rather than unmounted, so a half-typed edit survives switching.
- **A Debug output tab**, holding the console, mounted from the first press of
  Debug and hidden thereafter — never unmounted, or a trip to the code would
  kill the shell.

### Tests

cargo 702/702 (23 ignored), Vitest 651/651, `tsc --noEmit`, clippy `-D warnings`
and `npm run build` clean. New: two on `init_repo` (a plain folder becomes one a
worktree can be cut from; pressing it twice says so rather than failing), seven
on the git panel's states and actions, two on the build plan's Git tab, and
three on the Build view's panes.

### Your Feedback

- **"Only show when I am running debug" is implemented as "once you press Debug
  in this Build session".** Nothing tells this view that a debug session has
  *ended* — the board owns its own shells — so the tab stays available until you
  leave Build. If you want it to disappear the moment the last session stops,
  that needs the board to report session state upward.
- **Creating a GitHub repository does not push the folder to it.** It creates
  the repo and records the URL; wiring the remote and the first push is a
  separate step nothing does yet.

### Technical Debt

- No `git remote add` / first push after Create new (above).
- Carried: no Admin UI for the routing defaults; the boundary test compares
  argument names but not DTO shapes; `work_item_policy` keeps permission columns
  nothing reads; planning still does not move the work item's `status`.

## Round 67 — why Execute would not run, and three panes that pull out

### My Feedback

**"Hello world (no AI budget is set for this Product)" was a job that had just
succeeded.** The job runner wrote `format!("{} ({})", created, reason)` — the
Solutions it planned, and beside them the *routing* reason in brackets. Every
call carries one and it is always recorded; the two quiet ones say only that
nothing unusual happened. In brackets after a result, "no AI budget is set"
reads as the reason it failed. `router::worth_saying` decides, beside the
strings it classifies, and a test walks the reasons `route()` really produces:
a handover or a warning is worth repeating — it changed the model, or is about
to — and "no budget" and "within budget" are not.

**Execute would not run because the folder is not a git repository.** That is
the same thing round 66 was about, discovered at a different door:
`add_worktree` refuses it, and refuses a repository with no commit for a second
reason ("invalid reference: HEAD"). Both messages say what is wrong and nothing
about what to do, so `prepare_run` now checks first and names the button —
Git tab, "Make it a git repository" — because this press is where somebody finds
out.

**Clicking a file opened it into a pane that was not showing.** The tabs added
last round defaulted to the work item when an agent was selected, so the tree's
click did nothing visible. It switches to Code now. The workbench still points
at the same file, so its diff is there when you switch back — the two are
different questions about one file, which is why they are two tabs.

### Implemented

- **`router::worth_saying`**, and the job message reading `Planned Hello world`.
- **The pre-flight in `prepare_run`**, naming the fix for both git states.
- **Create new now connects and pushes**: `vcs::set_remote` (set, not add — a
  folder pushed somewhere before already has an `origin`, and `remote add` fails
  on it), then `push`. Reported rather than raised: the repository *was*
  created, and a failed push must not read as though it was not, so the sentence
  says how far it got.
- **The Debug output tab comes and goes with the sessions.** `DebugBoard`
  reports how many Solutions have a shell or a debugger mounted, because "am I
  debugging?" is only answerable from inside it. At zero the tab goes and the
  pane falls back to the code, so it cannot vanish under what it was showing.
- **Every section pulls out**: `open_work_item_window` and `open_file_window`,
  rendered by `StandaloneBuildPane`, which reads the record from its id rather
  than being handed copies in query parameters. One window per file, because the
  reason to pull one out is to hold it beside another. The console keeps its own
  drag-out on its header — two answers to one question would be worse.

### Tests

cargo 704/704 (23 ignored), Vitest 652/652, `tsc --noEmit`, clippy `-D warnings`
and `npm run build` clean. New: the reason classification over the router's real
outputs, the query encoder against the characters a Windows path actually has,
the pull-out per pane, and the debug tab appearing on attach and going on
detach.

### Your Feedback

- **The plan is not what stopped Execute** — it planned fine. What stopped it
  was the working copy, at the worktree step, which is why the message now
  points at the Git tab rather than at the AI settings.
- **Pushing needs git to be able to authenticate.** Creating the repository uses
  the GitHub token; the push uses whatever git on this machine is set up with.
  If it fails, the sentence says so and the repository is still there to push to.

### Technical Debt

- The pulled-out work item searches every Product's items to find one by id;
  there is no `get_work_item` command and this is the read that would want it.
- Carried: no Admin UI for the routing defaults; the boundary test compares
  argument names but not DTO shapes; `work_item_policy` keeps permission columns
  nothing reads; planning still does not move the work item's `status`.

## Round 68 — one read for one work item, and the error that erased itself

### My Feedback

**"Execute is not working" was, in part, a message that deleted itself.** The
panel had one `error` state, and `refresh` cleared it on every successful read
— which happens on every work-changed signal: a job finishing anywhere in the
Product, a save in the changes block mounted inside this same panel, the
panel's own reload. So "'Shop API' is not a git repository" appeared and was
gone. A failure that erases itself within a second is indistinguishable from a
button that does nothing, which is exactly what it was reported as.

The test written for it could not find the alert **even once** — worse than the
diagnosis, and the proof that this was not a subtle race. There are two errors
now: `loadError`, which is about the read that just happened and is cleared by
the next one, and `actionError`, which is about the last press and is cleared
only by the next press.

**`get_work_item` exists because a window that knew exactly what it wanted was
reading the whole workspace to find it.** The pulled-out build plan had only
`list_work_items` per Product, so it walked every Product's items looking for
one id.

### Implemented

- **`get_work_item(work_item_id) -> Option<WorkItemDto>`**. `None` rather than
  an error when it is gone: an id in a URL outlives the row it names, and that
  is a sentence for the screen to write, not a failure to report.
- **The pull-out uses it**: one read for the item, one for the Solutions its
  panel offers, in parallel.
- **The two errors split** in `WorkItemBuildPlan`, and a press clears its own
  error before starting rather than leaving the last one standing.

### Tests

cargo 704/704 (23 ignored), Vitest 656/656, `tsc --noEmit`, clippy
`-D warnings` and `npm run build` clean. New: the Execute failure surviving a
work-changed reload, and three on the pulled-out window — it asks for one item
and never lists, it says so when the item has gone, and a pulled-out file reads
its Solution.

### Your Feedback

- **If Execute still fails after this, the message will now stay put** and name
  what stopped it. The pre-flight from round 67 covers the two git states; a
  message that says anything else is worth sending back to me verbatim.
- **The split is only in the build plan.** Other panels still share one error
  state; none of them mounts a child that refreshes them, which is what made
  this one bite, but the pattern is worth repeating if it shows up again.

### Technical Debt

- Carried: no Admin UI for the routing defaults; the boundary test compares
  argument names but not DTO shapes; `work_item_policy` keeps permission columns
  nothing reads; planning still does not move the work item's `status`.

## Round 69 — the failure box, because saying it quietly is not saying it

### My Feedback

**"Execute failed but no error is appearing."** After round 68 the message was
no longer being erased — it was being *said where nobody was looking*. The
build plan renders inside the workbench inside the Build view, and its alert
sits at the top of a section long enough to have scrolled away. A panel telling
itself is not the same as somebody being told.

**So the report is separate from the display.** `lib/failures.ts` is the same
shape as `workSignal` and for the same reason: the failure happens four
components from the one part of the screen that is always visible, and
threading a callback through all four would put a reporting concern into every
component between them — each forgetting it in a different way.

**Only the last one, and only a person clears it.** A list would be a log; this
is a message, and "what just went wrong?" has one answer. Nothing dismisses it
on the reader's behalf — not a reload, not a later success elsewhere — because
whether it has been read is not something to guess at.

### Implemented

- **`reportFailure` / `useLastFailure`**, and a failure box at the top of the
  ship rail: what was pressed, the backend's own sentence unreworded, and
  Dismiss. Above the tabs, because it is not one of them.
- **Reported from every press that can fail**: Execute, Plan, saving in the
  build plan, and the rail's own Review, Keep and Discard.
- Each still says it in place as well. The rail is the shout, not a replacement
  for the panel saying what happened where it happened.

### Tests

cargo 704/704 (23 ignored), Vitest 661/661, `tsc --noEmit`, clippy
`-D warnings` and `npm run build` clean. Five new: the box shows what failed in
the backend's words, shows one that happened before the rail was on screen,
stays until dismissed, says nothing when nothing has failed, and — end to end —
a press deep inside the workbench reaching the rail.

### Your Feedback

- **If Execute still fails with nothing on the rail**, then the press is not
  reaching a `catch` at all, which would be a different bug and worth saying so
  — that is now a meaningful distinction rather than a shrug.
- **The box is per session, not per run.** It is the last thing that went
  wrong anywhere in Build, not a history against the agent, and switching
  agents does not clear it.

### Technical Debt

- Only the Build view shows the box. Product and Test have presses that can fail
  the same way and no rail to put one on.
- Carried: no Admin UI for the routing defaults; the boundary test compares
  argument names but not DTO shapes; `work_item_policy` keeps permission columns
  nothing reads; planning still does not move the work item's `status`.

## Round 70 — the folder, the half that started, and what the AI could not do

### My Feedback

**"Execute failed: 'Shop API' has no folder on this machine."** True, said in a
panel that could do nothing about it — so the next move was to go and find the
screen that could. The Git tab reported the state and offered `git init`, link
and create, but not the one thing that was actually missing. `FolderField` is
there now, beside the sentence that names the problem, and it is offered when
there *is* a folder too: pointing a Solution somewhere else is how a repository
moved on disk gets reconnected.

**And the press was reporting a partial failure as a total one.** Execute
loops over every attached Solution, and the loop stopped at the first refusal —
so a Solution that started fine was never mentioned, the ones after it were
never tried, and one broken repository out of three read as "Execute failed".
Every Solution is attempted now and both halves are said: what started, and
which one refused with what.

**"What the AI could not do" was filed under "Questions".** They are not the
same thing: a question wants an answer, a refusal wants a decision, and a failed
attempt wants neither — it wants reading. The sub-panel showed only the middle
one and called all of it questions, while a failed attempt lived on another tab
entirely.

### Implemented

- **`FolderField` on the git panel**, with `setSolutionPath`.
- **Execute attempts every Solution**, collecting `started` and `refused`, and
  reports both — the notice for what is running, the failure box for what is
  not.
- **`AiFeedbackPanel`** replaces `AiQuestions` and is three lists:
  - *Attempts that failed* — this item's failed and blocked jobs, read-only,
    in the words they failed with;
  - *What the AI could not do* — `cantImplement`, a list nobody can edit,
    because it is a record of what happened and a box invites correcting the
    account rather than answering it. Beside each, the developer's half: **how
    to solve it**, stored as the resolution so it travels into the next attempt;
  - *Questions the AI asked* — the rest, with the answer flow as it was.
  The workbench tab is "AI feedback" now, and the panel re-reads on
  `work-changed`, so an attempt that fails while it is open appears.

### Tests

cargo 704/704 (23 ignored), Vitest 669/669, `tsc --noEmit`, clippy
`-D warnings` and `npm run build` clean. New: the folder chooser recording a
path, Execute starting one Solution while naming the other's refusal, and six
on the feedback panel — including that the only field in a "could not do" row
is the developer's, never the AI's account.

### Your Feedback

- **The Product board keeps the questions half.** It has no queue to read and no
  business with a developer's failed runs, so it renders the same component
  without a `productId` and shows two lists instead of three.
- **"How to solve it" is stored as the resolution**, which is the same field an
  answer to a question uses. That is deliberate — both travel into the next
  prompt — but it means the two read the same way in the ledger.

### Technical Debt

- Only the Build view has the failure box. Product and Test have presses that
  can fail the same way and no rail to put one on.
- Carried: no Admin UI for the routing defaults; the boundary test compares
  argument names but not DTO shapes; `work_item_policy` keeps permission columns
  nothing reads; planning still does not move the work item's `status`.

## Round 71 — the two AI failures that were not reaching the box

### My Feedback

**You asked whether it is displaying the AI error. It was displaying two of the
four.** I traced every path a failure can take rather than answering from
memory, and the box built in round 69 was catching only the ones that arrive as
an exception from something you pressed:

| what happens | before | now |
| --- | --- | --- |
| Execute throws (no folder, not a repository, budget, permission) | box ✓ | ✓ |
| Review / Keep / Discard throw | box ✓ | ✓ |
| **The AI declines** (`blocked`) | notice inside the panel only | box ✓ |
| **A queued Plan job fails** | the panel's status line and the AI feedback tab | box ✓ |

**The decline was the worst of the four to be missing.** It is the one failure
that is entirely the AI's — it comes back as a *result* rather than an
exception, so the catch never saw it and it reached the notice and nothing else.

**A queued job's failure is nobody's press.** Planning returns at once and runs
in the queue, so no `catch` in this session ever sees it; the panel showed it in
two places, and neither is the one that is always visible. It is reported when
the job comes back, once — a ref holds the last job id shouted about, so a
reload does not report the same failure again.

### Implemented

- `reportFailure("The AI declined", reason — whatIsNeeded)` on a blocked result.
- An effect over this item's jobs that reports the newest finished `failed` or
  `blocked` one, exactly once.
- A `Probe` in the tests that reads the shared channel through its real hook, so
  what reaches the rail is asserted without rendering the Build view around the
  panel.

### Tests

cargo 704/704 (23 ignored), Vitest 671/671, `tsc --noEmit`, clippy
`-D warnings` and `npm run build` clean. Two new, both red first: the refusal
reaching the channel with what it needs, and a queued job's failure reaching it
when the queue announces.

### Your Feedback

- **What still will not appear there**: a failure in Product or Test. Those
  screens have no rail, and the channel is not read outside Build — so the
  answer to "is it displaying the AI error" is yes *in Build*, and unchanged
  elsewhere.
- **The box shows the last one only.** Two failures in a row means the first is
  replaced; the AI feedback tab keeps the history per work item.

### Technical Debt

- No failure surface outside Build (above).
- Carried: no Admin UI for the routing defaults; the boundary test compares
  argument names but not DTO shapes; `work_item_policy` keeps permission columns
  nothing reads; planning still does not move the work item's `status`.

## Round 72 — the life of a work item, and QA gets work

### My Feedback

**The gates are the framework; the steps are yours.** Product → Develop → QA is
the shape this whole app is built on, so the three handovers are a constant. What
a team does before letting go of an item is not: "spike the API" and "signed off
by legal" are both right answers, and an app that shipped a default checklist
would be telling people how to work. Every list starts empty and says so.

**A tick is a record that somebody did something**, so editing the list must not
quietly undo one. `set_steps` matches by name: reordering or inserting keeps the
ticks, and only a step that is genuinely removed takes its ticks with it —
correct, because there is nothing left for them to be about.

**QA had no work items at all.** The area held a testing strategy and a list of
test cases — what to test and how — but not *what is waiting*. So "what has
Develop handed me?", the first question anybody standing there asks, was
answered on another team's screen.

**What QA may change is deliberately narrow**, and this is your own boundary
rule applied: the status, because moving work along is QA's to do; the release
checklist, because those steps are theirs; and a question to Product, which is
how this app has always crossed a line. **Not the description** — a requirement
reworded by the person testing it stops being a requirement, the same reason
Product's half is read-only in the build plan.

**Scoped reads, again.** `tick` held a `Rows` open across its own INSERT and the
write went nowhere — no error, no row. Two tests caught it; the fix is the block
this project already uses everywhere else, and the comment says why so the next
person does not undo it.

### Implemented

- **`db/lifecycle.rs`**: three fixed gates, user-written steps per Product, and
  a tick per (work item, step). No row is "not done", so a step added later
  starts unticked on every existing item with nothing to backfill.
- **Five commands** and their wrappers; the boundary test passes them.
- **`LifecycleSteps`** in Develop → Rules — the same kind of thing as the
  Developer Rules, written where the rest of the standing direction is. Add,
  remove, reorder with buttons rather than drag, because a checklist is read in
  order and two buttons work with a keyboard.
- **`WorkItemLifecycle`**, mounted three ways: **Product** sees all three gates
  on its board, **Develop** sees `toTest` on the build plan, **QA** sees
  `toRelease`. A gate is clear when every step in it is ticked — a count of
  rows, not a state anybody sets, because a status somebody can set
  independently of the checklist is a second answer that disagrees by Friday.
- **`TestWorkItems`** in QA: every work item, its status, its release checklist,
  a question to Product, and what the AI has said about it.

### Tests

cargo 710/710 (23 ignored), Vitest 683/683, `tsc --noEmit`, clippy
`-D warnings` and `npm run build` clean. Eighteen new: six on the data rules
(order, unknown gate refused, ticks surviving an edit, a removed step taking
them, idempotence both ways), eight on the two panels (each area seeing its own
gate and only its own), and four on QA's list.

### Your Feedback

- **Product's edit ability was already there** — the planning board creates
  items, edits descriptions, statuses, assignees, sprints and sub-items. What it
  gained is the whole life on each card.
- **No "mark as ready" button anywhere.** Readiness is the count of ticks. If
  you want a gate that can be forced past, that is a different decision and
  worth making deliberately.
- **The gates are per Product**, so two Products can have different checklists;
  they are not per item type. An epic and a bug walk the same three gates.

### Technical Debt

- Nothing stops work moving through a gate that is not clear — the checklist
  reports, it does not enforce. Enforcing it would want the same care the plan
  approval gate got.
- Carried: no Admin UI for the routing defaults; the boundary test compares
  argument names but not DTO shapes; `work_item_policy` keeps permission columns
  nothing reads; planning still does not move the work item's `status`.

## Round 73 — nine rows saying one thing, and each checklist where it belongs

### My Feedback

**Those nine failures are history, and the panel was presenting them as news.**
The wording you pasted — "Set its work-item AI policy" — does not exist in this
codebase any more; permission moved to the Product with a per-Solution override
in round 62, and `ai_permission::refusal` says "Set this Product's AI policy in
Admin → AI". So those rows were written before that change and have been sitting
in the queue table ever since. The panel I built in round 70 listed every failed
attempt **undated**, which made an old refusal indistinguishable from a current
one — and nine identical ones read as nine things going wrong rather than one
thing that went wrong then.

Two fixes, both in the panel rather than the data: failures are **grouped by
what they said**, with a count and the most recent time. `lib/when.ts` holds the
formatter, moved out of `RuleEnforcement` at its second use, because both panels
list attempts that stopped and an undated list is exactly what caused this.

**Admin does not show failures, and did not need to.** It holds the policy the
message points at — Admin → AI, per Product — which is the thing to *change*.
Where failures are read is the work item, the queue, and the AI log; the ship
rail carries the last one.

**Each checklist now lives with the team that writes it.** Product's handover is
in Product → Strategy, Develop's in Develop → Rules, QA's beside the Testing
Strategy. One screen holding all three made two of them somebody else's
business, which is the same thing the areas exist to prevent — and the panel on
a work item already worked this way.

### Implemented

- **`lib/when.ts`**: `whenStopped` (moved, now shared) and `groupFailures`.
- **The failed-attempts list is grouped, counted and dated.**
- **`LifecycleSteps` takes an `owner`** and shows only that gate; mounted three
  times, once per area. The empty state points each area at its own screen —
  one that said "Develop → Rules" to everybody would send two teams to a screen
  that no longer holds their list.

### Tests

cargo 710/710 (23 ignored), Vitest 686/686, `tsc --noEmit`, clippy
`-D warnings` and `npm run build` clean. New: a repeated failure said once with
its count, a dated failure, the editor showing only its own gate, and each area
pointed at its own screen.

### Your Feedback

- **Nothing deletes the old rows.** They are the record of what happened, and I
  am not going to quietly erase history to tidy a screen — but they are dated
  now, so they read as what they are. If you want them gone, that is a "clear
  the queue for this item" button and worth asking for deliberately.
- **The refusal you are seeing on new attempts, if any**, will read "Set this
  Product's AI policy in Admin → AI". If you still see the old wording after a
  rebuild, that is a stored row, not a live refusal — check the date beside it.

### Technical Debt

- Carried: the checklist reports but does not enforce; no Admin UI for the
  routing defaults; the boundary test compares argument names but not DTO
  shapes; `work_item_policy` keeps permission columns nothing reads.

## Round 74 — clearing the queue for one item

### My Feedback

**Deleting history, only when asked, and only the settled part.** The queue is
the record of every attempt, which is why nothing prunes it on its own — an app
that quietly tidied failures away would be deciding for somebody which ones
mattered. A press is somebody deciding, and now there is one.

**What it will not delete is anything still in flight.** A `queued` or `running`
row belongs to the runner that is about to write to it; taking it orphans the
task, and "it vanished mid-flight" is a worse screen than a stale line. The test
pins both halves, and that the neighbouring item's queue is not this item's
business.

**And the spend stays.** What each call cost is in `ai_usage`; this touches
`ai_jobs` only. The notice says so, because "cleared" must not read as "the
bill is gone too" on a screen about AI that has spent money.

### Implemented

- **`ai_job::clear_finished`** and the `clear_ai_jobs` command.
- **"Clear the failed attempts"** beside the heading in the AI feedback panel,
  reporting how many went and what stayed.

### Tests

cargo 711/711 (23 ignored), Vitest 687/687, `tsc --noEmit`, clippy
`-D warnings` and `npm run build` clean. Two new: the data rule (settled gone,
running kept, other items untouched) and the panel's press.

### Your Feedback

- **It clears the item you are looking at**, not the Product. Clearing every
  item at once would be a different button in a different place, and worth
  asking for separately if the old rows are spread about.
- The grouped list from round 73 means you can see what you are about to lose
  before you press it — nine rows now read as one line with a count and a date.

### Technical Debt

- Carried: the lifecycle checklist reports but does not enforce; no Admin UI for
  the routing defaults; the boundary test compares argument names but not DTO
  shapes; `work_item_policy` keeps permission columns nothing reads.

## Round 75 — the activity log, and buttons that refuse out loud

### My Feedback

**No, you do not need an AI budget.** `router::route` takes `Option<&BudgetState>`
and the `None` arm uses the policy's provider with the reason "no AI budget is
set for this Product" — a budget is what opts a Product *into* cost control, not
a requirement to run. What is required is three things: a Product AI policy that
allows reading, a provider named on it, and a model installed on that provider
(plus paid API allowed in Admin if the provider is metered).

**The dates confirm it.** 29 Aug × 8 and 29 Jul are old rows — the wording in
them was removed from this codebase in round 62. They are history, and now they
say so.

**"Nothing happens" was, at least in part, a disabled button.** A disabled
button eats the click: no handler runs, nothing is logged, nothing is said. The
panel greyed Plan and Execute out whenever something was missing or a job looked
in flight, so the most common way to hit this feature was also the way that
produced silence. **They press now.** Only `busy` disables them — a press that
is already running is the one case where a second press has nothing to add.
Everything else lands and refuses out loud: the reason goes to the panel, to the
ship rail, and to the log.

**And an app log, because a press that stops early leaves no trace anywhere
else.** The ledger records calls that reached a provider; the queue records jobs
that were submitted. A refusal before either wrote nothing. Both halves write to
it now — the screen logs what was pressed and what came back, the commands log
what they decided — and read together they say *where* a press stopped, which
neither half can say alone.

### Implemented

- **`db/app_log.rs`**: an append-and-trim log, capped at 500. Trimmed on write,
  because a sweep nobody triggers never runs. `note` swallows its own errors: a
  log that can break what it is logging is worse than no log.
- **`log_event`, `list_app_log`, `clear_app_log`**, and `logEvent` on the
  screen side.
- **Logged**: the Execute and Plan presses, every refusal before they start,
  what they threw, both ends of `start_run`, and every route out of
  `run_change_plan` — which needed splitting into an inner function so the
  logging wraps the early refusals too, since those are the interesting ones.
- **Admin → Activity log**: newest first, full timestamps, with the detail under
  each line. Refresh and Clear.

### Tests

cargo 714/714 (23 ignored), Vitest 687/687, `tsc --noEmit`, clippy
`-D warnings` and `npm run build` clean. Three new on the log store (order, the
cap enforced where the table grows, clearing), and three rewritten: the buttons
now press and refuse rather than being disabled, and the refusal reaches the
rail.

### Your Feedback

- **Press Execute once more after rebuilding, then read Admin → Activity log.**
  It will say either "refused before starting" with the reason, or how far into
  `startRun` / `changePlan` it got. That is the answer we have been guessing at.
- **The log holds no prompts and no answers** — only what was pressed and what
  was decided. What the AI was sent is in the AI log, which is a different panel
  for a different question.

### Technical Debt

- Nothing else logs yet: the Product and QA screens' presses go unrecorded, so
  the log is honest about Develop and silent elsewhere.
- Carried: the lifecycle checklist reports but does not enforce; no Admin UI for
  the routing defaults; the boundary test compares argument names but not DTO
  shapes; `work_item_policy` keeps permission columns nothing reads.

## Round 76 — the app you are running was built on 13 August

### My Feedback

**I should have checked this five rounds ago.** The binaries on this machine:

```
src-tauri/target/debug/coperativeai.exe            31 Aug 19:32   (my cargo build, today)
src-tauri/target/release/coperativeai.exe          13 Aug 13:23
target/release/bundle/nsis/CoperativeAI_0.1.0…exe  13 Aug 13:23   (the installer)
```

If the app being launched is the installed one, it is **eighteen days old** and
contains none of rounds 60–75: not the permission rewire, not the failure box,
not the always-pressable buttons, not the activity log. Every symptom fits
exactly — new attempts writing the *old* "work-item AI policy" wording, which
was deleted from this codebase in round 62; Execute doing nothing with no error
anywhere; buttons greyed with no reason. That is not a bug in the code we have
been discussing; it is the code we have been discussing not being there.

**So the app now says which copy of itself is running.** `build.rs` stamps the
compile time into the binary, startup writes it as the first line of the
activity log, and Admin → Activity log shows it above the entries. "It does
nothing" and "that fix is not in this build" have looked identical from here for
five rounds, and they will not again.

### Two questions answered

- **Does Execute work from Develop → Work → Board → Build plan?** It is the same
  component everywhere it appears — the Board and Sprint views, the List view's
  inline row, the Ready view, the Build workbench's Plan tab, and a pulled-out
  window. One implementation, one set of buttons; where it is opened from
  changes nothing.
- **Do you need to approve the plan after pressing Plan?** No —
  `onExecute` calls `setPlanApproval(item, solution, true)` for every attached
  Solution immediately before `startRun`, because generating clears approval and
  a chain that ran straight through would otherwise be refused. Pressing Execute
  *is* the approval. Pressing **Start** on the rail instead does need one, and
  says so.

### Implemented

- **`build.rs` stamps `BUILD_AT`**; `app_build` returns it with the version.
- **Startup logs it** as the first line of every session.
- **Admin → Activity log shows it** above the entries.

### Tests

cargo 714/714 (23 ignored), Vitest 687/687, `tsc --noEmit`, clippy
`-D warnings` and `npm run build` clean. No new tests: the stamp is a compile-
time constant and a `toLocaleString`, and a test asserting either would be
asserting the standard library.

### Your Feedback

- **`npm run tauri dev` runs the fresh debug build; the Start-menu app does
  not.** If you are launching the installed one, it needs
  `npm run tauri build` and reinstalling — otherwise every round we discuss
  lands in a copy you are not running.
- After that, Admin → Activity log will show today's date at the top and the
  Execute trail underneath.

### Technical Debt

- Carried: the lifecycle checklist reports but does not enforce; no logging
  outside Develop; no Admin UI for the routing defaults; the boundary test
  compares argument names but not DTO shapes.
