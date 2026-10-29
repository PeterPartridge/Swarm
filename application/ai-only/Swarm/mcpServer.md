---
spec: page
from: Swarm/mcpServer.md
deliverable:
depends-on: ["adminArea.md", "workItemPolicy.md", "productPlanning.md", "agentSandbox.md"]
---
objective: let an AI working elsewhere — Claude Code in a terminal, another editor, a colleague's agent — read this workspace's plan and work to it, instead of being told second-hand [why-exists]
objective: the source of truth is offered outward on purpose and under control, and here somebody can see and revoke what has been offered [why-exists]
model: none — the page makes no AI calls; the AI is on the other end of the server [model-and-effort]
action: Admin turns the server on and off; it is off until switched on, not on because the app runs [actions]
action: Admin sees the exact configuration another tool needs, to copy, told plainly that copying it hands that tool this access [actions]
action: Admin chooses what is offered — which Products, and whether anything may be written; reading and writing are separate switches [actions]
action: Admin sees what has connected and what it asked for, with refusals [actions]
action: Admin revokes — turns it off or rotates the token — and every connected client stops working at once [actions]
look: in Admin beside "Where agents run", in the same shape — the state first, the detail underneath [look]
look: the state line says in words, not a badge, which is true — off, reading only, or reading and writing [look]
look: the connection details sit under it, collapsed until asked for, because they hold a token [look]
look: the call log is a plain list — when, which tool, which Product, and "answered" or the refusal; refusals are not styled as errors [look]
info: whether the server runs and on which port; the token, hidden until revealed; which Products are offered; whether writing is allowed; the recent calls [information]
access: Admin only, like the rest of Admin; the page repeats that roles gate visibility, not access — this is a setting on the machine, not a permission given to a person [who-can-use]
store: system setting mcpServer — enabled, port, allowWrite, productIds, tokenAlias; off, no write and no Products by default [data-stored]
store: the token never goes in the database — it goes to the OS credential store and the setting holds its alias [data-stored]
store: a call log of a bounded number of recent entries — time, tool name, Product touched, outcome; no arguments and no returned content [data-stored]
store: the running server handle and the recent call log, in memory only — closing the app forgets the log, on purpose [in-memory]
UNKNOWN: is the call log kept in the database or only in memory? The answers say both [data-stored, in-memory]
must: HTTP on loopback, not stdio — the server is the open app holding a locked database, so it cannot be spawned; it listens on 127.0.0.1 and refuses any request not from loopback [how-it-works]
must: every request carries a bearer token, made when the server is first switched on, kept in the OS credential store, and checkable without a database read [how-it-works]
op: list_products — the Products offered, and nothing about the others [how-it-works]
op: list_work_items — work items of an offered Product, with state, kind and what the AI may do with each [how-it-works]
op: get_work_item — one item in full, with its policy [how-it-works]
op: read_brief — one page brief as it stands in the repository [how-it-works]
op: list_solutions — Solutions and where their code lives [how-it-works]
op: report_progress — write; records that outside work happened against an item, a note and not a state change [how-it-works]
must: every tool resolves the work item's own AI policy first; an item whose policy does not allow reading is neither returned nor listed as withheld [how-it-works]
must: report_progress cannot change state, approve a plan or start a run [how-it-works]
must: the server stops when the app does, when the setting is switched off and when the token is rotated; there is no daemon [how-it-works]
check: C1 a request with no token and one with a wrong token are refused the same way, without saying which [tests]
check: C2 a request from a non-loopback address is refused even with the right token [tests]
check: C3 a work item whose policy forbids reading is absent from list_work_items [tests]
check: C4 a Product not offered is absent from list_products, and naming its id in another tool is refused [tests]
check: C5 with allowWrite off, report_progress is refused and nothing is written [tests]
check: C6 report_progress cannot change a work item's state, approve a plan or start a run — asserted against the database [tests]
check: C7 switching the server off stops it answering, proved by a call that then fails [tests]
check: C8 rotating the token makes the previous one fail [tests]
check: C9 the call log holds no arguments and no returned content [tests]
check: C10 with the server off — the default — nothing listens on the port [tests]
limit: a loopback token is not a boundary against the person at the machine; it stops other software stumbling in, and the page does not imply more [limits]
limit: one token for the machine, not per person, said plainly [limits]
limit: an outside agent reading the plan is not one following it; connecting an agent does not constrain it [limits]
limit: rmcp is the dependency this uses; if this is not built it is removed rather than left as a marker [limits]
UNKNOWN: the limits say rmcp is already a dependency; has it since been removed? [limits]
limit: a port already in use is a refusal that names the port, not a silent fallback [limits]
skill: Model Context Protocol servers over HTTP — the page serves the plan to outside agents [how-it-works]
> The brief's Part 4 change rounds have no question ID to cite, so what they
> add beyond the answers above is not translated here. Read them in the brief.

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — MCP Server

