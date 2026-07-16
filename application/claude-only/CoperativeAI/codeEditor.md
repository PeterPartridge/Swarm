# Page Spec — Code Editor

> Produced by `/translate` from [`../../CoperativeAI/codeEditor.md`](../../CoperativeAI/codeEditor.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A real code editor over the active repository's files in the Develop environment: file tree to navigate, Monaco to read and write code.

**Model & effort**
Most capable tier (Claude Fable 5), high effort.

**Depends on**
- `CoperativeAI/repositoryManagement.md`

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

**Status:** translated — waiting for approval
