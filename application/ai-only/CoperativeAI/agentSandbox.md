# Page Spec — Agent Sandbox

> Produced by `/translate` from [`../../CoperativeAI/agentSandbox.md`](../../CoperativeAI/agentSandbox.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Choose where agents run — off (this machine), WSL, or Docker — as one app-wide setting, and tell the truth about what the chosen one actually enforces on this machine. The setting exists so "never ask" is defensible; the honesty exists because a sandbox believed in but not in force is worse than none.

**Model & effort**
Most capable tier (Claude Fable 5), high effort — security-sensitive, and the spawn seam it introduces is used by every process the app starts.

**Depends on**
- `CoperativeAI/adminArea.md`
- `CoperativeAI/terminal.md`
- `CoperativeAI/developerArea.md`
- `CoperativeAI/aiSettings.md`

**Actions**

| User | Can do |
|------|--------|
| Anyone (no login) | Choose where agents run: Off / WSL / Docker, one setting for the whole app. |
| Anyone (no login) | See, before choosing, what each option would actually enforce on this machine. |
| Anyone (no login) | Create the sandbox the app owns — the dedicated WSL distribution, or the agent's base image — as a deliberate press, with its output handed back whole. |
| Anyone (no login) | Sign in to Claude Code inside the sandbox, once, from a terminal the app opens. |
| Anyone (no login) | Point WSL mode at a distribution they already have, and be told plainly what it does and does not enforce. |
| Anyone (no login) | Start a run whose agent terminal, test commands and dev commands all run inside the chosen sandbox, used exactly as they are today. |
| Anyone (no login) | See on a run which protections were in force for it, during and after. |

**Information shown / collected**
- The chosen setting.
- What detection found: whether WSL is present and which distributions; whether a Docker **server** is running; whether the Windows drive is still mounted inside WSL.
- Per run: the sandbox in force and the protections it really had.
- A table of five protections (filesystem boundary, one run cannot reach another, reduced privileges, resource limits, network control) × three options, each cell from detection, greyed where unavailable or unproven.

**Data to store**

| Item | What it looks like |
|------|--------------------|
| `agentSandbox` | System setting, one of `off` / `wsl` / `docker`, default `off`. Sits beside `agentRunMode`. |
| Run's sandbox | New column on `change_runs` (ALTER TABLE with a `''` default, as `worktreePath` and `pullRequestUrl` were added) — the mode in force when the run started, so its record stays true after the setting moves on. |
| Detection | **Not stored.** Re-read each time: the configuration it reports can change outside this app between one run and the next. |
| The distribution and the image | **Not stored.** Both have fixed names of the app's own, so neither is a setting. A Solution's own container definition stays in its repository. |

**Access & security**
This page is a containment surface, not an access-control one — the project has no authentication and roles are visibility only, so this must never be described as gating who may do anything. Two rules from the solution spec apply directly. First, where the embedded terminal and every app-run command actually run follows this setting; off, they are a real shell with the OS user's permissions, and nothing about how they are used changes under WSL or Docker. Second, no protection is claimed that detection has not proved — the same rule as never showing a cost the app cannot see. The mount boundary is the **repository**, not the run's checkout, because a worktree's `.git` points back at the main repository; that is stated in the app's own words where the choice is made, and it is one explicit named mount in *both* modes — the Windows drive is unmounted in the distribution the app creates, so the repository reaches WSL exactly as it reaches a container. The app owns that distribution (a name of its own, drive unmounted, non-root user) rather than borrowing one, because a mode whose protection rests on a configuration the app did not set can only report someone else's accident; borrowing stays available and is reported for what it usually is. The app likewise owns only the *agent's* image — git, node, Claude Code — and never a Solution's build toolchain: that comes from the Solution's own container definition, or is reported missing for that Solution. Claude Code is signed in inside the sandbox and its credentials are mounted read-only; that is a real hole and is named rather than hidden. Choosing a sandbox must not change how the agent asks — the two settings sit together and are pressed separately.

**Tests**
- [ ] Setting **Off**: same command, same shell, same working folder as today — byte-identical behaviour.
- [ ] Docker detection reads the **server** version, so a client with no daemon reports unavailable.
- [ ] WSL detection runs WSL rather than finding it on PATH.
- [ ] **WSL with the Windows drive still mounted reports "no filesystem boundary"** — the default state, and the one that looks like protection.
- [ ] A run under Docker cannot write outside what was mounted for it.
- [ ] A test command runs under Docker with the network switched off.
- [ ] A path in, and a `file:line` out, both translate — a finding from a sandboxed test run still opens in the editor.
- [ ] No protection is shown as on that detection did not prove.
- [ ] Every process the app starts goes through the one sandbox seam, asserted as a set so a fourth caller cannot bypass it.
- [ ] The distribution the app creates has the drive unmounted and a non-root user, and the repository reaches it as one named mount.
- [ ] A Solution with no container definition is reported as having no toolchain under Docker, not run in the agent's base image.

**Open questions**
- **Clone-per-run vs the repository mount.** The brief settles on mounting the repository and records the tighter option as a separate decision. It stays open, and it changes what a run's stored folder means (`worktreePath`, the git panel, `filesChanged`, the PR flow all read it).
- **Does the setting cover the ad-hoc Develop → Code terminal, or only run terminals?** The solution's security rule says every command the app runs on someone's behalf; the brief's actions name only the run's terminal, tests and dev commands.
- **What happens to a run already going when the setting changes?** The brief says a run records the mode it started under; it does not say whether a live run is re-homed, left alone, or refused.
- **What should a failure that only happens inside the sandbox look like?** The brief names the gap — the sandboxed environment is narrower, so some work passes outside and fails inside — without saying how that is reported.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| Capability detection that proves rather than assumes | The whole page is worthless if it reports a protection it has not established. | Run the binary and read what it answers — Docker's *server* version, `wsl -d <distro> -- true`, and the distro's own mount state — never PATH presence. | Yes. |
| One spawn seam for every process the app starts | Four call sites spawn processes today; a fifth added later must not bypass the boundary. | A single `tooling/sandbox.rs` that wraps `(program, args, cwd)`, adopted by the PTY, the test runner, the starter and the dev runner, with a test asserting the set of callers. | Yes. |
| Path translation across the boundary | Test output carries `file:line`; a Linux path that does not translate back is a finding that will not open. | Translate on the way in and on the way out at the seam, so the parsers keep working unchanged. | Yes. |
| Provisioning the app's own sandbox | WSL mode is only containment in a distribution the app configured, and Docker mode needs the agent's image to exist. | Create the named distribution (drive unmounted, non-root user) and build the agent image, each on a press, each printing what it did — the same treatment the global npm install already gets. | Yes. |
| A PTY across a sandbox boundary | The agent is a TUI; it must keep its terminal when it moves inside WSL or a container. | Keep `portable-pty` as the outer process and let the wrapped program be the sandbox entry, forwarding resize and interrupt. | Extends `terminal.md`'s ConPTY work. |

---

## PLAN

**Summary:** One setting, one seam, and an honest capability table. `tooling/sandbox.rs` turns a spawn request into the wrapped spawn for the chosen mode and reports what that mode really enforces here; the four existing spawn sites adopt it; Admin gains the picker beside "how the agent asks", with the protections table filled in from detection rather than from the option's name.

**Changes:**
- `db/system_setting.rs`: `AGENT_SANDBOX_KEY`, `SANDBOXES`, getter/setter beside `agent_run_mode`.
- `db/change_run.rs`: ALTER TABLE add `sandbox TEXT NOT NULL DEFAULT ''`, set at prepare.
- `tooling/sandbox.rs` (new): `Mode`, `detect() -> Report` (per protection: proved / unavailable / unproven), `wrap(program, args, cwd)`, `to_sandbox_path` / `from_sandbox_path`.
- Adopt the seam: `terminal::Session::start`, `test_runner::spawn`, `tooling/starter.rs`, `tooling/dev_runner.rs`.
- `commands/ai_settings.rs`: `sandbox_options`, `get_agent_sandbox`, `set_agent_sandbox`, `sandbox_report`, plus `provision_sandbox` — create the named distribution or build the agent image, on a press, returning what it printed (the shape `claude_code::install` already uses).
- A shipped Dockerfile for the agent image (git, node, Claude Code) and the distribution's `wsl.conf`; per-Solution toolchain resolved from the Solution's own container definition, reported missing when it has none.
- Frontend: the Admin card and its protections table; the run badge on the runs panel, in words rather than a padlock.
- Tests: the nine above — cargo for detection, wrapping, path round-trip and the seam set; Vitest for the table never showing an unproved protection as on.

**Round 5a — the repository goes in read-only under WSL too**

Recorded debt, paid while the Docker engine would not start. Nothing inside ever writes to the repository — a run works in a clone and its work comes back by the repository fetching from it, settled in round 4b — so the writable mount was a permission granted for no reason. The container backend took read-only from the start; this is WSL catching up.

**Two faults, both found by running it, neither visible in any fixture.**
1. **Mounts stack.** A new mount at a point hides the old rather than replacing it. The first version asked whether *a* read-only mount was listed, which answers yes while a writable one sits on top hiding it — so it passed its own check and changed nothing. The check now reads the mount **in force**, which is the last line.
2. ** does not reliably unwind a stack on this filesystem.** So it is attempted and not relied on: a mount that will not come away must not stop the read-only one going on top. A pile underneath is untidy rather than dangerous — the top one is what any process gets.

**Proved live, and by the claim rather than the flag:** a writable mount was put there first the way the old version left them, the mount in force afterwards was read-only, and  inside the repository came back *Read-only file system*.

- Untidy: a mount stack can grow where an old writable mount will not unwind. Harmless, and worth cleaning up when the distribution is next restarted.

**Technical debt after round 5:**
- ~~The whole backend is unproven against a real engine.~~ **Closed** — run, three faults found and fixed.
- ~~The agent image has never been built.~~ **Closed** — built through the app's own path, 524 MB.
- The `safe.directory` grants are written into the container's global config, which is right while a container is per-run and disposable. If containers are ever reused across runs, that assumption needs revisiting.
- The two backends now keep their working copies in opposite places — inside the distribution for WSL, on this machine for Docker — and `runs.rs` has a three-way branch where it had two. Both are right for their own constraints; there are two stories to hold rather than one.
- Tests run in the agent's own container, so they have the network. A throwaway container with none is the next increment.
- Nothing removes a run's container or its folder when the run ends.
- WSL's repository mount is still read-write, though nothing needs it to be.

**Technical debt after round 4b:**
- **Four seconds a `git status`** over the network path. The panel refreshes on a timer in places, and a sandboxed run will feel sluggish where an unsandboxed one does not. The alternative — running git *inside* the distribution — is fast but makes `vcs.rs` sandbox-aware, and that decision is better made once Docker exists and there are two backends to serve.
- The `safe.directory` grant is built at two call sites via one helper; a third runner added later would have to remember it.
- The clone's `origin` still points at a Linux mount that means nothing out here. Nothing depends on it now that the fetch runs the other way, but anybody reading it there will be briefly confused.
- The pull-request path was proved by unit tests and by the fetch round trip, **not** end to end against GitHub.

**Technical debt after round 4a:**
- Mounts are never torn down, so a long-lived distribution accumulates one per repository ever used.
- A run's clone is never removed. Disk grows with every run, and nothing prunes it.
- A run interrupted mid-clone leaves a folder the app does not clean up; the next attempt finds a partial clone and the `test -d .git` guard will skip re-cloning it.
- Two runs still share a distribution and a user, so one can read another's folder. Said in the table, said in the module, and not fixable in WSL.
- Filtering `wsl: Failed to translate` is a string match against another tool's wording.

**Technical debt after round 3:**
- Provisioning cannot be cancelled. A slow `apt-get` leaves somebody watching a disabled button for minutes with no way out but closing the app.
- Nothing streams. Each step's output arrives when the step ends, so the longest two look like nothing is happening while they are the ones worth watching.
- The Dockerfile is a string in the binary. The starters follow a "shown before it runs" rule; this does not yet, and should once it grows.
- `wsl --install` downloads from Microsoft's catalogue — a dependency the app can only report on when it is unreachable.
- Three machine-changing presses now exist (npm install, WSL set-up, image build) and still share no path. This round made that debt bigger.
- The Docker half remains unproven live — no engine was running on the machine this was built on.
- `npm` inside the new distribution is 9.2.0 against node 22, which is the pairing Ubuntu ships. It works; it is not the pairing either project would pick.

**Technical debt after round 2:**
- The pure readers are pinned to two tools' output formats. Fixtures make a change visible rather than silent, but nothing warns when WSL or Docker changes its wording.
- Telling "Docker is not installed" from "installed, engine stopped" rests on reading its error text, which is not a stable contract. Today it works against this machine's actual message.
- The five protections are now named in three places — brief, `PROTECTIONS`, and the panel's copy. The Rust constant is the source and the panel renders from it, so only the brief can drift.
- Detection is not cached at all, by design; the cost is that pressing "check again" on a cold WSL takes seconds with only a disabled button to show for it.
- WSL findings for a *borrowed* distribution are deliberately not gathered — only the app's own is inspected. So somebody pointing WSL at their own Ubuntu gets "not configured by this app" rather than a report on it, which is honest but less useful than it could be.

**Technical debt after round 1:**
- Three call sites now take a `mode` they hand straight to a seam that, for the only reachable value, changes nothing. That is the cost of the boundary existing before the backends do, and it is the right order — retrofitting one under working code is the expensive way.
- The seam test encodes today's exclusions, so adding a spawn site fails a test in an unrelated file. The message explains what decision is being asked for, but it will still surprise whoever hits it.
- The two Solution-zero terminals pass `Off` by hand. Once WSL exists, the sign-in one has to move — it is the brief's own "sign in inside the sandbox" action, and nothing yet enforces that it does.
- `Mode` is threaded as a parameter through three public signatures. If a fourth adopter arrives it is a fourth signature; at that point a small context struct probably beats another argument.
- Not built this round, by plan: detection, the capability table, the picker, provisioning, path translation, and both backends. No UI exists, so no protection is claimed anywhere — the honesty rule is satisfied vacuously rather than actively.

**Expected technical debt (as planned, before building):**
- Detection runs binaries, so the Admin card must not re-detect on every render — cached for the view's lifetime only, never across runs, which is a deliberate cost.
- Path translation lands at the seam and is proved by a round-trip test; each runner parser that emits a path still has to be checked individually, and one missed parser is a silently unclickable finding.
- Network egress control is not built this round — recorded in the brief's limits, not omitted.
- Provisioning changes someone's machine, and the app now does two such things (the global npm install, and this). They should read the same way to whoever presses them; they do not yet share a path.
- WSL too old to be given a distribution of its own reduces WSL mode to the borrowed-distribution form. That is reported rather than worked around, and it means the mode's protections differ by machine.
- Four open questions remain above; none now changes the shape of the build, only its edges.

**Status:** round 5 built (2026-09-10) — the Docker backend, **not yet run against a real engine**

---

## Report back — round 5

**Tests:** `cargo test` 824 passed, 0 failed, 28 ignored. `npm test` 772 passed across 73 files.

**A container per run, and that is the point.** Two runs in a WSL distribution share a filesystem and a user, so either can read the other's work; two containers share nothing. "One run cannot reach another" has said *no* in every column for five rounds, and this is the round that changes it — but only where detection proves both an engine **and** the agent image, because an engine with nothing to run in is a machine that could, not a boundary that is.

**The working copy lives on this machine, which is the opposite of the WSL backend.** For a reason rather than by accident: a *clone* has a real `.git` **directory**, self-contained, with no absolute path anywhere in it — unlike a worktree, whose `.git` is a one-line file naming where its repository sits. So a copy made inside a container into a bound folder is an ordinary repository out here, read by ordinary local git at ordinary local speed, with none of the network-path trouble WSL needs and none of its four-second `git status`.

**The repository goes in read-only**, which round 4b's decision made free: work comes back by the repository fetching from the clone, so nothing ever needs to write to it. WSL's mount could be tightened the same way and has not been.

**Every control is asserted by name**, one test each — `--cap-drop=ALL`, `--security-opt=no-new-privileges`, `--pids-limit`, `--memory`, `--cpus`. A flag dropped in a later refactor is a protection silently gone, and nothing about a run would look different.

**The one Docker could do and this does not:** the network. The container an agent works in keeps it, because the agent needs its model. That row therefore stays **No**, with that sentence in it, rather than being quietly left off the list. Running *tests* in a throwaway container with `--network none` is the obvious next increment and is not this round.

**Repository-level work refuses under Docker rather than running here.** An ad-hoc terminal or a starter creating a project is not a run, and a container belongs to a run — so there is no container for it to happen in, and it says so instead of quietly falling back to this machine, which would be the one failure this whole feature exists to prevent.

**Test scenarios created:** every named control appears in the `docker run` line; the repository is bound read-only and not also writable; two runs get different containers and different folders, and neither line names the other's; a container already up is not started again, and the match is exact rather than a prefix, so run 1 is not run 12; the clone is made once and an existing branch is reused; a `docker exec` names the run's container and `/work`; a sandbox asked for with no container refuses rather than falling back; an engine without the image reaches no `Enforced` at all; with both, isolation is enforced and the network row still says no.

**Verified live** (added after the engine came up). The image was built through the app's own provisioning path, and the container check ran against a real container: not root, the repository refusing writes with *Read-only file system*, git working in the copy, and nothing of this machine visible beyond the two mounts.

**Three faults, exactly as predicted, none of which any fixture would have shown.**

1. **`-c safe.directory` never reaches the process that matters.** Cloning a *local* repository makes git start a second process to read the source, and `-c` applies only to the process it was given to. The child starts clean, refuses the folder for dubious ownership, and what surfaces is *"Could not read from remote repository"* — which names nothing that would lead anybody to the cause.
2. **`GIT_CONFIG_*` reaches that child and is ignored anyway.** Git honours `safe.directory` only from *protected* configuration, precisely so that a repository cannot grant itself the exception. What is left is the global config — and here that is the container's own: made for the run, thrown away with it, nowhere near the developer's machine.
3. **Both bound folders need it, not just the source.** `/work` is bound from this machine too. Granting only the repository got as far as a finished clone of 472 files and then refused to check a branch out in what it had just written.

And one fault in the **test** rather than the code — the same one the read-only mount had an hour earlier: it judged a refused write by exit status. The write was correctly refused and the shell reported `0`. It now reads what the kernel said.

**The build itself found something too.** One attempt died at `exporting to image` with `rpc error: Unavailable … EOF`, because Docker updated itself from 28.3.2 to 29.7.2 underneath it. Every Dockerfile instruction had succeeded. The step-by-step reporting made that an infrastructure failure at a glance rather than something to go hunting through the Dockerfile for — which is what that reporting was for.

---

## Report back — round 4b

**Tests:** `cargo test` 817 passed, 0 failed, 27 ignored. `npm test` 772 passed across 73 files. The round trip was proved against the real distribution.

**The probe that shaped the round.** Host git *does* work on a run's clone through `\\wsl.localhost\…`, given `safe.directory` for that command. So `vcs.rs` did not have to learn about sandboxes at all — it had to learn about **one path shape git distrusts**, which is a property of the path rather than of any setting. That is a much better boundary, and it is why this round is small.

**What changed:**
- `trusting()` grants `safe.directory` per command, in the `%(prefix)//` spelling git wants for a network path — never written into anybody's global config, where it would quietly cover every repository for ever.
- `for_git` learned the third spelling of a path: canonicalised, a network path is `\\?\UNC\…`, and stripping only the `\\?\` leaves `UNC\…`, which is not a path at all and surfaces much later as "not a git repository" about a folder that plainly is one.
- **The branch is fetched, not pushed.** A clone's `origin` is a Linux mount path that means nothing out here; the repository can name the clone perfectly well as a folder. So the repository pulls the branch in, and from that moment the merge, the diff and the pull request work on a branch they already know.
- The pull-request flow brings the branch back *first* and then operates on the Solution's own repository — which is where the GitHub remote and this machine's credentials are. A clone knows no GitHub.
- A run's own folder can open a terminal again: it is not a worktree of anything this side knows, so it is now checked against the run's recorded workspace as well.

**A real catch, found by running it.** `trusting` matched the plain spelling of the path, but by the time a path reaches it, it has usually been canonicalised — so the exception was never granted and git refused with an ownership error that looks unrelated to any of this. The fix runs the path through `for_git` first; the test pins the canonicalised spelling.

**Proved live:** `repo_state` read the clone from out here and reported its branch, `fetch_branch_from` brought `sandbox/probe` into the real repository, and the commit it landed as was checked by id. The probe branch was deleted afterwards.

**The cost, measured rather than guessed:** `git status` over that path takes about **4 seconds**, against roughly a tenth of a second on a local folder. Only sandboxed runs pay it, and every panel refresh does.

---

## Report back — round 4a

**Tests:** `cargo test` 812 passed, 0 failed, 26 ignored. `npm test` 772 passed across 73 files. Both live checks were run against the real distribution on this machine.

**Agents now run inside the boundary.** `wrap` builds `wsl.exe -d coperativeai --user agent --cd <inside> -- …` and stays pure; mounting and cloning spawn, so they happen on the command layer's side of the line where they can be awaited and their failure reported. The seam's fifth argument became the `Place` struct the first round's debt entry predicted.

**Clone per run, and the reason is not a preference.** A git worktree's `.git` is a file holding an *absolute* Windows path, which exists at no mount point inside a Linux distribution — so a checkout made out here simply cannot be used in there, and an agent without `git diff` is working blindfolded. Each run gets `/work/runs/<id>`, cloned from the repository's mount. It is also much faster: everything a build touches happens on the Linux filesystem rather than across a mount to NTFS.

**A run's folder is still reachable from Windows**, as `\\wsl.localhost\coperativeai\work\runs\<id>` — which is what lets the brief be written into it and the existing panels read it without knowing where it really is. The same spelling translates test output, once at the seam, so a `file:line` from a sandboxed run still opens in the editor. The whole path turns round, not just its root: half-translated, it opens in neither world.

**The first `Enforced` in the codebase** — but only where detection proved it. A distribution that still mounts the drive gets nothing and cannot be chosen. The three things WSL cannot do stay No: one distribution is shared, its limits cover the whole virtual machine, and its network is this machine's.

**The picker arrives, gated.** A mode is offered but disabled, with its reason beside it, unless it is built *and* ready here — and the backend checks the machine again before storing the choice, so a mode that quietly stopped being ready is refused rather than saved.

**Three things the live run found that no fixture would have.**
1. `mkdir: Permission denied` — `/work` did not exist and was not the agent's. Provisioning gained a step.
2. `fatal: detected dubious ownership` — a Windows folder over a mount looks to git like somebody else's repository, and it refuses to touch one. Granted with `-c safe.directory` for that single clone rather than written into the distribution's global config.
3. Forty lines of `wsl: Failed to translate` before every command, from `wsl.exe` translating this machine's PATH. `interop.appendWindowsPath = false` in the config stops the distribution caring, and the noise is filtered from captured output — the distribution ignores that PATH by design, and left in it would bury the one line that matters. `interop.enabled = false` went in beside it, which tightens the boundary as well as quieting it.

**Verified live:** a run got `/work/runs/9999`, git inside reported the branch `sandbox/probe`, and `/mnt/c` showed nothing. Re-provisioning took 14 seconds rather than 102 — the configure-not-recreate path, proved rather than asserted.

**Named as not done:** the git panel, `filesChanged`, commit and the PR flow still read a host-side worktree. That is round 4b.

---

## Report back — round 3

**Tests:** `cargo test` 801 passed, 0 failed, 25 ignored. `npm test` 772 passed across 73 files. Thirteen new: ten in Rust, three in Vitest, plus one ignored live check that really does change the machine.

**What it does.** `tooling/sandbox_provision.rs` creates the app's own WSL distribution from Ubuntu (`--no-launch`, so nothing interactive runs), writes `/etc/wsl.conf` to unmount this machine's drive and name a non-root user, adds that user, installs what the *agent* needs (git, Node, Claude Code), and **restarts the distribution** — without which `/etc/wsl.conf` is never read, the drive stays mounted, detection goes on saying so, and the whole feature looks broken. For Docker it writes the agent's Dockerfile and builds the image.

**Deciding is separate from running**, as in the detector: `plan_wsl` and `plan_docker` are pure, so *an existing distribution is configured and never recreated* is a test rather than a hope. Somebody may have work in a distribution, and reaching a tidy state by destroying it is not this app's call.

**It stops at the first failure** and names the step. Every step after a failed one would be working on a distribution that is not in the state it assumed, and four more failures caused by the first bury the one that matters. What each step printed is kept whole and shown — when a package is missing, that output is the only thing that names it.

**A real bug the tests caught.** The `wsl.conf` contents travel to `sh -c` inside single quotes, and the first draft contained one, in the phrase "the app's own" — which would have ended the quoting early and written half a config file. The failure mode is the worst available here: a distribution that silently stays unbounded while the app reports it as set up. `no_single_quotes_survive_into_a_shell_argument` now holds it.

**Node comes from the distribution's own packages**, not a shell script piped from the network and run as root. It may lag a release; fetching and executing a remote script *inside the boundary this exists to build* would be the worse trade.

**Test scenarios created:** a machine with no distribution of ours is given one; an existing one is configured, never recreated; a mounted drive is unmounted and the distribution restarted last; an old WSL is told the truth (naming both its version and 2.4.4) rather than worked around; a machine without WSL is offered no set-up; the config really does disable automount and drop root; nothing embedded in a shell argument carries a quote of its own; the image carries git, Node and Claude Code and none of cargo/dotnet/python/go; nothing is built without an engine; a stopped set-up names its step and keeps its words. In the panel: a set-up that cannot run says why rather than only greying out; what each step printed survives to the screen; and the table is read again when a set-up finishes, because whether the verdicts changed is the entire point.

**Verified live, on the machine it was written on.** `setting_up_for_real` was run at the person's word: all five steps succeeded first time, in 102 seconds. Created the distribution, wrote the config, added the user, installed the tools, restarted it.

The claim that matters was then checked **independently of the test's own assertions**, because a boundary reported by the same code that built it is not evidence:

- `/mnt/c` exists inside the distribution but is **empty**, `/proc/mounts` lists nothing under `/mnt`, and reading a real Windows file through it fails with "No such file or directory". The drive is genuinely unreachable — an empty directory that merely looks like a mount point would have passed a laxer check.
- The distribution runs as uid 1000, not root.
- git 2.53.0, node v22.22.1 and `claude` at `/usr/local/bin/claude` are all in place.

One thing to know: `claude --version` inside a cold distribution takes long enough to look hung. It is a 200 MB binary on first run, not a failure.

Detection re-read afterwards now reports `own_distribution: true`, `drive_mounted: Some(false)`, `root: Some(false)` — so the capability table on this machine has changed its answer for the first time.

---

## Report back — round 2

**Tests:** `cargo test` 791 passed, 0 failed, 24 ignored. `npm test` 769 passed across 73 files. Twenty new: fifteen in Rust, five in Vitest, plus one ignored live check.

**Detection lives in its own file.** `tooling/sandbox_detect.rs`, not in `sandbox.rs` — the seam test *skips* `sandbox.rs` (it names `Command::new` in prose rather than using it), so a spawn hidden there would have been invisible to the one test that keeps the caller set honest. It is filed in `OUTSIDE` as "asking this machine what it has".

**Run and read are separated throughout**, the way the test-runner parsers already are: every judgement lives in a pure function over captured output, so the tests pass on a machine with neither tool installed. Three captures come from this machine, including its real `/proc/mounts` line.

**Three states per cell, and the middle one is the round's whole point.** `Enforced` / `AvailableNotBuilt` / `Unavailable`. Neither sandbox runs anything yet, so nothing is `Enforced` — and a tick against a mode that refuses every command would be precisely the claim this page exists to prevent. `nothing_is_ever_claimed_as_in_force_for_a_mode_that_is_not_built` asserts it in Rust; the Vitest suite asserts the panel cannot render it either. The `Enforced` variant is `#[allow(dead_code)]` with the reason written down: nothing is in force, which is the state of the world rather than a gap in the code.

**No picker.** Choosing WSL or Docker today would stop the terminal and the test runner working, since both modes refuse. A test asserts the panel offers no radio and no select — the choice arrives with the first backend that can honour it.

**Test scenarios created:** a stock distribution's real mount line reads as no boundary; `drvfs`, `9p` and `virtiofs` are all recognised (matching only `drvfs` would report today's ordinary Ubuntu as bounded — the most dangerous wrong answer available); a distribution with nothing of this machine in it reads as bounded; `docker-desktop` and `docker-desktop-data` are never offered as somewhere to work; WSL's UTF-16 output is decoded (read as UTF-8 it is a working install that looks empty); this machine's actual Docker error reads as no engine; a running engine reports its version; root and non-root are told apart; no mode claims a protection it does not enforce; a ready machine is told apart from an unready one; a distribution that still mounts the drive gets no boundary row; Off says plainly that nothing is bounded; every cell carries a reason; and in the panel — no unbuilt column reads as protection, every verdict is in words, no way to choose an unbuilt mode, detection runs once per open and again only when asked, and a failure says why instead of showing an empty table.

