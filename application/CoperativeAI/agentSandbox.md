---
form: page-brief
page: "Agent Sandbox"
solution: "CoperativeAI"
depends-on: ["adminArea.md", "terminal.md", "developerArea.md", "aiSettings.md"]
status: built             # blank | filled | approved | built
---

# Page Brief — Agent Sandbox

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So an agent that has been told not to ask can be run somewhere it cannot damage the machine — and, just as importantly, so the app never claims more containment than is actually in force. "Never ask" hands a shell the run of a developer's computer: their keys, their repositories, their whole drive. A sandbox is what makes that setting defensible. But a sandbox that is only nominally one is worse than none, because it is chosen *believing* it protects something. This page is where the choice is made and where the truth about it is told.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: anyone using the app) can: choose where agents run — **Off** (this machine, as today), **WSL**, or **Docker** — as one setting for the whole app.
- Someone (who: anyone using the app) can: see, before choosing, what each option would *actually* enforce on this machine — not what the option is called.
- Someone (who: anyone using the app) can: create the sandbox the app owns — a dedicated WSL distribution, or the agent's base image — as a deliberate press, with everything it printed handed back whole rather than reduced to "done".
- Someone (who: anyone using the app) can: sign in to Claude Code inside the sandbox, as a one-time step, from a terminal the app opens for them.
- Someone (who: anyone using the app) can: point WSL mode at a distribution they already have instead, and be told plainly what that one does and does not enforce.
- Someone (who: anyone using the app) can: start a run whose agent terminal, test commands and dev commands all run inside the chosen sandbox, without changing how any of those are used.
- Someone (who: anyone using the app) can: see on a run which protections were in force for it, during and after.

### look — What should it look like?
A card in the Admin environment, directly beside the existing "how the agent asks" setting — the two belong together, because the second is what makes the first safe. Three options listed in increasing order of both protection and prerequisites (Off → WSL → Docker), never as three equivalent flavours. Under them a live table: one row per protection (filesystem boundary, one run cannot reach another, reduced privileges, resource limits, network control), one column per option, each cell filled in from what detection actually found on this machine and greyed where it is unavailable or unproven. On the run panel, a short badge naming the sandbox in force — and plain words, not a padlock, wherever a protection is absent.

### information — What information does this page show or collect?
- The chosen setting.
- What was detected on this machine: whether WSL is present and which distributions, whether a Docker **server** is actually running, and — for WSL — whether the Windows drive is still mounted inside it.
- Per run: which sandbox was in force and which protections it really had.

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login. Roles gate visibility only and must not be described as controlling this.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
The distribution the app owns and the image it builds have fixed names of the app's own, so neither is a setting and neither is stored. A Solution that carries its own container definition already carries it in its repository, which is where it stays.

One system setting, `agentSandbox` — one of `off` / `wsl` / `docker`, defaulting to `off`, alongside `agentRunMode`. Each run records the sandbox that was in force when it started, so its record still tells the truth once the setting has moved on. Nothing about detection is stored: it is re-read each time, because the configuration it reports can be changed outside this app between one run and the next.

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
The detection result for the current view, and the container or distribution a live run is using, so cancelling a run can reach the process it really started.

### tests — How will we know it works? What should we test?
- With the setting **Off**, everything behaves exactly as it does today — the same command, the same shell, the same working folder.
- Detection asks Docker for its **server** version, so a Docker client installed with no daemon running is reported as unavailable rather than available.
- Detection runs WSL rather than merely finding it on PATH.
- **WSL with the Windows drive still mounted is reported as having no filesystem boundary** — the single most important assertion here, because that is the default state and it looks like protection.
- A run under Docker cannot write outside what was mounted for it.
- A test command runs under Docker with the network switched off.
- A path crossing into the sandbox and a `file:line` coming back out both translate, so a finding from a sandboxed test run still opens in the editor.
- No protection is ever shown as on that detection did not prove.
- Every place the app starts a process goes through the one sandbox seam — asserted as a set, so a fourth caller cannot quietly bypass it.
- The distribution the app creates has the Windows drive unmounted and a user that is not root, and the run's repository reaches it as one named mount rather than as a whole drive.
- A Solution with no container definition of its own is reported as having no toolchain under Docker, rather than being run in the agent's base image.

