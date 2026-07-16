# Page Spec — Product Planning

> Produced by `/translate` from [`../../CoperativeAI/productPlanning.md`](../../CoperativeAI/productPlanning.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
The Product environment's entry point: a board where Product creates and manages the work items (features, bugs, tests, specs) that drive the feature designer, developers' builds, and QA's tests.

**Model & effort**
Mid-range tier (Claude Sonnet 5), medium effort.

**Depends on**
- `CoperativeAI/workspaceShell.md`
- `CoperativeAIdb/WorkItem-model.json`

**Actions**

| User | Can do |
|------|--------|
| Product | Create a work item (title, type: feature/bug/test/spec, repository). |
| Product | See all items as a board grouped by status; change an item's status. |
| Product | Edit or delete a work item. |
| Product | Open an item's Feature Designer. |

**Information shown / collected**
- Work item title, type, status, repository.

**Data to store**

| Item | What it looks like |
|------|--------------------|
| Work items | See the WorkItem model spec. |

**Access & security**
No login (project security model). Note: a work item with no AI policy is completely closed to AI — this page creates items closed by default.

**Tests**
- [ ] Created item appears on the board and survives a restart.
- [ ] Status change moves the card to the right column.
- [ ] Delete removes the item from board and database.
- [ ] An item must always have a title and a type.

**Open questions**
- (none)

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| Board UI | Status-column board with cards. | Columns from the WorkItem status list; simple card components. | Yes. |

---

## PLAN

**Summary:** Build the work-item board in the Product environment on top of the WorkItem table: list/create/edit/delete commands plus a column-per-status board UI.

**Changes:**
- Tauri commands: create/list/update/delete work items (parameterised queries via the shared db module).
- Board component with status columns and a create form.
- Vitest for board rendering/interaction; cargo tests for the commands.

**Expected technical debt:** none anticipated beyond placeholder navigation to the not-yet-built Feature Designer.

**Status:** built (2026-07-16)

---

## Report back

**Tests:** `cargo test` 31/31 green; `npm test` 11/11 green (7 board tests: columns render, items in the right column, create flow, status change, delete, first-repository form, backend-error alert). Verified in the browser (board renders, degrades gracefully outside Tauri) and the packaged exe starts with the command layer live.

**How each use case was implemented:**
- Create/list/status-change/delete → Tauri commands `create_work_item`, `list_work_items`, `update_work_item_status`, `delete_work_item` (src-tauri/src/commands/work_items.rs) over the tested `db::work_item` module; board UI in src/pages/ProductPlanning.tsx (columns per status, card select for status, delete button).
- The Product tab of the workspace shell now renders the board.

**Deliberate small overlap with roadmap #4:** a work item requires a repository, so `list_repositories` + a minimal `add_repository` command and a first-repository form were included — otherwise the board couldn't create anything. Full repository management (switching, removing, folder picker) remains its own build.

**Technical debt:** the repository picker is a plain dropdown and the first-repository form takes a typed path (validated by the backend) — replace with a native folder picker in the Repository Management build. Opening the Feature Designer from a card is not yet wired (Feature Designer is roadmap #2).