**Verified live on this machine** (the ignored `what_this_machine_really_says`): WSL answered with `Ubuntu` only — Docker's own distribution correctly filtered out — the app's own distribution absent; Docker reported client installed, no engine. Both details read as intended. The panel itself was not opened: this is a Tauri window rather than a browser page, and outside the shell every `invoke` fails, so running it would have proved only the error state.

---

## Report back — round 1

**Tests:** `cargo test` 776 passed, 0 failed, 23 ignored. `npm test` 764 passed across 72 files. Six tests are new: four on the seam itself, two on the setting.

**How each use case was implemented.** `tooling/sandbox.rs` is the seam: `Mode` (off/wsl/docker, anything unrecognised reading as off), and `wrap` returning what should actually be run and where. `Off` hands back exactly what it was given — stated as the contract, not left as an implementation detail, because that is what makes adopting the seam a change that alters nothing until somebody chooses otherwise. The two unbuilt modes **refuse** rather than fall through; a mode that quietly ran the command unsandboxed would be this feature's own failure, invisibly.

The setting is `agentSandbox` beside `agentRunMode`, defaulting to `off`, validated against `SANDBOXES` on write so a name the app cannot honour is refused where it is written rather than where it runs. It is resolved per press by `commands::sandbox_mode`, because the three spawn sites are synchronous and hold no database handle while the command layer above them already does — which also means the setting takes effect without a restart.

