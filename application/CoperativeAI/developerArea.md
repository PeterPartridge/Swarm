---
form: page-brief
page: "Developer Area"
solution: "CoperativeAI"
depends-on: ["workspaceShell.md", "CoperativeAIdb/TeamMember-model.json"]
status: built            # blank | filled | approved | built
---

# Page Brief — Developer Area

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So the team is set up in one place: the Develop tab's Developer Area holds the team members (name + role) that Planning assigns work to. The app has no logins — these are names, not accounts.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: a developer) can: add a team member with a name and a role (Developer / QA / Product / Designer).
- Someone (who: a developer) can: see the team list.
- Someone (who: a developer) can: remove a team member — their assigned work items simply become unassigned.

### look — What should it look like?
A simple team list card in the Develop environment: one row per member with name and role, an add form above it. Develop tab colour as accent.

### information — What information does this page show or collect?
- Team member names and roles. Nothing else — no contact details, no credentials.

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
Team members — see [`CoperativeAIdb/TeamMember-model.json`](../CoperativeAIdb/TeamMember-model.json).

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
The add form's unsaved input.

### tests — How will we know it works? What should we test?
- Adding a member with a name and role shows them in the list and survives a restart.
- Duplicate names are rejected.
- Removing a member clears them from any work items they were assigned to, without deleting the items.

### limits — Any known limits or things to watch out for?
No.

### model-and-effort — Which AI model and effort level should this page use by default?
Cheapest model, low effort.

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
- Round 11 (my feedback): The file explorer needs a **tab to select multiple Solutions attached to a Product**, so several can be open at once. *(Applied: a tab per open Solution with a picker for the others attached to the selected Product. Each keeps its own tree, folds, open files and unsaved edits, so switching away and back finds it as it was left. The editor is keyed by Solution **and** path, since two Solutions can each hold a `src/main.rs`.)*
- Round 10 (my feedback): Add a **Code** tab showing a code editor in the middle with a **file explorer to the left**, opened by clicking **Open** on a Solution in the Workspace tab. *(Applied: a new CodeEditor component with the explorer left and the editor centre; the Workspace tab's Open button hands the Solution to it. The tree and editor were **moved out of** SolutionBox rather than duplicated — SolutionBox keeps the working-copy path, Open, and the change review, so there is one editor in one place.)*
- Round 9 (my feedback): Separate the Develop area's sections into **tabs**. *(Applied: the ten stacked sections became four tabs grouped by what a developer is doing — **Planning** (technical strategy, developer rules, cross-repo map, architecture), **Work** (board/sprint/list views), **Workspace** (solutions, editor, coding pal, change review, framework files), **Settings** (GitHub, model installs, AI settings). The Product picker stays above the tabs. Plain buttons, not `role="tab"`, because the Work section already owns a Board/Sprint/List tablist.)*
- Round 8c (my feedback): Build the pieces round 8b deferred, as decided: the **full code editor and AI coding pal** (not the minimal option), and **accept always available** on change review — never gated on findings. *(Applied: Monaco editor with save into the working copy; the pal explains/refactors/documents/drafts tests through the same policy, budget and ledger gates as everything else and never writes files itself; Keep/Discard is offered whatever the review found, with the findings recorded on the run first so accepting over a violation is on the record.)*
- Round 8b (my feedback): Rebuild the **Developer Workspace**: open a Solution (file tree, architecture, active components), a real **code editor**, **Claude Code orchestration** with a **change review** of what comes back — checked against the Developer Rules, with per-file accept or reject and the spend for that run — an in-editor **AI coding pal**, and a **cross-repo view**. *(Built this round: opening a Solution, and the change review. Deliberately not built: the editor, which rebuilds part of a tool you already have and is not where this platform's value is; and orchestration, because Claude Code is billed outside this app's ledger so "the spend for that run" is a number the app cannot see. Both are written up in [`../claude-only/CoperativeAI/developerWorkspace.md`](../claude-only/CoperativeAI/developerWorkspace.md).)*
- Round 8 (my feedback): Develop gains a **Developer Planning** sub-area holding Tech Strategy, the Developer Rules (**read-only here — they are edited in Admin**), and Solution Planning: **architecture documents** (system interaction, component map, API contract, event flow, infrastructure), **API contracts** per Solution, and **cross-repo links** between Solutions so a change can be traced to everything it reaches. Every generated diagram must be **validated as parseable before it is stored**.
- Round 2 (my feedback): Move team-member management to the new Admin area (users are assigned roles there). The Develop area keeps solution creation and AI settings, and will gain a Technical Strategy section and Board/Sprint/List views in a later round.
- Round 3 (my feedback): The Develop area needs a **Technical Strategy** section — required infrastructure, architecture requirements, solution creation guidelines, and dependencies / environment prerequisites. It must also offer **Board**, **Sprint**, and **List** views of the work, with **filtering by assigned user**. Pick a Product at the top of the Develop area to work against it.
- Round 6 (my feedback): For every scoped work item the AI must give **two recommendations** — a **fastest** option (most capable model, higher cost, shortest delivery) and a **most cost-efficient** option (cheaper model, longer) — each showing estimated token usage, estimated cost and estimated completion time, and respecting the Product AI budget, token spend limits, the developer rules and the handover logic.
- Round 5 (my feedback): Developers define **Developer Rules** — coding standards, architecture principles, maintainability rules, preferred frameworks, allowed/disallowed technologies, and constraints on AI behaviour — and the AI must follow them when generating code, architecture, plans or recommendations. For each work item the AI builds an **AI-Driven Development Strategy**: a solution strategy describing how to build it, **architecture options** (Windows Service, Azure Web App, Azure Function, API, background worker, or other), and the tech stack that follows from the rules.
- Round 4 (my feedback): The Develop area needs a **GitHub connection** so a Solution can be linked to a GitHub repository, or a new repository created from the app as **private or public**. See [`solutionCreation.md`](solutionCreation.md) round 2 for the Solution side.
