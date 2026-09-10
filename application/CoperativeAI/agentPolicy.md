---
form: page-brief
page: "Agent Policy"
solution: "CoperativeAI"
depends-on: ["agentSandbox.md", "adminArea.md", "repositoryManagement.md"]
status: filled            # blank | filled | approved | built
---

# Page Brief — Agent Policy

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So the files an agent must not touch can be named once, kept in the repository, shared with a colleague, and enforced — rather than remembered.

The sandbox answers *where* an agent runs. It does not answer *what it may reach once it is there*: inside the boundary, an agent can read every file of the work it was given, including the ones nobody meant it to see. A policy is where somebody says "not those", in a file, in writing.

**How it does that: a script that runs before the agent starts.** Once a run's copy is in place and before anything is handed to an agent, a policy script runs **inside the boundary as root** and sets permissions on what the policy names. The agent then starts as an ordinary user that cannot gain privileges — so what root set, the agent cannot undo. This is enforced by the operating system, not by the agent's good behaviour, which is the whole reason it is worth building.

**And it exists to keep two very different promises apart.** "The agent has been asked not to read this" and "the agent is not permitted to read this" are both called access control, and only the second survives an agent that has been told not to ask. A policy that emitted only deny-rules for the agent to honour would be a padlock drawn on a door — the exact thing this app's sandbox was built to stop being.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: anyone using the app) can: write a policy for a Solution — the folders and files an agent must not reach, and the commands it must not run.
- Someone (who: anyone using the app) can: see, per rule, **which promise it is** — kept out of the agent's reach entirely, or asked of the agent and dependent on it obeying.
- Someone (who: anyone using the app) can: save a policy as a file in the Solution's repository, so it travels with the code and a colleague gets the same one.
- Someone (who: anyone using the app) can: point at where the policy comes from — **a GitHub location or a file on this machine** — and give the command that installs it, in the "Where agents run" card rather than on a page of its own.
- Someone (who: anyone using the app) can: read the whole script before it runs, and see what installing it would change before it takes effect.
- Someone (who: anyone using the app) can: start a run and see, on the run, which policy was in force for it.
- Someone (who: anyone using the app) can: be told plainly when a rule cannot be enforced here — because the sandbox is off, or because the rule is one only the agent can honour.

### look — What should it look like?
**Inside the "Where agents run" card, not beside it.** The source and the boundary belong together: a policy means nothing without a sandbox, and a separate panel would invite reading it as protection in its own right. Under the mode cards: where the policy comes from (a GitHub location or a file), the command that installs it, and what it would do — the state first, the detail underneath, in the shape that card already has. A list of rules, each showing what it covers and **how it is kept** — two plainly different words, never one icon. Where a rule is only asked of the agent, it says so on the rule, not in a footnote. Buttons to save the policy to the repository and to install one from a file, with what-would-change shown before anything is applied.

### information — What information does this page show or collect?
- The rules: paths not to read, paths not to write, commands not to run.
- For each rule, whether it is enforced by the boundary or asked of the agent.
- Which policy a run used, kept with the run.
- What installing a file would change, before it changes it.

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login. Roles gate visibility only and must never be described as controlling this.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
The policy lives in the Solution's repository as a file, because that is what makes it shareable, reviewable and installable — a copy in this app's database would be the one nobody else gets. The database holds only the pointer and what a run used, so a run's record still tells the truth after the file changes.

### how-it-works — What actually happens, and when?
After the run's copy is made and **before the agent is given anything to do**, the app runs the policy inside the boundary as root:

- A path the policy says must not be read is given to `root` and made unreadable to anyone else.
- The agent then works as its ordinary user, with no way to become root — so it cannot read the file, and cannot change its permissions or its owner back.

Established on the machine this was written on, rather than assumed:

- Reading a root-owned, mode-`000` file as the agent: **Permission denied**.
- `chmod` on it: **Operation not permitted**. `chown`: the same.
- **But deleting it succeeded** — removing a file depends on write permission on its *directory*, not on the file. So a file can be made unreadable and still be destroyed.
- The sticky bit does **not** fix that: it permits the directory's owner, and the directory's owner is the agent.
- With the **parent directory owned by root** as well, deletion is refused too. That is the complete form — and its price is that the agent can no longer create anything in that directory either.

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
The parsed policy being edited, and the difference a pending install would make.