Three adopters: `terminal::Session::spawn`, `test_runner::spawn`, `starter::run`. **The Code panel and a run's agent terminal are one function**, so covering the run also covers the panel by construction — the open question about the ad-hoc terminal answers itself, and exempting it would now take deliberate extra code. The two Solution-zero terminals (Claude sign-in, debug-adapter install) pass `Off` explicitly: they are about this machine's own setup, and there is nothing yet to sign in *inside*.

**Test scenarios created:** off returns program, args and cwd unchanged; an unbuilt mode refuses and names itself; unknown, empty and mis-cased stored values read as off while the three real names parse; every offered sandbox is one the code knows; a fresh install reports `off` by name; a chosen sandbox is kept and `chroot` is refused without disturbing the previous choice; and **the seam test** — the source tree is read, every file that starts a process must appear as either sandboxed or outside-with-a-reason, and each sandboxed file is checked to actually reach `wrap` rather than merely claiming to.

**Technical debt:** in the closing section below.

---

## Round 12 — an honest panel on Linux, and Docker finished

> Produced by `/translate` from [`../../CoperativeAI/agentSandbox.md`](../../CoperativeAI/agentSandbox.md) Part 4, Round 12. The sections above number their own build rounds 1–5; from here the number is the brief's, so the two stop diverging.

