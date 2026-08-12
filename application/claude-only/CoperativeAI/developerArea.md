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
