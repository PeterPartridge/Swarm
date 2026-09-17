---
form: project-brief
project: "Cooperative AI Coding"
status: filled            # blank | filled | approved
---

# Project Brief — CooperativeAI Solution

> **Who fills this in:** the people who own the idea (Product) and the people who will build it (Developers), together.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance for you — anything else you write under a heading is your answer. Write like you're explaining it to a new colleague; no technical wording needed. Leave a question unanswered if you genuinely don't know yet, but try. When you're done, set `status: filled` at the top.
>
> Then the brief gets handed to Claude using the bridge in [`claude-only/1-translate-to-claude.md`](claude-only/1-translate-to-claude.md), which turns your answers into instructions the AI can follow.
>
> **How the folders are laid out:** this project brief lives at the root. Each **solution** gets its own folder, with a spec file at its root that defines the solution's technology, plus one file per page/endpoint/model. See [`example/`](example/) for a worked Clothing project. Every solution folder's spec is a copy of the same [`_forms/application-spec.json`](_forms/application-spec.json) — set its `solutionType` to `website`, `api`, `database`, or `application`:
> - **Website / front-end** → `application-spec.json` (`solutionType: website`) + pages from [`_forms/page.md`](_forms/page.md) (e.g. `ClothingWebsite/userLogin.md`)
> - **API** → `application-spec.json` (`solutionType: api`) + resources from [`_forms/endpoint.json`](_forms/endpoint.json) (e.g. `ClothingAPI/Login.json`)
> - **Database** → `application-spec.json` (`solutionType: database`) + tables from [`_forms/database-model.json`](_forms/database-model.json) (e.g. `ClothingDatabase/UserCredentials.json`)
> - **Standalone application (CLI/TUI/desktop)** → `application-spec.json` (`solutionType: application`) + screens from `page.md` (e.g. `CoperativeAI/mainScreen.md`)

---

## Part 1 — The Idea *(Product answers this)*

### purpose — In one or two sentences, what is the purpose of this software?
A Product / Development / QA workspace: a desktop app where teams plan products, build developments, and design QA tests cooperatively with AI, using the Cooperative AI coding framework — with very little effort and cost.

### problem — What problem does it solve, and for whom?
At the moment not many tools give developers and Product a unified platform to work. With AI there are tools for single repos, but not for multiple repos to work easily. This is to allow Product, Developers, and QA to work with AI to build end to end solutions using their expertise along with the power of AI. The workflow runs: Product plans products (work items, drag-and-drop feature design, specifications that generate API endpoints, front-end changes, and database designs) → Developers build them (code editor, real terminal, multi-repository support, AI via API keys, with per-work-item control of how AI may use each item) → QA designs tests around work items that AI can implement.

### users — Who will use this software?
Developers, QA, Product Manager, Designers — as a single local user on their own machine; there are no logins or user accounts. The main window has a top menu with four tabs — **Product**, **Develop**, **Test**, **Admin** — each with its own colour; clicking a tab enters that environment. Team members are named in Admin and given a role; a "Working as…" picker in the header sets who you are currently acting as, which decides the tabs and the cost/profit fields you see.

### deliverables — What are we working towards, in order? Name the first one.
> A **deliverable** is a stopping point worth evaluating direction at — not a
> release date and not a list of features. The first is usually the **MVP**: the
> smallest version that is genuinely worth putting in front of someone.
>
> Everything the AI builds is building towards the deliverable the item names,
> and when the last item for a deliverable is built the work **stops there** so
> people can look at it before the next one starts. That pause is the point of
> naming these at all.

- Deliverable: **MVP — the cooperative loop, end to end** — done when: a work item can go from planned by Product, to planned and approved by Develop, to built by an agent in a bounded workspace, to reviewed and merged, to covered by a QA test case, without leaving the app.
- Deliverable: **Agent governance** — done when: what an agent may read, edit and reach is decided per work item and enforced rather than requested — deny-by-default policy, the sandbox boundary, per-file agent policy, and the MCP server as the enforcement layer rather than a prompt.
- Deliverable: **Feature Designer** — done when: Product can lay a feature out on the drag-and-drop canvas named in this brief's purpose, and the design it produces is what generates the work items.

> drafted · guessed · from README.md, AGENTS.md, and the 33 item briefs already `built` under application/CoperativeAI/. **The names and the split are inferred; the ordering is inferred.** Nothing in the repository states a deliverable anywhere, so this is the AI reading what has been built and guessing at the stopping points it was building towards. Delete this line to accept an answer; rewrite the bullets if the guess is wrong. Until a person accepts these, `/build` step 5 has nothing trustworthy to stop at.

### apps-you-like — Are there any apps or websites you like?
VS Code, Claude Code, Cursor, Jira 

### apps-to-avoid — Are there any apps or websites you want to avoid copying?


---

## Part 2 — How Should We Build the Solution(s) *(Developers answer this)*

Rust application that runs from an executable.

### platforms — What platforms would this development need to run on?
Windows and Linux

### repo-structure — Is this a single repo or multi purpose repo?
single 

### solutions — List each solution and where its code lives.
- Name: CoperativeAI — type: Rust Application — repo: https://github.com/PeterPartridge/CooperativeAICoding  — local path: app/CoperativeAI (relative to this repo's root)
- Name: CoperativeAIdb — type: turso database embeded in the rust application — repo: https://github.com/PeterPartridge/CooperativeAICoding  — local path: app/CoperativeAI/db (relative to this repo's root)