### Page Spec

**Objective.** Two halves, in order. **The ladder shown is the machine's own**, so a Linux install is never offered a Windows rung nor told a Windows rung is missing. **And Docker goes all the way round**, because on Linux it is the only rung there is: an agent inside a container can sign in, a run's branch comes back into the repository, and the files a run writes belong to the person who ran it.

**Model & effort.** Most capable tier, high effort — unchanged, and for the same reason: this is the page whose only product is a true statement.

#### Half 1 — the ladder is the machine's, not Windows'

- **`sandbox::available_here()`** (new, `cfg`-gated) is the list of rungs this platform has: Windows `off | wsl | docker`; Linux `off | docker`. `report()` builds a column per available rung, so on Linux the WSL column is **absent rather than failed**. A rung that cannot exist is not a rung that is broken, and greying it out says the wrong thing in the one place whose whole job is to say the right one.
- **`Mode::from_setting` stays pure and stays as it is.** The platform question belongs to the callers that act: `set_agent_sandbox` refuses a rung this machine's ladder does not have, and `sandbox_mode` treats a stored rung that is not available here as `Off` **and says so on the page** — a settings file carried from a Windows machine must produce "runs happen on this machine until you choose again", never a boundary nobody can see.
- **Detection is asked only where the question means something.** `sandbox_detect::wsl()` and `policy()` become Windows-only; nothing on Linux spawns `wsl.exe` or `reg.exe`. Today `reg.exe` is simply absent there, so every Linux machine reads back *unmanaged, WSL permitted* — an answer about a boundary that cannot exist, produced by a lookup that failed. That is the exact shape of claim this page exists to prevent.
- **The organisation row on Linux says what is not checked.** SELinux, AppArmor and the user-namespace sysctls are Linux's equivalents and this app reads none of them yet, so the row says that in those words. *Not checked* is a different statement from *not managed*, and a blank would be read as the second.