### limits — Any known limits or things to watch out for?
- **WSL in its default configuration is not a security control.** With the Windows drive automounted, an agent inside it can rewrite the whole machine. It only becomes containment in a distribution that does not mount it. **The app therefore creates and owns one** — a distribution of its own name, with the drive unmounted and a user that is not root — because a mode whose protection depends on a configuration the app did not set is a mode that can only report other people's accidents. Creating it changes someone's machine, so it is a press and never a default, and it prints what it did. Pointing at an existing distribution stays possible for anyone who wants it, and is reported for what it usually is: no boundary at all. Where WSL is too old to be given a distribution of its own, that is said, and only the existing-distribution form is offered.
- **The repository is mounted into the sandbox explicitly, one path, both modes.** With the drive unmounted, the run's checkout reaches WSL the same way it reaches a container: as a single named mount of the repository root. That is what makes the boundary the same sentence in both modes rather than two different stories.
- **The agent's toolchain and the Solution's are not the same thing, and only one of them is the app's to keep.** The image the app owns carries what the *agent* needs — git, node, Claude Code — because that is all the app can honestly maintain. What a Solution needs to build and test itself belongs to that Solution: its own container definition is used when it has one, and when it has not, Docker mode says so for that Solution rather than running it in a base image that will fail later wearing the wrong version number. A fat image with every toolchain in it would be stale in a month and wrong in a way nobody could see.
- **The boundary is the repository, not the run's checkout.** A worktree's `.git` is a file pointing back at the main repository, so mounting only the run's folder breaks git. The repository root is mounted, and the panel says so in those words. A clone per run would be tighter and is a separate decision — it changes what a run's stored folder means.
- Claude Code has to be installed and signed in *inside* the sandbox; the credentials mounted for it are a real hole, smaller than the host keyring but worth naming where the choice is made.
- Files reached across the Windows boundary are slow enough to change how a run feels; build output belongs inside the sandbox's own filesystem.
- The debugger, dev-server ports, and the Figma and GitHub tokens stay outside. A sandboxed run is a narrower environment than the one it was developed in, and some work will pass outside it and fail inside it.
- Restricting where an agent may connect is not attempted in this round: the agent needs its model and its package registries, and an allowlist that blocks installing a dependency is one that gets switched off.
- Choosing a sandbox must not silently change how the agent asks. The two settings sit together and are pressed separately.

### model-and-effort — Which AI model and effort level should this page use by default?
Most capable model, high effort.

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
- Round 1 (my feedback): Support **both** WSL and Docker and let the user decide between them, rather than picking one. *(The app runs on Windows, so a Linux sandbox means one or the other, and Docker Desktop runs on WSL anyway — which makes them a ladder rather than a fork. The condition on building it: the picker has to tell the truth about what each rung actually enforces on the machine in front of it, because the honest answer is that one of the two options, as most machines have it configured, enforces nothing at all.)*
- Round 2 (my feedback): Answer the two questions the translation raised, because both were cheap now and expensive once the seam exists. **The app creates and owns the WSL distribution** rather than borrowing one — a mode whose protection depends on a configuration the app did not set can only report other people's accidents, and in the usual case that report is "no boundary". Borrowing one stays available and is described honestly. **The app owns only the agent's image** — git, node, Claude Code — and a Solution's own build toolchain stays the Solution's, used from its own container definition when it has one and reported as missing when it has not. *(The second answer is the same rule as the first and as the cost one: keep what you can actually maintain, and say plainly where you cannot see. A single image with every toolchain in it would be stale within a month and wrong in a way nobody could spot until a build failed wearing the wrong version number.)*
- Round 4 (built): **Detection, and the table that reports it.** The app now asks WSL and Docker what they are rather than looking for them on a path, and shows the answer in the Admin area beside "how agents run". Every judgement is a pure function over what the tools printed, so it is tested against real captures — including this machine's own mount line — on a machine that need have neither installed. Three things this round settled. **Every cell has three states, not two**: in force, this-machine-could-but-it-is-not-built, and no. Neither sandbox runs anything yet, so nothing anywhere reads as in force — a tick against a mode that refuses every command would be exactly the claim the page exists to prevent, and a test in each half asserts it cannot happen. **There is no picker yet**, because choosing a mode that refuses would stop the terminal working; it arrives with the first backend that can honour it. And **verdicts are words, never a padlock or a tick** — a symbol is read as reassurance before it is read at all, and most of these verdicts are not reassuring. *(What this machine says today: WSL has Ubuntu, which mounts the whole Windows drive, so it offers no boundary at all; Docker is installed with its engine stopped. Both correct, and both are why the table exists.)*
- Round 3 (built): The seam and the **Off** path. `tooling/sandbox.rs` decides what runs and where and hands it back rather than spawning; the three places that start a command on somebody's behalf — the terminal, the test runner, the starter — go through it, and the setting (`agentSandbox`, default off) is resolved per press so it will take effect without a restart. Off changes nothing, which the whole existing suite proves. Two things fell out of building it. **The Code panel and a run's agent terminal are one function**, so covering the run covered the panel by construction and the open question about the ad-hoc terminal answered itself. And **the two unbuilt modes refuse rather than fall through** — a sandbox that quietly ran the command anyway would be this feature failing at the one thing it exists for, invisibly. The seam is held closed by a test that reads the source: any file that starts a process must be filed as sandboxed or outside-with-a-reason, and a file claiming to be sandboxed is checked to actually reach the seam. **Not built yet:** detection, the picker, the capability table, provisioning, path translation, and both backends — so no protection is claimed anywhere yet.