### tests — How will we know it works? What should we test?
- A path the policy protects **cannot be read by the agent** — checked by trying, from inside, as the agent, and failing.
- The agent **cannot undo it**: `chmod` and `chown` on a protected path are both refused.
- Where the policy asks for it, the agent **cannot delete it either** — and where that was not possible without taking the directory, the page said so rather than implying otherwise.
- The policy script runs **before** anything is handed to an agent, never after.
- A rule that only the agent can honour is labelled as such, and is never described as enforced.
- With the sandbox off, every rule reports as asked-only — because that is all any of them can be.
- A policy saved to a repository and installed into a second Solution produces the same rules.
- Installing a file shows what it would change before it is applied, and applies nothing until it is.
- A malformed policy file is refused with the line that is wrong, and leaves the existing policy alone.
- A run records the policy it used, and still reports it after the file has moved on.
- A rule naming a path outside the repository is refused rather than silently ignored.
- A GitHub source given as a branch is refused, or pinned to the commit it resolves to — never left as a moving target.
- The script is shown in full before it can be run, and running is a separate press from fetching.
- A run records where its policy came from and at which commit, and still reports it afterwards.

### limits — Any known limits or things to watch out for?
- **With the sandbox off, none of this is enforceable and the page must say so.** There is no separate user then: the agent runs as the person using the machine, with their permissions, and nothing can be kept from it. Every rule reports as asked-only, because that is all any of them can be.
- **Unreadable is available anywhere; undeletable costs the directory.** Making a single file unreadable works wherever it sits. Making it undeletable requires its parent to be root-owned, and then the agent cannot create anything in that directory either — so protecting one file at the root of a working copy is a trade, not a free win.
- **A policy script runs as root inside the boundary, which means it can weaken the boundary as easily as strengthen it.** A GitHub source makes that remote code running as root, which is the same pattern this app deliberately avoided when installing Node — the difference being that this one is chosen on purpose, for a script whose job is to restrict, and it is worth having only with all four of these:
  - **Fetched on this machine, not by the sandbox**, so it can be read before it is used rather than pulled by the thing it is meant to bind.
  - **Shown whole before it runs**, the way the language starters already are.
  - **Pinned to a commit, never a branch.** A branch is a script that can change after somebody approved it.
  - **Recorded with the run** — which policy, from where, at which commit — so a run's record still says what restricted it.
- **A file on this machine is the safer default; a GitHub location is what makes a policy shareable.** Both are offered, and which one is in use is said plainly.
- A file the agent cannot read is one the **build** cannot read either, if it runs as the agent. Restricting something the project needs will present as a broken build rather than as a policy.
- Some things cannot be kept from an agent that can run commands at all — anything it can reach over the network, anything the build pulls in. The policy must not imply otherwise.
- Secrets are what people will reach for first, and the honest answer is that a repository is the wrong place for one. Hiding `.env` from an agent is worth having and is not a substitute.
- The two promises must never be blurred, in the panel or in this document.

### model-and-effort — Which AI model and effort level should this page use by default?
Most capable model, high effort — it makes claims about what an agent cannot do.

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
- Round 1 (my feedback): Policy files that can be saved, shared and installed, to limit what an agent can reach and which files it cannot access. *(Raised while asking for the sandbox panel to be friendlier, and kept separate from it because this one makes a claim about enforcement rather than about layout. The condition carried over from the sandbox: every rule has to say which of the two promises it keeps, because a rule the agent merely honours stops meaning anything the moment an agent is run unattended — which is the setting this whole area exists to make defensible.)*
- Round 3 (my feedback): **A GitHub location or a file, plus the command that installs from it — set inside the "Where agents run" card, not on a page of its own.** *(The source and the boundary belong together: a policy means nothing without a sandbox, and a panel beside it would invite reading the policy as protection in its own right. The GitHub half is remote code run as root inside the boundary, which is the pattern this app deliberately avoided when installing Node; it is worth having here because it is chosen on purpose for a script whose job is to restrict, and only with all four safeguards — fetched on this machine so it can be read first, shown whole before it runs, pinned to a commit rather than a branch, and recorded with the run. A file on this machine stays the safer default; GitHub is what makes a policy shareable across a team.)*
- Round 2 (my feedback): **The mechanism is a script that runs before the agent spins up, restricting it with permissions.** *(This replaced a first draft that would have enforced path rules by mounting less of the repository. The script is the better answer: it runs inside the boundary as root while the agent runs as an ordinary user that cannot become root, so what it sets the agent cannot undo — and it leaves the mount, the simplest and best-proved part of the sandbox, alone. Checked on a real distribution rather than assumed: the agent cannot read a root-owned unreadable file, and cannot chmod or chown it back — but it **can delete** it, because removing a file depends on write permission on the directory rather than on the file, and the sticky bit does not help since it permits the directory's owner. Undeletable needs the parent owned by root too, which costs the agent the ability to create anything in that directory. Both facts belong on the page rather than in somebody's head. The thing this buys, and it is the point: with a sandbox on, these are permissions the operating system enforces, not requests an agent can be told to ignore.)*