#### Half 2 — Docker, all the way round

1. **Somewhere for a sign-in to live.** A named volume of the app's own — `coperativeai-agent-home` — is mounted at the agent's home in **every** run container, and the sign-in terminal is a container with that volume and **nothing else**: no repository, no run folder. Claude Code is signed in once, and every later run finds its credentials.
   - **The hole is named where the choice is made**, as the mounted credentials already are for WSL: one home shared by every run means any run's agent can read the credentials every other run uses. Smaller than the host keyring, larger than nothing, and said out loud rather than arriving quietly with the mode that finally works.
2. **The branch comes back.** `bring_back` and `open_pull_request` ask `is_inside_view`, which matches the `\\wsl.localhost` spelling only — so a container run's clone looks like an ordinary host checkout, its branch never reaches the repository, and a pull request would be opened from a clone whose only remote is a folder. The question becomes **what the run recorded**: `restricted_by` already carries `"sandbox"`, written at the moment it was true, which is the property the path check was chosen for in the first place. A run whose recorded rung is not `off` has its branch fetched from wherever it worked; the path spelling stays as the WSL-side detail it is.
3. **The files belong to the person who ran them.** On Unix the container runs as `--user <uid>:<gid>` of the person running the app, with `HOME` on the agent volume and the run's git identity supplied, because a container writing into a bound host folder has to agree with that folder's owner. Docker Desktop's virtual filesystem hides the mismatch; native Linux does not, and the failure is either a run that cannot write or a folder the app cannot clear up.
4. **The limits row is read back, not assumed.** `docker info` states whether this engine can apply them — `MemoryLimit`, `CpuCfsQuota`, `CpuCfsPeriod`, `PidsLimit`, `CgroupVersion` — and a rootless engine on undelegated cgroups answers *no* while accepting every flag in silence. The row goes `Enforced` only where the engine says it can, and names what is missing where it cannot. The same fault as the mounted drive, one rung up: a flag passed is not a limit applied.
5. **The column stops contradicting itself.** Its summary still says running work inside it is not built yet, while `built: true` sits beside it and containers run work.

