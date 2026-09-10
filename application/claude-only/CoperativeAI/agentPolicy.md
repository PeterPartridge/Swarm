# Page Spec — Agent Policy

> Produced by `/translate` from [`../../CoperativeAI/agentPolicy.md`](../../CoperativeAI/agentPolicy.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Name the files an agent must not reach, in a file that lives with the code, and have that **enforced by the operating system** rather than requested of the agent. A policy script runs inside the boundary as root before the agent starts; the agent then works as an ordinary user that cannot become root, so what the script sets it cannot undo.

**Model & effort**
Most capable tier (Claude Fable 5), high effort — it makes claims about what an agent cannot do.

**Depends on**
- `CoperativeAI/agentSandbox.md` — **the whole feature rests on it.** Without a sandbox there is no separate user, so there is nothing to enforce anything against.
- `CoperativeAI/adminArea.md`
- `CoperativeAI/repositoryManagement.md` — *status says `filled`; see Open Questions.*

**Actions**

| User | Can do |
|------|--------|
| Anyone (no login) | Write a policy for a Solution: the folders and files an agent must not reach, and the commands it must not run. |
| Anyone (no login) | See, per rule, **which promise it keeps** — enforced by the system, or asked of the agent. |
| Anyone (no login) | Save the policy into the Solution's repository, so it travels with the code. |
| Anyone (no login) | Install a policy somebody else wrote, and see what it would change before it takes effect. |
| Anyone (no login) | See, on a run, which policy was in force for it. |
| Anyone (no login) | Be told plainly when a rule cannot be enforced here — the sandbox is off, or the rule is one only the agent can honour. |

**Information shown / collected**
- The rules: paths not to read, paths not to write, commands not to run.
- Per rule, whether the system enforces it or the agent is merely asked.
- What installing a file would change, before it changes anything.
- Per run: the policy that was in force, kept with the run.

**Data to store**

| Item | What it looks like |
|------|--------------------|
| The policy | A file in the Solution's repository. That is what makes it shareable, reviewable and installable — a copy in this app's database is the one nobody else gets. |
| The pointer | Where that file is, per Solution. |
| A run's policy | What the run actually used, so its record stays true after the file moves on. |

**How it works**

After a run's copy is made and **before the agent is given anything to do**, the policy runs inside the boundary as root. A protected path is given to `root` and made unreadable to anyone else; the agent then works as its ordinary user with no way to become root.

Established on the machine this was written on, not assumed:

- Reading a root-owned mode-`000` file as the agent: **Permission denied**.
- `chmod` on it: **Operation not permitted**. `chown`: the same.
- **Deleting it succeeded** — removal depends on write permission on the *directory*, not on the file.
- The sticky bit does not fix that: it permits the directory's owner, and that is the agent.
- With the **parent directory root-owned too**, deletion is refused as well — at the price that the agent can then create nothing in that directory.

**Access & security**
This is the first thing in the app that claims an agent *cannot* do something, so the project's rule — never claim a protection that has not been proved — binds harder here than anywhere. Two promises, never blurred: **enforced** means the operating system refuses the agent, and **asked** means the agent has been requested and can be told to disregard it, which is worth nothing under "never ask". With the sandbox **off** there is no separate user at all: the agent runs as the person using the machine, and every rule must report as asked-only, because that is all any of them can be. A policy script runs **as root inside the boundary**, so it can weaken that boundary as easily as strengthen it — it is shown before it runs, the way the language starters already are. Roles gate visibility only and must never be described as controlling this.

**Tests**
- [ ] A protected path **cannot be read by the agent** — tried from inside, as the agent, and refused.
- [ ] The agent **cannot undo it**: `chmod` and `chown` are both refused.
- [ ] Where the policy asks for it, the agent **cannot delete it either**; where that was not possible without taking the directory, the page said so rather than implying otherwise.
- [ ] The policy runs **before** anything is handed to an agent, never after.
- [ ] With the sandbox off, every rule reports as asked-only.
- [ ] A rule only the agent can honour is labelled as such and never described as enforced.
- [ ] A policy saved in one repository and installed into another produces the same rules.
- [ ] Installing shows what it would change, and applies nothing until it is confirmed.
- [ ] A malformed policy is refused naming the line that is wrong, and leaves the existing one alone.
- [ ] A rule naming a path outside the repository is refused rather than silently ignored.
- [ ] A run records the policy it used and still reports it after the file has changed.

**Open questions**
- **Does this work under Docker at all?** The container is started with `--cap-drop=ALL`, which drops `CAP_CHOWN` and `CAP_FOWNER` — the two capabilities root needs to take ownership and override permissions. Root inside that container may therefore be unable to apply a policy, and the fix (granting those capabilities back) would weaken the container to enforce a restriction. **Worth checking against a real container before any of this is built**, because if it does not work the feature is WSL-only and the table has to say so.
- **What is the policy file?** The brief does not say what shape it takes or what it is called. It has to be readable enough to review in a pull request, since reviewing it is the safeguard against a hostile one.
- **Where may an installed policy come from?** The brief flags this as a decision and does not make it. A shared policy is somebody else's root script; "a file you have looked at" and "a URL" are very different propositions.
- **How much is "commands it must not run" actually worth?** The proven mechanism is file permissions, so a command is restricted by making its binary unreadable — which works, and is far weaker than a file rule: an agent with a language runtime can rewrite most small tools. The page should not imply parity between the two.
- **`repositoryManagement.md` is `status: filled`.** The Code map records the feature as built (`components/vcs/`), so this looks like the stale frontmatter `terminal.md` had rather than unbuilt work. Either that status is corrected, or the dependency is dropped — the policy file needs a folder to live in, which is `solution.local_path`, not repository management as such.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| Enforcing with the system rather than asking | The whole difference between this and a deny-list is who refuses. | Run the policy as root inside the boundary before the agent starts; give protected paths to root; leave the agent as an ordinary user that cannot become root. | Yes. |
| Saying which promise a rule keeps | A rule the agent merely honours is worth nothing under "never ask", and must never be shown as though it were. | Two plainly different words per rule, decided from the sandbox in force and the kind of rule — never one icon for both. | Extends the sandbox's capability table. |
| Reviewing a script before it runs | An installed policy is somebody else's root script inside the boundary. | Show it whole before it is applied, and show what it would change, the way the language starters are shown before they run. | Extends `starter`'s "shown before it runs" rule. |

---

## PLAN

**Summary:** A policy file per Solution, applied by a script that runs inside the boundary as root before the agent starts, and a panel that says per rule whether the system enforces it or the agent is merely asked.

**Changes:**
- A policy reader and writer for the Solution's repository, refusing a malformed file by line and leaving the existing one alone.
- `tooling/sandbox_policy.rs`: pure — turn a policy into the commands that apply it; and the spawning half that runs them as root inside the boundary in force.
- Applied from the run flow, **after the copy is made and before the brief is handed over**, for WSL and — subject to the capability question above — Docker.
- `change_runs` records the policy a run used.
- Admin: a card beside the sandbox panel, in the same shape, with the rules, their two-word verdicts, and save/install with a preview of what would change.
- Tests: the eleven above, with the enforcement ones run against the real distribution rather than fixtures, because that is the only place the claim can be proved.

**Expected technical debt:**
- Docker may not be able to enforce this at all under `--cap-drop=ALL`; if so the feature is WSL-only until that is resolved, and the table must say which.
- Restricting a file the build needs will present as a broken build rather than as a policy.
- Undeletable costs the directory, so single files at a working copy's root can be made unreadable but not undeletable.
- Nothing here can keep anything from an agent that reaches the network.

**Status:** translated — waiting for approval