### dev-rules — Software development rules for the codebase.
- Build this using DRY (Do not repeat yourself) — if you are repeating code three times, move it into a shared method or module and reuse it instead.
- Use the SOLID principles, creating code with single responsibility with Objects, and use dependency injection and interfaces where practical. Plan for code changes on production code to be small or the code will be extended by a new version file.
- Keep the code simple and only do enough code to finish the job.
- Always create a test that fails then write just enough code to get a passed test. The tests should start simple and get more complex as we add more functionality. 

### testing — What has to be true before a change counts as tested?
> **A rule the AI applies to every change, not a list of tests.** Two halves:
> the level of cover you expect, and what is **not** worth testing here.
>
> That way round on purpose. A list of things to test reads to an AI as
> permission to skip everything not on the list — name a threshold and the
> exceptions instead, and everything else is included by default.

New and changed code needs a test that fails first, for the reason the change exists. **Anything that decides something — a branch, a guard, a permission check, a gate, a policy refusal — has a test naming the decision**, and that is the floor: a decision without a test naming it is not done, regardless of line count.

These gates must pass, run from `app/CoperativeAI` and its `src-tauri` manifest: `cargo clippy --all-targets -- -D warnings` (warnings are failures), `cargo test`, `tsc --noEmit`, `npm test`.

Not worth testing here: generated files, plain data holders, framework glue, and anything whose only assertion would be that a library works. **Live-integration paths** — a real debugger, a running Ollama, a WSL distribution, a Docker engine, anything that spends money or changes this machine — are marked `#[ignore]` and run by a person, not by CI; a change that relies on one says so in its debt note.

A change that cannot reach this floor says so in its debt note rather than lowering it.

> drafted · confident · from AGENTS.md (the four gates, verbatim), the `dev-rules` answer above (TDD), and the 35 `#[ignore]`d live-only Rust tests already on disk. **The threshold is the inferred half** — the gates and the TDD rule were already written down; "a test naming the decision" and the exceptions list are the AI's reading of how this repository already behaves, not a rule anyone stated. Delete this line to accept.

### roles — List the roles or claims used across the application.
Roles exist, but they are **not a security boundary** — the app still has no logins or accounts, and anyone can change who they are working as. They organise the workspace; they do not protect it.

Seeded roles, editable in the Admin area: **Admin** (everything; cannot be deleted or weakened), **Product**, **Developer**, **QA**. Each role carries area flags (canProduct / canDevelop / canTest / canAdmin) deciding which tabs are shown, and field flags (seeCost / seeProfit / seeChargeable) deciding whether a work item's commercial fields are visible. With no active team member selected, everything is visible — you cannot lock yourself out of your own machine.


### hosting — What technology will host these solutions?
Windows and Linux machines — we need to code for low memory usage and performance on low-spec machines.

### database-technology — What database technology will the solution(s) use?
turso https://github.com/tursodatabase/turso

### environments — What environments will this project have, and which may the AI deploy to?
AI can deploy production and development. I want a debug build on the development version and performance on the production one.

### infrastructure-policy — Who creates infrastructure, and with what tool? Where do secrets live?
N/A

---

## Part 3 — Look & Feel *(Product answers this)*

### designs — Do you have any designs, sketches, screenshots, or examples?
I want this to be minimal and easy to use with a terminal to run commands and interact with files, but we also want a drag-and-drop system to allow users to move code blocks or UI designs around. We should have customisable colours. The main window has a top menu with four tabs — Product, Develop, Test, Admin — each tab with its own colour so you always know which environment you are in; clicking a tab enters that environment.

---

## Part 4 — When to Use Each AI Model *(Product + Developers)*



### cheapest-model — When should we use the cheapest, fastest model?
- Use Claude Sonnet 5 for small, well-defined tasks such as minor code edits, small UI tweaks, adding simple functions, or updating statements like if or switch.

### mid-range-model — When should we use the mid-range model?
- Use Claude Sonnet 5 for everyday feature work that involves medium-sized code or UI changes, reading brief design notes, and creating new files or tests.

### most-capable-model — When should we use the most capable (and most expensive) model?
- Use Claude Fable 5 for complex UI or coding work, unfamiliar systems, architecture decisions, or tasks that require interpreting design files and building the overall structure of the code.

### effort-levels — What effort level should the model use for different kinds of work?
- Low: small, well-defined edits and straightforward fixes.
- Medium: everyday feature work and moderate refactors.
- High: architecture changes, cross-file refactors, and complex implementation work.

---

## Part 5 — Anything Else

### anything-else — Is there anything important we haven't asked about?
This tool will also be used to design its own features as it matures: work items and feature designs made inside the app generate CooperativeAICoding briefs/specs (the same files under `application/`), which are then built through the framework's own loop. The Creation Page and the spec-generation roadmap item are the start of this self-hosting.

---

### The promises this project makes (no need to edit — just so everyone's agreed)

- The AI builds the **smallest thing** that answers the request — no surprise extras.
- We treat anything already built as **working in production**, and avoid breaking it.
- If the AI can't finish something, it **says so and writes it down** instead of endlessly retrying.
- Every change is **reviewed by a person** before it goes live.