**Actions** — changed rows only.

| User | Can do |
|------|--------|
| Anyone (no login) | Sign in to Claude Code **for Docker**, from a terminal the app opens into a container holding the agent's home volume and nothing else. |
| Anyone (no login) | Finish a container run from outside it: the branch comes back into the repository, and the diff, the commit and the pull request work as they do for WSL. |
| Anyone (no login) | See a ladder that is this machine's — on Linux, two rungs rather than three with one greyed out. |

**Information shown / collected** — added.
- What this platform's ladder is, and — when the stored rung is not on it — that runs are happening on this machine until a choice is made.
- Whether this engine can apply processor, memory and process limits at all, from what it said about itself.
- On Linux, that the organisation row's Linux equivalents are **not read** by this app.

**Data to store.** Nothing new, and no migration. `agentSandbox` is unchanged; the per-run `restricted_by` record already carries the rung; the agent-home volume has a fixed name of the app's own, so it is not a setting — the same reasoning as the distribution and the image.

**Access & security.** Two claims get stronger and one gets weaker, and all three are said. Stronger: a container run's work leaves the boundary by the repository fetching a branch, which is the WSL route and needs nothing of this machine inside the container. Stronger: the files a run writes are the running person's, so nothing needs root to clear up after it. Weaker, and named: credentials now persist in a volume every run container mounts, so the sign-in hole this page already names for WSL exists for Docker too, and is shared between runs. None of this is access control — there is still no authentication and roles are still visibility only — and no row claims what detection has not proved, the new one about limits included.

