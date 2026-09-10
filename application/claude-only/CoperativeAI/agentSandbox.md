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

**Technical debt after round 3:**
- Provisioning cannot be cancelled. A slow `apt-get` leaves somebody watching a disabled button for minutes with no way out but closing the app.
- Nothing streams. Each step's output arrives when the step ends, so the longest two look like nothing is happening while they are the ones worth watching.
- The Dockerfile is a string in the binary. The starters follow a "shown before it runs" rule; this does not yet, and should once it grows.
- `wsl --install` downloads from Microsoft's catalogue — a dependency the app can only report on when it is unreachable.
- Three machine-changing presses now exist (npm install, WSL set-up, image build) and still share no path. This round made that debt bigger.
- The live path is unproven on any machine.

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

**Status:** round 3 built (2026-09-10) — provisioning

---

## Report back — round 3

**Tests:** `cargo test` 801 passed, 0 failed, 25 ignored. `npm test` 772 passed across 73 files. Thirteen new: ten in Rust, three in Vitest, plus one ignored live check that really does change the machine.

**What it does.** `tooling/sandbox_provision.rs` creates the app's own WSL distribution from Ubuntu (`--no-launch`, so nothing interactive runs), writes `/etc/wsl.conf` to unmount this machine's drive and name a non-root user, adds that user, installs what the *agent* needs (git, Node, Claude Code), and **restarts the distribution** — without which `/etc/wsl.conf` is never read, the drive stays mounted, detection goes on saying so, and the whole feature looks broken. For Docker it writes the agent's Dockerfile and builds the image.

**Deciding is separate from running**, as in the detector: `plan_wsl` and `plan_docker` are pure, so *an existing distribution is configured and never recreated* is a test rather than a hope. Somebody may have work in a distribution, and reaching a tidy state by destroying it is not this app's call.

**It stops at the first failure** and names the step. Every step after a failed one would be working on a distribution that is not in the state it assumed, and four more failures caused by the first bury the one that matters. What each step printed is kept whole and shown — when a package is missing, that output is the only thing that names it.

**A real bug the tests caught.** The `wsl.conf` contents travel to `sh -c` inside single quotes, and the first draft contained one, in the phrase "the app's own" — which would have ended the quoting early and written half a config file. The failure mode is the worst available here: a distribution that silently stays unbounded while the app reports it as set up. `no_single_quotes_survive_into_a_shell_argument` now holds it.

**Node comes from the distribution's own packages**, not a shell script piped from the network and run as root. It may lag a release; fetching and executing a remote script *inside the boundary this exists to build* would be the worse trade.

**Test scenarios created:** a machine with no distribution of ours is given one; an existing one is configured, never recreated; a mounted drive is unmounted and the distribution restarted last; an old WSL is told the truth (naming both its version and 2.4.4) rather than worked around; a machine without WSL is offered no set-up; the config really does disable automount and drop root; nothing embedded in a shell argument carries a quote of its own; the image carries git, Node and Claude Code and none of cargo/dotnet/python/go; nothing is built without an engine; a stopped set-up names its step and keeps its words. In the panel: a set-up that cannot run says why rather than only greying out; what each step printed survives to the screen; and the table is read again when a set-up finishes, because whether the verdicts changed is the entire point.

**Not verified live.** The ignored `setting_up_for_real` exists and is written to be run, but running it registers a WSL distribution and downloads several hundred megabytes onto this machine — a change to somebody's computer rather than to this repository, so it waits for them to ask.

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
