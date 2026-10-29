---
spec: page
from: Swarm/codeEditor.md
deliverable:
depends-on: ["repositoryManagement.md"]
---
objective: let developers read and write code in the app — a real code editor over the active repository's files, with a file tree [why-exists]
model: most capable model, high effort [model-and-effort]
action: a developer browses the active repository's files in a tree [actions]
action: a developer opens a file in the editor with syntax highlighting [actions]
action: a developer edits and saves a file [actions]
action: a developer keeps several files open in tabs and switches between them [actions]
look: in Develop — file tree on the left, editor filling the rest, open-file tabs above it; like VS Code but minimal; Develop's tab colour as accent [look]
info: the active repository's folder and file names [information]
info: the contents of open files, and whether each has unsaved changes [information]
access: anyone using the app — single-user, no login [who-can-use]
store: nothing new in the database — files are read from and written to the repository on disk; the active repository comes from Repository Management [data-stored]
store: open tabs, unsaved edits and the file tree's expanded state, in memory only [in-memory]
check: C1 the file tree shows the active repository's files and folders [tests]
check: C2 opening a file shows its content highlighted for its language [tests]
check: C3 saving writes the change to disk, verified by reading the file back [tests]
check: C4 a file with unsaved changes is clearly marked, and switching tabs keeps edits [tests]
check: C5 files outside the active repository cannot be opened through this page [tests]
limit: use Monaco, loaded lazily — it is heavy and the app must stay light on low-spec machines [limits]
limit: very large files open read-only or warn [limits]
UNKNOWN: how large is "very large", and which — read-only or a warning? [limits]

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — Code Editor

> Produced by `/translate` from [`../../Swarm/codeEditor.md`](../../Swarm/codeEditor.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A real code editor over the active repository's files in the Develop environment: file tree to navigate, Monaco to read and write code.

**Model & effort**
Most capable tier (Claude Fable 5), high effort.

**Depends on**
- `Swarm/repositoryManagement.md`

**Actions**

| User | Can do |
|------|--------|
| Developer | Browse the active repository's files in a tree. |
| Developer | Open a file with syntax highlighting. |
| Developer | Edit and save a file. |
| Developer | Keep several files open in tabs and switch between them. |

**Information shown / collected**
- Folder/file names of the active repository; contents of open files; unsaved-change markers.

**Data to store**

| Item | What it looks like |
|------|--------------------|
| (nothing new) | Files read/written on disk; active repository comes from Repository Management. |

**Access & security**
No login (project security model). File access is scoped to the active repository's folder — files outside it cannot be opened through this page. Opened files are validated (path, type, size) per the solution's security rule.

**Tests**
- [ ] Tree shows the active repository's files and folders.
- [ ] Opening a file shows highlighted content.
- [ ] Saving writes to disk (verified by reading back).
- [ ] Unsaved changes are marked and survive tab switches.
- [ ] Paths outside the active repository are refused.

**Open questions**
- Threshold for "very large file" (open read-only or warn) — decide at build time and record it.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| Monaco integration in a Tauri webview | The editor component, lazily loaded, workers bundled by Vite. | Configure MonacoEnvironment/worker bundling; lazy-load the editor panel. | Yes. |
| Scoped filesystem commands | Read/list/write must be jailed to the repo folder. | Backend commands canonicalise paths and refuse anything outside the active repository. | Yes. |

---

## PLAN

**Summary:** Build the Develop environment's editor: scoped fs commands (list tree, read, write) plus a file-tree + Monaco tab UI, lazy-loaded.

**Changes:**
- Tauri commands: list directory tree, read file, write file — all canonicalised and jailed to the active repository.
- File tree component, editor tabs, Monaco wrapper with worker bundling.
- Vitest for tree/tabs; cargo tests for path jailing (the security-relevant part) and read/write.

**Expected technical debt:** no search, no git integration, no large-file streaming in the first iteration — flagged as future rounds.

**Status:** built. The brief is marked `built` and its methods are in [`../Code_map.md`](../Code_map.md), but no build report was appended to this spec. (Until the 2026-10-07 documentation review, this line still read "translated — waiting for approval".)