**Tests**
- [ ] On Linux the report has no WSL column at all; on Windows it has three.
- [ ] Nothing spawns `wsl.exe` or `reg.exe` on Linux — asserted over the source, the way the seam's caller set is.
- [ ] A stored rung this platform does not have resolves to `Off`, and the panel says the setting is not available here rather than showing a boundary.
- [ ] `set_agent_sandbox` refuses a rung that is not on this platform's ladder.
- [ ] On Linux the organisation row reads "not checked", never "unmanaged, permitted".
- [ ] A run recorded under Docker has its branch fetched into the repository; a run recorded under `off` is left alone.
- [ ] A pull request for a container run is opened from the repository, not from the clone.
- [ ] The `docker run` line names the caller's uid and gid on Unix, and does not on Windows.
- [ ] A file written inside a container is owned by the person running the app, and the app can delete the run folder afterwards *(live)*.
- [ ] An engine that says it cannot apply memory or process limits gets `Unavailable` on that row with the reason, and the other rows are unaffected.
- [ ] The sign-in container mounts the agent volume and neither the repository nor any run folder.
- [ ] A run container mounts the same volume, so a sign-in done once is found by a later run *(live)*.
- [ ] No column's words contradict its own `built` flag.

**Open questions**
- **One shared agent home, or one per Product?** Shared is what makes a single sign-in work and is what this round builds; per-Product would narrow the hole and multiply the sign-ins. Recorded rather than guessed.
- **What to offer a Linux machine whose rootless engine cannot limit anything.** It is a real boundary for files and processes and not one for resources, so it is offered with that row red — whether that is the right default is a product question this round does not settle.
- **Podman.** The nearer answer on Linux for both ownership and daemon privilege, and out of scope here; the container backend should take its binary name as a variable so that stays cheap.
- **Still open from earlier rounds:** a container's network, which the agent keeps because it needs its model; and nothing removing a run's container, its folder, or now its volume.

