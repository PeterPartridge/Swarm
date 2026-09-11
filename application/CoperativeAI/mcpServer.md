---
form: page-brief
page: "MCP Server"
solution: "CoperativeAI"
depends-on: ["adminArea.md", "workItemPolicy.md", "productPlanning.md", "agentSandbox.md"]
status: filled            # blank | filled | approved | built
---

# Page Brief — MCP Server

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
> The one main job of this page. This shouldn't change much over time.

So an AI working somewhere else — Claude Code in a terminal, another editor, a colleague's agent — can read this workspace's plan and work to it, instead of being told about it second-hand by somebody pasting fragments into a chat.

The whole premise of this app is that AI is part of the team and works from a shared source of truth. Today that only holds *inside* the app. The moment a developer opens Claude Code in the same repository, the AI there knows nothing about the work items, the briefs, or the rules the team agreed — so it does exactly what this framework exists to prevent: it guesses, adds what nobody asked for, and rebuilds what already works.

This page is where that source of truth is offered outward, on purpose and under control, and where somebody can see and revoke what has been offered.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
> List the actions, with who does them.

- **Admin: turn the server on and off.** Off until somebody switches it on. It is not on because the app is running.
- **Admin: see how to connect.** The exact configuration another tool needs, shown so it can be copied — and said plainly that copying it hands that tool this access.
- **Admin: choose what is offered.** Which Products, and whether anything may be written at all. Reading and writing are separate switches, never one.
- **Admin: see what has connected and what it asked for.** A list of calls with what was asked and whether it was refused, so "what has this thing been doing" has an answer.
- **Admin: revoke.** Turn it off, or rotate the token, and have every connected client stop working immediately.

### look — What should it look like?

In Admin, beside "Where agents run" — the same area and the same shape. The state first, the detail underneath.

The state line says which of three things is true, in words rather than a badge: **off**, **reading only**, or **reading and writing**. The connection details sit under it, collapsed until asked for, because they contain a token.

The call log is a plain list — when, which tool, which Product, and either "answered" or the refusal. Refusals are not styled as errors; a refusal is the thing working.

### information — What information does this page show or collect?

Whether the server is running and on which port; the token, hidden until revealed; which Products are offered; whether writing is allowed; and the recent calls.

### who-can-use — Who is allowed to use this page?

Admin only, like the rest of the Admin area — and the page must repeat what the rest of the app says: roles gate visibility, not access. There are no logins. Anyone at this machine can change who they are working as, so this is a setting on the machine rather than a permission granted to a person.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?

- `mcpServer` system setting: `{ enabled, port, allowWrite, productIds, tokenAlias }`. Off, no write, no Products by default — a fresh install offers nothing.
- The **token never goes in the database**. It goes to the OS credential store like every other key in this app, and the setting holds only its alias.
- A call log, kept to a bounded number of recent entries, holding the time, the tool name, the Product it touched, and the outcome. No arguments and no returned content: a log that quietly accumulates the contents of somebody's briefs is a second copy of the thing being protected.

### how-it-works — What actually happens, and when?

**The transport is HTTP on loopback, not stdio.** Stdio would mean the client spawns the server, and this server cannot be spawned — it is a window somebody already has open, holding a database that is already locked. So it listens on `127.0.0.1` on a port, and refuses any request whose origin is not loopback.

**Every request carries the token.** A bearer token, generated when the server is first switched on, stored in the OS credential store, and checkable without a database read so an unauthorised request is cheap to refuse.

**The tools, and the shape of them:**

| Tool | What it does |
|---|---|
| `list_products` | The Products offered, and nothing about the ones that are not. |
| `list_work_items` | Work items for an offered Product, with state, kind, and what the AI is permitted to do with each. |
| `get_work_item` | One item in full, with its policy. |
| `read_brief` | One page brief, as it stands in the repository. |
| `list_solutions` | Solutions and where their code lives, so an outside agent can find the repository this plan refers to. |
| `report_progress` | *Write.* Records that outside work happened against an item — a note, not a state change. |

**Deny by default, and the same policy the app uses.** Every tool resolves the work item's own AI policy before answering. An item whose policy does not allow reading is not returned, and is not listed as withheld either — a list that says "three items you may not see" leaks the thing it refuses.

**Writing is one tool and it is the weakest one.** `report_progress` appends a note. It cannot change state, approve a plan, or start a run, because those are the app's own gates and an outside agent is exactly who those gates exist for. If writing turns out to need more than this, that is a later round with its own argument.

**The server stops when the app does**, and when the setting is switched off, and when the token is rotated. There is no daemon.

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?

The running server handle, and the recent call log — which is kept in memory and not written to disk, so closing the app forgets it. That is deliberate: an audit trail that survives is a promise about retention the app would then have to keep.

### tests — How will we know it works? What should we test?

- A request with no token is refused, and one with a wrong token is refused the same way — the refusal must not say which.
- A request from a non-loopback address is refused even with a correct token.
- A work item whose policy forbids reading is **absent** from `list_work_items`, not present-and-marked.
- A Product that has not been offered is absent from `list_products`, and naming its id directly in another tool is refused.
- With `allowWrite` off, `report_progress` is refused and nothing is written.
- `report_progress` cannot change a work item's state, approve a plan, or start a run — asserted against the database after the call, not against the response.
- Switching the server off stops it answering, proved by a call that then fails rather than by the flag.
- Rotating the token makes the previous one fail.
- The call log holds no arguments and no returned content.
- With the server off — the default — nothing is listening on the port.

### limits — Any known limits or things to watch out for?

- **A token on loopback is not a security boundary against the person at the machine.** Anyone who can read the credential store or the port can use it. It stops other software on the machine stumbling in; it does not stop a determined user, and the page must not imply otherwise.
- **The app has no logins, so this cannot be per-person.** It is one token for the machine. Said plainly rather than dressed up as access control.
- **An outside agent reading the plan is not an outside agent following it.** This offers the source of truth; nothing here makes anybody use it, and the page must not suggest that connecting an agent constrains that agent.
- **`rmcp` is already a dependency and is currently unused.** This round is the first thing that actually uses it. If this round is not built, that dependency should be removed rather than left as a marker of intent.
- Loopback ports are a finite shared resource; a port already in use is a refusal that names the port, not a silent fallback to another one.

### model-and-effort — Which AI model and effort level should this page use by default?

None. This page makes no AI calls — it is a server, and the AI is on the other end of it.

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.

- Round 1 (my feedback): **An MCP server, so another Claude can find and use this workspace's plan.** *(Raised while building the website, from the observation that the site can tell a person what the framework is but nothing tells an agent. The condition on building it is the same one every other page in this area carries: it is off until switched on, it offers nothing by default, and it refuses by the same per-item policy the app already uses — because a source of truth that hands itself to anything that asks is not a guardrail, it is a leak with good intentions.)*
