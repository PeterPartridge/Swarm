---
spec: page
from: Swarm/terminal.md
deliverable:
depends-on: ["workspaceShell.md"]
---
objective: let developers run real terminal commands in the app — a genuine OS shell in a Develop panel, working in the active repository's folder [why-exists]
model: most capable model, high effort [model-and-effort]
action: a developer opens a terminal panel running their OS shell — PowerShell or cmd on Windows, the default shell on Linux [actions]
action: a developer types any command and sees its live output, as in a normal terminal [actions]
action: the terminal starts in the active repository's folder [actions]
action: a developer closes the terminal, which ends the shell process [actions]
look: a terminal panel in Develop — dark text area, monospaced font; Develop's tab colour on the panel frame [look]
info: the shell's live output and the typed input; nothing is stored [information]
access: anyone using the app — single-user, no login [who-can-use]
store: nothing — terminal output is never logged or persisted by the app [data-stored]
store: the running shell process and its scrollback buffer, in memory only [in-memory]
check: C1 opening the terminal starts a real shell process through portable-pty and shows its prompt [tests]
check: C2 a command such as printing the working directory shows the right output, and the working directory is the active repository [tests]
check: C3 resizing the panel resizes the shell, with no wrapped or garbled output [tests]
check: C4 closing the panel ends the shell process, leaving no orphans [tests]
limit: Windows ConPTY quirks — resize, UTF-8, killing the process tree — spike first [limits]
limit: the shell is local only and never logged [limits]
limit: its permissions follow the app-wide sandbox setting — the OS user's when off, the chosen boundary when not; see agentSandbox.md [limits]
skill: PTY and xterm.js integration — the panel hosts a real shell [tests, Swarm/application-spec.json#core.frameworks]
> The brief's Part 4 change rounds have no question ID to cite, so what they
> add beyond the answers above is not translated here. Read them in the brief.

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — Terminal

> Produced by `/translate` from [`../../Swarm/terminal.md`](../../Swarm/terminal.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A genuine OS shell in a panel of the Develop environment — real commands, live output, starting in the active repository's folder.

**Model & effort**
Most capable tier (Claude Fable 5), high effort.

**Depends on**
- `Swarm/workspaceShell.md`

**Actions**

| User | Can do |
|------|--------|
| Developer | Open a terminal panel running the OS shell (PowerShell/cmd on Windows, default shell on Linux). |
| Developer | Type any command and see live output, as in a normal terminal. |
| Developer | Start in the active repository's folder. |
| Developer | Close the panel, ending the shell process. |

**Information shown / collected**
- Live shell output and typed input. Nothing stored.

**Data to store**

| Item | What it looks like |
|------|--------------------|
| (nothing) | Terminal output is never logged or persisted — solution security rule. |

**Access & security**
Per the solution's security rules: local only (never network-exposed), output never logged or persisted by the app. Permissions are **not** fixed here — they follow the app-wide sandbox setting (off / WSL / Docker): the same permissions as the OS user with no escalation when it is off, the chosen boundary when it is not. See `agentSandbox.md`.

**Tests**
- [ ] Opening starts a real PTY shell and shows its prompt.
- [ ] A command's output is correct and the working directory is the active repository.
- [ ] Resizing the panel resizes the PTY (no garbled wraps).
- [ ] Closing ends the shell process — no orphans.

**Open questions**
- Standing solution-spec question: should the shell be restricted (confined to the repo folder, command denylist), or is full OS-user access intended?

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| portable-pty + xterm.js bridge | Real PTY on Windows (ConPTY) and Linux, streamed to the frontend. | Backend spawns the PTY and streams bytes over Tauri events; xterm.js renders; resize events flow back. | Yes. |

---

## PLAN

**Summary:** Build the embedded terminal: a PTY session manager in `src-tauri/src/terminal/`, streaming to an xterm.js panel, cwd = active repository.

**Changes:**
- Backend: spawn/resize/kill PTY; stream output as Tauri events; kill the process tree on close.
- Frontend: xterm.js panel wired to the events, lazy-loaded.
- **Windows ConPTY spike first** (resize, UTF-8, process-tree kill) before committing the iteration plan — per the project risk list.
- cargo tests for session lifecycle; manual smoke for interactive behaviour.

**Expected technical debt:** single terminal instance in the first iteration (no split/multiple tabs).

**Status:** built. The brief is marked `built` and its methods are in [`../Code_map.md`](../Code_map.md), but no build report was appended to this spec. (Until the 2026-10-07 documentation review, this line still read "translated — waiting for approval".)