#### Page Skills — new for this round
| Skill | Why it's needed | How the AI will use it | New? |
|---|---|---|---|
| Platform-conditional reporting | One panel is compiled for two operating systems with different ladders. | `cfg`-gated `available_here()` and Windows-only detection, with the platform difference tested rather than assumed. | Yes. |
| Reading an engine's own capability statement | A flag accepted is not a limit applied, and rootless engines accept everything. | Parse `docker info` for the limit fields and report what it answered — the pure-function treatment `server_version` already gets. | Extends round 4's detection. |
| Host and container identity agreement | A container writing into a bound host folder must agree with that folder's owner. | Pass the caller's uid and gid on Unix, keep `HOME` on the app's own volume, and prove it by what lands on disk. | Yes. |

---

## PLAN — round 12

**Summary.** Make the ladder a property of the platform, stop asking Windows questions on Linux, and close the three gaps that stop a container run finishing: signing in, bringing the branch back, and who the files belong to. Two honesty faults found beside them are fixed with them. No new rung, no schema change, no new setting.

**Changes**
- `tooling/sandbox.rs`: `available_here()`; `report()` builds only available columns; the Docker summary stops contradicting `built`; the limits row takes what the engine said about itself.
- `tooling/sandbox_detect.rs`: `wsl()` and `policy()` become Windows-only; `engine_limits()` (new, a pure parse of `docker info`); the Linux wording for the organisation row.
- `tooling/sandbox_docker.rs`: `--user <uid>:<gid>` on Unix, the agent-home volume in every run container, and the sign-in container's argument list.
- `commands/terminals.rs`: `sign_in_inside` answers for Docker instead of refusing.
- `commands/runs.rs` and `commands/vcs_ops.rs`: ask the run's recorded rung rather than the shape of its path.
- `commands/ai_settings.rs` and `db/system_setting.rs`: refuse a rung this platform does not have; report a stored-but-unavailable rung as `Off`, with the reason.
- Frontend `SandboxTable.tsx` and `PolicySource.tsx`: render the columns the backend sends rather than three fixed ones, and show the stored-but-unavailable notice.
- Tests: the thirteen above — cargo for the platform ladder, the recorded-rung gate, the uid arguments and the engine-limits parse; Vitest for a two-column table and for the notice.

**Expected technical debt**
- One agent home shared by every container run: a real hole, named on the page, narrower than the host keyring rather than absent.
- Nothing removes the volume, the containers or the run folders; this round adds a third thing nothing cleans up.
- The Linux organisation row reports *not checked* rather than reading SELinux, AppArmor or the userns sysctls — honest, and still a gap.
- The container backend hard-codes `docker`; Podman would be that name plus `--userns=keep-id`, and is not done here.
- Everything Linux is unproven until it is run on Linux. The panel half is testable in CI; the ownership and sign-in halves need a real Linux machine with an engine, and until then this round claims nothing it has not seen.
