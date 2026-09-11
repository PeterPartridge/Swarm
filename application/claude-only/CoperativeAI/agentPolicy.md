# Page Spec — Agent Policy

> Produced by `/translate` from [`../../CoperativeAI/agentPolicy.md`](../../CoperativeAI/agentPolicy.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.
>
> Re-translated after Round 4, which replaced one mechanism with two.

**Objective** _(unchanging)_
Name the files an agent must not reach, in a file that lives with the code, and have that **enforced by the operating system** rather than requested of the agent. The policy says *what*; each boundary applies it its own way.

**Model & effort**
Most capable tier (Claude Fable 5), high effort — it makes claims about what an agent cannot do.

**Depends on**
- `CoperativeAI/agentSandbox.md` — **the whole feature rests on it.** With no sandbox there is no separate user and no container, so there is nothing to enforce anything against.
- `CoperativeAI/adminArea.md`

**Actions**

| User | Can do |
|------|--------|
| Anyone (no login) | Write a policy for a Solution: the folders and files an agent must not reach, and the commands it must not run. |
| Anyone (no login) | Point at where a policy comes from — a GitHub location or a file on this machine — and the command that installs it, **inside the "Where agents run" card**. |
| Anyone (no login) | Read the whole script before it runs, and see what installing would change before it takes effect. |
| Anyone (no login) | Add a script of their own for what a list cannot express, and be told it takes effect **under WSL only**. |
| Anyone (no login) | See, per rule, **which promise it keeps** — enforced by the system, or asked of the agent. |
| Anyone (no login) | See, on a run, which policy was in force, from where, at which commit. |
| Anyone (no login) | Be told plainly when a rule cannot be enforced here. |

**Information shown / collected**
- The rules: paths not to read, paths not to write, commands not to run.
- Where the policy came from, and at which commit.
- Per rule: enforced by the system, or asked of the agent.
- What installing would change, before it changes anything.
- Per run: the policy in force, kept with the run.

**Data to store**

| Item | What it looks like |
|------|--------------------|
| The policy | **JSON, at `.coperativeai/policy.json`** in the Solution's repository. JSON because it must be reviewable in a pull request — a diff of a list of paths is something a person can read, and that review is the only safeguard against a hostile policy. In the repository because that is what makes it shareable and installable. |
| The source | Where it came from and the commit it was pinned to, per Solution. |
| A run's policy | What the run actually used, so its record stays true after the file moves on. |

**How it works — two mechanisms, because one of them does not exist in a container**

| | WSL | Docker |
|---|---|---|
| Mechanism | Permissions: the path is given to `root` and made unreadable | Mounts: the path is masked when the container is created |
| Applied | Before the agent starts, as a script run as root | At container creation, as flags — earlier than any script could run |
| Capabilities needed | Root inside the distribution | **None** |
| The agent sees | The file, and is refused | Nothing at all |

Established on a real machine, not assumed:

- **WSL.** Reading a root-owned mode-`000` file as the agent: *Permission denied*. `chmod` and `chown` on it: *Operation not permitted*. **Deleting it succeeded** — removal depends on write permission on the *directory*. The sticky bit does not help: it permits the directory's owner, which is the agent. With the parent root-owned too, deletion is refused — at the price that the agent can create nothing in that directory.
- **Docker.** Root inside the container **cannot** give a file to another user: `chown` returns *Operation not permitted*, because `CAP_CHOWN` is dropped. The permissions route does not exist there. Masking with a mount does work, needs no capabilities, and gives *No such file or directory* through it.

Granting the container those capabilities back would buy the permissions route at the cost of weakening the container. Bad trade, unnecessary — which is why the policy is a list of *what* rather than a script of *how*.

**Access & security**
This is the first thing in the app that claims an agent *cannot* do something, so the project's rule — never claim a protection that has not been proved — binds harder here than anywhere. Two promises, never blurred: **enforced** means the operating system refuses the agent; **asked** means the agent has been requested and can be told to disregard it, which is worth nothing under "never ask". With the sandbox **off** there is no separate user and no container: the agent runs as the person using the machine, and every rule must report as asked-only, because that is all any of them can be. A policy script runs **as root inside the boundary**, so it can weaken that boundary as easily as strengthen it — hence: fetched on this machine so it can be read before it is used, shown whole before it runs, pinned to a commit and never a branch, and recorded with the run. Roles gate visibility only and must never be described as controlling this.

**Tests**
- [ ] A protected path **cannot be read by the agent** — tried from inside, as the agent, and refused.
- [ ] The agent **cannot undo it**: `chmod` and `chown` are both refused.
- [ ] Where the policy asks for it, the agent **cannot delete it either**; where that needed the directory, the page said so rather than implying otherwise.
- [ ] The policy takes effect **before** anything is handed to an agent — under WSL as permissions, under Docker as the container's mounts.
- [ ] **The same policy file restricts under both backends**, checked from inside each rather than from the flags meant to cause it.
- [ ] A user-supplied script is applied under WSL and reported as **not in effect** under Docker, never silently ignored.
- [ ] With the sandbox off, every rule reports as asked-only.
- [ ] A rule only the agent can honour is labelled as such and never described as enforced.
- [ ] A policy saved in one repository and installed into another produces the same rules.
- [ ] Installing shows what it would change, and applies nothing until confirmed.
- [ ] A malformed policy is refused naming the line that is wrong, and leaves the existing one alone.
- [ ] A rule naming a path outside the repository is refused rather than silently ignored.
- [x] A GitHub source given as a branch is refused, or pinned to the commit it resolves to. *(Refused, and named: `moving_github_ref` tells `.../blob/main/p.json` from `.../blob/<40 hex>/p.json` and the refusal says which part of the address to replace. A branch is allowed only once a digest pins it, which makes the same promise by a different route.)*
- [x] The script is shown in full before it can run, and running is a separate press from fetching.
- [x] A fetched policy is hashed, and a source can carry the digest it must have — checked before anything is written, and again before it is run.
- [x] A run records its policy, its source and its commit, and still reports them afterwards. *(Closed, but not as written — see the finding below. A run records the Solution's policy file, its digest and its deny list; and, **in a separate field**, any policy script that had been run into that same boundary, with its origin, digest and date. This line assumed the two were one thing. They are not, and recording them as one would have asserted a cause that does not exist.)*

**Open questions**
- **May an installed policy come from a URL, or only from a file already looked at?** The brief names the safeguards but does not close this. *(Closed: both, with the URL route carrying every safeguard — https only, fetched here, shown whole, run on a separate press, and a digest that can be pinned.)*
- **Closed as a finding: there are two mechanisms here, not one.** The brief imagined a single thing — a policy you fetch and install. The build produced two, and they are different in kind:
  - The Solution's `.coperativeai/policy.json` is **declarative**: a deny list, in the repository, read on every run and enforced by permissions under WSL or mount masking under Docker. This is what bounds a run.
  - The fetched source is **imperative**: a script, app-wide, run as root into the WSL distribution by a press in Admin. It produces no deny list, is not read per run, and under Docker never runs at all.

  So the fetched source is not where a run's rules came from, and "this run's policy source" was a question with no true answer rather than one nobody had implemented. A run now records both, in separate fields, in different words: what bounded it, and what had been run into that boundary beforehand. Whether the two should be *unified* — a source that writes a Solution's `policy.json` — is a product question, not a gap in this one, and is left open deliberately.
- **What was installed is recorded; what is still in force is not, and cannot be.** Nothing watches a distribution after a script runs in it. Root inside it can undo every permission the script set, and running set-up again rewrites the agent user and the run space — so the record is cleared on a successful set-up rather than left to age into a claim about a boundary that no longer exists.
- **The first fetch of an unpinned source is trust.** A digest can only be shown until somebody sets one to check it against. The panel says so in as many words; there is no way to do better without a channel the app does not have.
- **How much is "commands it must not run" worth?** A command is restricted by making its binary unreadable, which works and is far weaker than a file rule — an agent with a language runtime can rewrite most small tools. The page must not imply parity.
- **The two backends fail differently.** Under WSL a protected file exists and is refused; under Docker it is absent. A build that expects a file behaves differently in each. Whether the page should warn about that, or the policy should be able to say which it wants, is not settled.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| One policy, two mechanisms | The permissions route does not exist in a container, and the mounts route does not need a script. | Read the policy once; apply it as permissions under WSL and as mount flags under Docker; prove each from inside rather than from the flags. | Yes. |
| Saying which promise a rule keeps | A rule the agent merely honours is worth nothing under "never ask" and must never look like one that is enforced. | Two plainly different words per rule, from the sandbox in force and the kind of rule — never one icon for both. | Extends the sandbox's capability table. |
| Reviewing a script before it runs | An installed policy is somebody else's root script inside the boundary. | Fetch on this machine, show it whole, pin it to a commit, record it with the run — and make running a separate press from fetching. | Extends `starter`'s "shown before it runs" rule. |

---

## PLAN

**Summary:** A policy file per Solution saying what an agent must not reach, applied as permissions under WSL and as container mounts under Docker, with a panel inside "Where agents run" that says per rule which promise is being kept.

**Changes:**
- A policy reader and writer for the Solution's repository, refusing a malformed file by line and leaving the existing one alone.
- `tooling/sandbox_policy.rs`: pure — a policy plus the mode in force becomes either the commands to run as root or the flags to create the container with. Both halves testable without a machine.
- WSL: applied from the run flow after the copy and before the brief. Docker: folded into `run_args`, since the container cannot exist unrestricted first.
- A source (GitHub or file) with fetch and run as separate presses, the script shown whole, and branches pinned to commits.
- `change_runs` records the policy, its source and its commit.
- Admin: inside the sandbox card — the rules, their two-word verdicts, the source, and a preview of what installing would change.
- Tests: the fifteen above, with every enforcement claim proved **from inside each backend** rather than from the flags meant to cause it.

**Expected technical debt:**
- Restricting a file the build needs will present as a broken build rather than as a policy — and differently in each backend, since one hides the file and the other refuses it.
- Undeletable costs the directory, so a single file at a working copy's root can be made unreadable but not undeletable.
- Nothing here keeps anything from an agent that reaches the network.
- A user-supplied script is WSL-only, which is a real asymmetry between the two modes rather than an implementation detail.

**Status:** re-translated — waiting for approval
