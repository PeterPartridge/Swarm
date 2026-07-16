# Page Spec — Terminal

> Produced by `/translate` from [`../../CoperativeAI/terminal.md`](../../CoperativeAI/terminal.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A genuine OS shell in a panel of the Develop environment — real commands, live output, starting in the active repository's folder.

**Model & effort**
Most capable tier (Claude Fable 5), high effort.

**Depends on**
- `CoperativeAI/workspaceShell.md`

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
Per the solution's security rules: same permissions as the OS user (no escalation), local only (never network-exposed), output never logged or persisted by the app.

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

**Status:** translated — waiting for approval