> Produced by `/translate` from [`../../Swarm/mcpServer.md`](../../Swarm/mcpServer.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

---

## Page objective

Offer this workspace's plan — Products, work items, briefs, Solutions — to an AI working outside the app, over a local MCP server that is **off until switched on**, refuses by the same per-work-item policy the app already enforces, and can be revoked.

The premise the app is built on is that AI works from a shared source of truth. That currently holds only inside the app: a developer who opens Claude Code in the same repository has an AI that knows nothing about the agreed plan, and therefore does the thing this framework exists to prevent. This closes that gap without turning the source of truth into something that hands itself to anything that asks.

## Model & effort

**None.** This page makes no AI calls. It is a server; the AI is the client.

## Depends on

| Brief | Why it must exist first |
|---|---|
| `adminArea.md` | This is a panel in Admin, and inherits its shape and its "roles are visibility only" statement. |
| `workItemPolicy.md` | The deny-by-default per-item policy is the gate every tool resolves before answering. Without it there is nothing to refuse by. |
| `productPlanning.md` | Work items are what is being offered. |
| `agentSandbox.md` | Not a dependency of code but of **wording**: the two-promises rule (enforced vs asked) and "never claim a protection that has not been proved" bind here, and this page must not describe a loopback token as access control. |

## Actions

| Who | Action |
|---|---|
| Admin | Switch the server on and off. Off on a fresh install and after an update. |
| Admin | Reveal the connection details, with the token hidden until asked for, and be told that copying them hands that tool this access. |
| Admin | Choose which Products are offered. None by default. |
| Admin | Allow or forbid writing, as a switch separate from reading. |
| Admin | See recent calls — what was asked, which Product, answered or refused. |
| Admin | Rotate the token, or switch off, and have every connected client stop working at once. |

## Information shown / collected

Whether it is running and on which port; which Products are offered; whether writing is allowed; the token, concealed until revealed; and a bounded list of recent calls.

**Three states, in words, never a badge:** off / reading only / reading and writing.

## Data to store

| Where | What |
|---|---|
| `mcpServer` system setting | `{ enabled: false, port, allowWrite: false, productIds: [], tokenAlias }` — a fresh install offers nothing. |
| OS credential store | The bearer token, under `tokenAlias`. **Never in the database**, like every other key in this app. |
| In memory only | The running server handle and the recent call log. Not written to disk: an audit trail that survives is a retention promise the app would then have to keep. |

The call log holds time, tool name, Product, and outcome — **no arguments and no returned content**, because a log that accumulates the contents of briefs is a second copy of the thing being protected.

## Access & security

- **Loopback only.** Listens on `127.0.0.1`; a request from any other origin is refused even with a correct token.
- **Bearer token on every request.** Checkable without a database read, so an unauthorised request is cheap. A missing token and a wrong token are refused **identically** — the refusal must not say which.
- **Deny by default, by the app's own policy.** Every tool resolves the work item's AI policy before answering. An item that may not be read is **absent**, never listed-and-marked: a list saying "three items you may not see" leaks what it refuses.
- **A Product not offered does not exist** to this server, including when its id is named directly.
- **Writing is one weak tool.** `report_progress` appends a note. It cannot change state, approve a plan, or start a run — those are the app's own gates, and an outside agent is precisely who they exist for.
- **Said plainly, not dressed up:** a loopback token stops other software on the machine stumbling in. It does not stop the person at the machine, who can read the credential store. The app has no logins, so this is one token for the machine and cannot be per-person.

### Nothing here writes code — and the thing that is still true after that

**No tool writes a file, touches a working copy, runs a command, or touches git.** Five tools read; the sixth appends a note to a row in the local database. Nothing here commits, branches, pushes, opens a pull request, or authenticates to GitHub at all — the GitHub token in the credential store is not reachable from any tool on this list.

The app *does* write to the repository, through the run flow: worktrees, branches, pull requests. **`report_progress` cannot start a run**, which is stated as a rule above and asserted against the database in the tests — so the one path that reaches git stays behind the app's own gates, where a person presses Start and approves a plan. An outside agent is exactly who those gates exist for, which is why the write tool was made this weak rather than merely policed.

There is no generic escape hatch to grow one by accident: the tool list is fixed and every entry is enumerated here.

Two consequences that follow anyway, and must be on the page rather than found out:

- **`list_solutions` hands over the map.** It returns where each Solution's code lives on this machine, which is the point — an outside agent has to find the repository the plan refers to. But a client like Claude Code has its own filesystem access, so what this server discloses is exactly what such a client needs in order to write there **by its own hands**. This server will not write your code back; it can tell something else where your code is. Those are different sentences and the panel must say the second one too. *(Which is why Product scope exists: a Product not offered discloses no paths.)*
- **A progress note is untrusted text that the app's own AI may later read.** If notes are ever folded into a prompt pack, an outside agent could write instructions into one and have this app's AI treat them as input. The note is **data, never instruction**, wherever it is rendered — and anything that packs it for a model must carry that assumption rather than inherit it.

## Tests

- [ ] No token is refused; a wrong token is refused **in the same words**.
- [ ] A non-loopback origin is refused even with a correct token.
- [ ] An item whose policy forbids reading is absent from `list_work_items` — asserted on the response body, not on a flag.
- [ ] A Product that was not offered is absent from `list_products`, and naming its id in another tool is refused.
- [ ] With `allowWrite` off, `report_progress` is refused **and the database is unchanged** — checked in the database, not in the response.
- [ ] `report_progress` cannot change state, approve a plan, or start a run, asserted against the database after the call.
- [ ] Switching off stops it answering, proved by a call that then fails rather than by reading the setting.
- [ ] Rotating the token makes the previous one fail.
- [ ] The call log contains no arguments and no returned content.
- [ ] With the server off — the default — nothing is listening on the port.
- [ ] A port already in use is refused **naming the port**, never a silent fallback to another.
- [ ] **No tool reaches git.** After exercising every tool, the repository is unchanged: no commit, no branch, no new file in any working copy, and nothing staged — asserted with git itself, not by reading the tool list.
- [ ] The GitHub token in the credential store is never read by any tool on this server.

## Open Questions

- **Does the token survive a restart, or is it new each time?** Surviving is friendlier — a client configured once keeps working. New each time is safer and makes "rotate" the default rather than a button. The brief does not say. *(Leaning: survives, because a token that changes on every launch makes the feature useless and pushes people to leave the server on permanently, which is worse.)*
- **What happens to an offered Product that is later deleted?** Its id would linger in `productIds`. Cleaning up on read is simple; cleaning up on delete is correct. Not settled.
- **`rmcp` is already a dependency and currently unused.** This is the first thing to use it. If this page is not built, that dependency should be **removed** rather than left as a marker of intent.

## Page Skills

| Skill | Why it's needed | How you'll use it | New for this page? |
|---|---|---|---|
| Serving MCP over loopback HTTP | The conventional stdio shape cannot work here: the data lives in a turso database the running app already holds, so a spawned child process would either fail to open it or fight the app for it. | `rmcp`'s server half behind a loopback listener owned by the app's lifetime, started and stopped by a setting rather than by a client. | Yes. |
| Refusing without disclosing | Every refusal here is a chance to leak the shape of what is hidden — a marked-as-withheld item, a distinguishable wrong-token message, a count of things not shown. | Absent rather than marked; one refusal wording for missing and wrong tokens; no counts of withheld items. | Yes. |
| Reusing the per-item AI gate | The policy that governs AI calls inside the app is the same question an outside agent is asking, and a second implementation would be a second thing to drift. | Resolve through the existing work-item policy path rather than re-reading the rules here. | Extends `workItemPolicy`. |
| Saying what a local token is not | The project's standing rule: never claim a protection that has not been proved. A loopback bearer token is real against other software and worthless against the machine's user. | The panel says both halves, in the same two-plainly-different-words style the sandbox table uses. | Extends `agentSandbox`. |

---

## PLAN

**Summary:** A loopback MCP server, off by default, exposing read tools for Products, work items, briefs and Solutions — gated by the same deny-by-default per-item policy the app already enforces — plus one deliberately weak write tool that records a progress note and can do nothing else. Switched on, scoped, revoked and audited from a panel in Admin beside "Where agents run".

**Changes:**
- `db::system_setting`: an `mcpServer` setting, defaulting to off with no Products and no write.
- The token to the OS credential store via the existing `keys` path; only its alias in the database.
- `mcp/` module: the server, its tool definitions, and a **pure** half that turns a request plus the policy into either an answer or a refusal — testable with no listener and no database.
- Tool handlers resolving through the existing work-item policy gate rather than a second copy of it.
- `commands::mcp`: start, stop, rotate, read the setting, read the call log.
- Admin: the panel — state in words, connection details collapsed behind a reveal, Product scope, the write switch, the call list, and the two sentences about what a loopback token is and is not.
- Tests: the eleven above, with every refusal asserted on the response body or the database rather than on the flag meant to cause it.

**Expected technical debt:**
- One token for the machine, because the app has no logins. If per-person access is ever wanted, this is not the shape that grows into it.
- The call log dies with the app. Anyone wanting a durable audit trail needs a different design and a retention answer.
- An outside agent reading the plan is not an outside agent following it. Nothing here constrains the client, and the panel must not imply otherwise.
- Loopback ports are a shared resource; two copies of this app cannot both serve on the same port, and the second is refused rather than moved.
