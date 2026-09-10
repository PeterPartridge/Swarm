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

**And it exists to keep two very different promises apart.** "The agent has been asked not to read this" and "this was never put where the agent could reach it" are both called access control, and only one of them survives an agent that has been told not to ask. A policy that emitted only the first would be a padlock drawn on a door — the exact thing this app's sandbox was built to stop being.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: anyone using the app) can: write a policy for a Solution — the folders and files an agent must not reach, and the commands it must not run.
- Someone (who: anyone using the app) can: see, per rule, **which promise it is** — kept out of the agent's reach entirely, or asked of the agent and dependent on it obeying.
- Someone (who: anyone using the app) can: save a policy as a file in the Solution's repository, so it travels with the code and a colleague gets the same one.
- Someone (who: anyone using the app) can: install a policy file somebody else wrote — from another Solution, or one they were sent — and see what it would change before it takes effect.
- Someone (who: anyone using the app) can: start a run and see, on the run, which policy was in force for it.
- Someone (who: anyone using the app) can: be told plainly when a rule cannot be enforced here — because the sandbox is off, or because the rule is one only the agent can honour.

### look — What should it look like?
A card in the Admin environment beside the sandbox panel, in the same shape: the state first, the detail underneath. A list of rules, each showing what it covers and **how it is kept** — two plainly different words, never one icon. Where a rule is only asked of the agent, it says so on the rule, not in a footnote. Buttons to save the policy to the repository and to install one from a file, with what-would-change shown before anything is applied.

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

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
The parsed policy being edited, and the difference a pending install would make.

### tests — How will we know it works? What should we test?
- A path rule that the sandbox can enforce results in that path **not being mounted** — checked by trying to read it from inside and failing.
- A rule that only the agent can honour is labelled as such, and is never described as enforced.
- With the sandbox off, every rule reports as asked-only — because that is all any of them can be.
- A policy saved to a repository and installed into a second Solution produces the same rules.
- Installing a file shows what it would change before it is applied, and applies nothing until it is.
- A malformed policy file is refused with the line that is wrong, and leaves the existing policy alone.
- A run records the policy it used, and still reports it after the file has moved on.
- A rule naming a path outside the repository is refused rather than silently ignored.

### limits — Any known limits or things to watch out for?
- **The two promises must never be blurred**, in the panel or in this document. Not-mounted is enforced by the kernel; asked-of-the-agent is a request the agent can be told to disregard, and is worth nothing under "never ask".
- A file that is never mounted is invisible to the *build* as well as to the agent. Excluding something the project needs to compile will break the run, and the failure will look like a broken build rather than a policy.
- The sandbox mounts a repository whole today. Enforcing a path rule means mounting less than that, which is a real change to how a run is prepared and is where the work in this actually is.
- Some things cannot be kept from an agent that can run commands at all — anything it can reach through the network, and anything the build itself pulls in. The policy should not imply otherwise.
- Secrets are the case people will reach for first, and the honest answer is that the right place for a secret is not in the repository. A policy that hides `.env` from an agent is worth having and is not a substitute for that.

### model-and-effort — Which AI model and effort level should this page use by default?
Most capable model, high effort — it makes claims about what an agent cannot do.

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
- Round 1 (my feedback): Policy files that can be saved, shared and installed, to limit what an agent can reach and which files it cannot access. *(Raised while asking for the sandbox panel to be friendlier, and kept separate from it because this one makes a claim about enforcement rather than about layout. The condition carried over from the sandbox: every rule has to say which of the two promises it keeps, because a rule the agent merely honours stops meaning anything the moment an agent is run unattended — which is the setting this whole area exists to make defensible.)*
