---
form: page-brief
page: "Product Planning"
solution: "CoperativeAI"
depends-on: ["workspaceShell.md", "CoperativeAIdb/WorkItem-model.json"]
status: built            # blank | filled | approved | built (round 2 built)
---

# Page Brief — Product Planning

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So Product can plan the product: create and manage the work items (features, bugs, tests, specs) that drive everything else — the feature designer, the developers' builds, and QA's tests. It is the entry point of the Product environment and of the whole workflow.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: Product) can: create a work item with a title, a type (feature / bug / test / spec), and the repository it belongs to.
- Someone (who: Product) can: see all work items as a board grouped by status, and change an item's status.
- Someone (who: Product) can: edit or delete a work item.
- Someone (who: Product) can: open a work item to design its feature (goes to the Feature Designer).

### look — What should it look like?
A board in the Product environment: columns by status, cards for work items showing title, type, and repository. A button to create a new item. Uses the Product tab's colour as its accent. Minimal, like the rest of the app.

### information — What information does this page show or collect?
- Work item title, type, status, and which repository it belongs to.

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
Work items — see [`CoperativeAIdb/WorkItem-model.json`](../CoperativeAIdb/WorkItem-model.json).

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
Unsaved edits to the item currently being created or edited.

### tests — How will we know it works? What should we test?
- Creating a work item shows it on the board and it is still there after restarting the app.
- Changing an item's status moves it to the right column.
- Deleting an item removes it from the board and the database.
- A work item must always have a title and a type.

### limits — Any known limits or things to watch out for?
The board should stay usable with a few hundred work items.

### model-and-effort — Which AI model and effort level should this page use by default?
Mid-range model, medium effort.

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
- Round 10 (my feedback): **Strategy** gets its own tab (the workspace opens on it). **Planning** should let you create sprints, create items, and list the sprints. The **RoadMap** should show a timeline going month to month. *(Applied: Strategy split off the Planning screen into the first tab; a SprintManager on the Planning tab creates/lists/removes sprints, with sprint creation removed from the RoadMap so there is one place to make them; the RoadMap defaults to a left-to-right month timeline — items placed by their own dates or their sprint's, undated ones in an Undated column — with by-sprint and by-status a click away. The AI planning policy moved to Admin, see [`adminArea.md`](adminArea.md).)*
- Round 9 (my feedback): Separate each workspace's screens into **tabs** rather than showing them all at once. *(Applied: the Product workspace's five screens — Planning, RoadMap, Marketing, Design, Overview — became a tab row showing one at a time. The Round-3 "all panels at once" layout was right for three screens and cramped at five. The drag-to-pop-out handle stays on each, so side-by-side is now a deliberate act via OS windows rather than the default. Marketing/Design tabs still gate on their role flags.)*
- Round 8 (my feedback): Restructure the platform. **Product Strategy becomes top-level** and absorbs the creation questions — plus the ones that were never asked: commercial model, long-term roadmap, constraints, risks. Deliverables can **depend on each other**, and link out to Developer Planning, Testing Strategy, and Marketing & Design. **Planning becomes execution-only**: sprints, assignment, **capacity per member**, a **risk** field on work items, and **cross-repo dependency links** between work items in different Solutions. **Admin absorbs every policy** — Product policies, Development policies (the Developer Rules editor moves there; Develop links to it), user and role management. Add a **Marketing & Design** section. Rebuild the **Developer Workspace**: open a Solution, a real code editor, Claude Code orchestration with change review, an AI coding pal, and a cross-repo view.
- Round 7 (my feedback): AI models must be **detected automatically** when a provider gains one, and **prevented from being used until installed** — installation generating a Model Capability Pack, validating it against probes, and blocking the model until every probe passes. The app must stay compatible with any AI, not only Claude.
- Round 6 (my feedback): The Product Strategy must define **budgets** — total Product budget, AI budget, token spend limits, and cost-management rules — plus an **AI usage strategy**: e.g. *"use the free/cheap provider until 90% of the budget, then hand over to Ollama"*, and rules for which AI is used for commercial analysis, cost management, and work-item creation. The Admin area must control who may manage the AI budget and strategy.
- Round 5 (my feedback): Once a Product is created, its strategy developed, and work items exist, there should be a **button to generate the user stories / work needed to achieve a Deliverable**. (Decisions taken with this: the button generates the planning level directly above user stories — Features under the default method — each linked to the Deliverable, so the existing per-Feature button then expands them into stories; and it is gated by a **Product-level AI policy**, deny-by-default like every other AI action.)
- Round 4 (my feedback): In the Product area add a **Strategy** section supporting **Deliverables**; each deliverable can have work items assigned to it, and work items can be viewed grouped by deliverable. Each work item gains **expected cost**, **estimated profit**, **chargeable to customers** (yes/no), and **% of cost customers should cover** — these fields' visibility is controlled per role from the Admin area. Fix: adding a work item must update the UI immediately (it wasn't). The Product pop-out should be a **drag** interaction, not a button, and the UI must be responsive.
- Round 3: Creating a Product starts behind-the-scenes scaffolding and opens straight into its workspace with **all three panels showing at once** — Planning, RoadMap, and a new **Overview** panel (each still pop-out-able to its own OS window). The create form gains a folder field; when given, the framework's files are generated at `<folder>/<product name>/.CoperativeAI/` — a Project_brief.md prefilled from the card's answers (Part 1 + Part 3; developers complete Part 2), a claude-only/ folder, and a README — and the location is registered in the SolutionManagement table. The Overview panel shows the brief answers and the scaffold location.
- Round 2: The Product side does not use repositories. The page becomes the **Product home**: cards listing Products plus an "Add a Product" card asking the Project_brief's Product questions (purpose, problem, users, apps you like, apps to avoid, design notes). Creating or opening a Product enters its **Product workspace**: the Product title at the top with menu options — **Planning** and **RoadMap** — and every screen has a button to pull it out into its own OS window. Planning is the hierarchy board (epics, features, user stories, tasks per the planningHierarchy setting; bug/test at any level): add sub-items under an item, assign items to team members (from the Developer Area), schedule into sprints or optional dates. Feature cards get an **"AI: create user stories"** button (shown only when the hierarchy includes user stories) — it goes through the per-item AI policy gate and, until an AI provider is configured, explains that one must be added in AI Settings. A settings row (hierarchy preset + roadmap mode) lives on the Product home.
