# Page Spec — Product Planning (round 2: the Product home + workspace)

> Produced by `/translate` from [`../../CoperativeAI/productPlanning.md`](../../CoperativeAI/productPlanning.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
The Product environment: Products as cards (created from the Project_brief's Product questions — the Product side does not use repositories). Creating or opening a Product enters its **workspace**: the Product title at the top, menu screens (Planning, RoadMap), each able to pull out into its own OS window.

**Depends on**
- `CoperativeAI/workspaceShell.md`
- `CoperativeAIdb/Product-model.json`, `WorkItem-model.json`, `TeamMember-model.json`, `Sprint-model.json`, `SystemSetting-model.json`

**Round 2 behaviour**
- Product home: product cards + "Add a Product" card asking purpose / problem / users / apps-you-like / apps-to-avoid / designs; the "How Products are planned" settings row (hierarchy preset + roadmap mode).
- Product workspace: title header, Planning | RoadMap menu, per-screen "Pop out" → a real OS window (Rust `WebviewWindowBuilder`, `index.html?window=<screen>&productId=<id>`; reopening focuses the existing window).
- Planning board: status columns; cards carry type badge, status/assignee/sprint selects, "Add sub-item" (types limited to hierarchy levels deeper than the parent, plus bug/test), delete.
- **AI: create user stories** on feature cards, only when the hierarchy includes user stories — routed through the deny-by-default policy gate.

**Tests**
- [x] Products listed as cards; Add-a-Product asks the brief questions; creating opens the workspace (Vitest).
- [x] Workspace menu + pop-out invokes `open_screen_window` (Vitest).
- [x] Sub-item types restricted per hierarchy (Vitest); hierarchy/product invariants (cargo, work_item).
- [x] Assign to team member + schedule into sprint (Vitest + cargo).
- [x] AI button visible only with user stories in the hierarchy; gate messages surfaced (Vitest + 4 cargo gate tests).

**Status:** built — round 3 (2026-07-17)

## Round 3 — create-time scaffolding + three-panel workspace

**Behaviour:** Create Product → (optional folder field) framework files scaffolded behind the scenes → workspace opens with Planning + RoadMap + Overview panels all visible, each pop-out-able (`overview` added to the pop-out screens).

**Implemented:** `src-tauri/src/scaffold.rs` (validated parent folder → `<folder>/<name>/.CoperativeAI/` with prefilled Project_brief.md — Part 1 + Part 3 from the card's answers, Part 2 left for developers — plus claude-only/ and README; name sanitised for the filesystem); `create_product` gained `scaffoldDir` (scaffold failure rolls the Product back; success registers the path in SolutionManagement); `get_product_scaffold` feeds the Overview panel; `ProductWorkspace` is now a 3-panel grid; new `ProductOverview` component.

**Tests:** 66 cargo (4 scaffold tests: layout + prefill, invalid parent rejected, name sanitising, blank answers) + 31 Vitest (create-with-folder flow opens 3 panels; per-panel pop-out; Overview shows the scaffold path) — all green; builds clean; exe smoke test passed.

**Technical debt:** the folder is a typed path (native folder picker still pending with Repository Management); scaffold contains the project brief only — solution folders/specs generate when solutions are created (future round); no un-scaffold on Product delete (files are the user's).

## Round 4 — Strategy, deliverables, commercial fields, gating, UX fixes

**Behaviour:** Product area gains a **Strategy** section (structured vision/goals/metrics) with **Deliverables** (add/delete) and a work-items-grouped-by-deliverable view; each work item gains a **deliverable** link and gated **expected cost / estimated profit / chargeable / % customer-covers** fields (visible per the active role's seeCost/seeProfit/seeChargeable). The folder picker became a native OS folder explorer (dialog plugin). The pop-out is now a **drag handle** (HTML5 drag → its own OS window), not a button. Adding a work item now updates the board **immediately** (optimistic insert then reconcile).

**Implemented:** `ProductStrategy.tsx`, `PlanningScreen.tsx` (Strategy above the board), `PlanningBoard.tsx` (optimistic create, deliverable select, gated commercial fields, unified `commit`), `ProductWorkspace.tsx` (drag `PopOutHandle`), `FolderField.tsx` + `pickFolder` (dialog plugin + capabilities). Backend: deliverable/strategy/role models + commands; work_item round-3 fields.

**Tests:** cargo 80/80 (incl. commercial-field round-trip + validation, deliverable same-product, migration) + Vitest 40/40 (optimistic create shows the item, gated fields show/hide by role, drag pops out, click doesn't, deliverable grouping). Builds clean; exe smoke passed with the schema migration on existing data.

**Root cause of the "item doesn't appear" report:** the create path already refreshed, but with no optimistic step the new card only appeared after the round-trip resolved; the optimistic insert makes it instant and also rolls back on error.

## Round 5 — "Generate work" on a Deliverable

**Behaviour:** each Deliverable in the Strategy section gets a **Generate work** button. It sends the Product brief, the Product strategy, the deliverable, the connected solutions, and the titles already planned under that deliverable to the AI, and creates the work items that achieve it — linked to the deliverable.

**Two decisions, both taken with the user:**
1. **What it creates:** the planning level **directly above user stories** — Feature under the default Epic→Feature→Story→Task method — so the existing per-Feature "create user stories" button chains straight off it. With no user-story level configured it falls back to the hierarchy's top level; with user stories at the top it creates those. `level_for_deliverable` is a pure function with a table-driven unit test. *(The chosen option's text said "top level" while its preview showed Features for the default hierarchy; the preview's behaviour was implemented, and the user was told, since generating Epics from a Deliverable adds little and the stated goal was to reach stories.)*
2. **What gates it:** a new **Product-level AI policy** (`db/product_policy.rs`) — deny-by-default like work-item policies, but deliberately coarser: allowing it covers *every* Deliverable of that Product, which the panel states in plain words.

**Implemented:**
- `db/product_policy.rs` — one policy per Product: allowRead, allowGenerate, providerId, effortTier; validates the Product, the effort tier, and the provider.
- `commands/policies.rs` — `get_product_policy` / `set_product_policy` + `ProductPolicyDto`, alongside the work-item ones.
- `commands/work_items.rs` — `resolve_deliverable_generation` (the testable gate half: deliverable exists → hierarchy has a level → Product policy allows read **and** generate **and** names a provider) and `generate_deliverable_work` (gates → key from the credential store → Claude → work items created and linked to the deliverable).
- `ai/client.rs` — `build_deliverable_prompt`, a pure prompt builder that includes the strategy and the already-planned titles so a second press extends the plan instead of repeating it. `generate_stories` is reused unchanged — it is prompt-driven.
- `components/ProductAiPolicy.tsx` (the policy panel) and the per-deliverable Generate button in `ProductStrategy.tsx`, which reports what it added and surfaces a denial as a plain alert.

**Tests:** cargo 100/100 (product-policy round-trip/replace/validation, a Product with no policy is closed, `level_for_deliverable` across five hierarchies, generation denied without a policy, denied when read-or-generate-or-provider is missing, allowed when fully open, unknown deliverable rejected) + Vitest 62/62 (Generate button present, generation adds items and reports them, a denial reaches the alert, the policy panel is off by default and saves on toggle). `npm run build` and a full `cargo build` clean.

**Technical debt:**
- **Not verified against the live API.** Every gate, prompt, and persistence step is tested, but no real Claude call was made in this round — the prompt's output quality is unproven.
- **Generation is all-or-nothing:** the items are created as returned, with no review/accept step, so a bad batch has to be deleted by hand.
- **The Product policy is coarse by design** — no per-Deliverable override, and it grants generation across the whole Product.
- **`generate_stories` is now doing double duty** (stories and deliverable work) and its JSON schema key is still `stories`; worth renaming to something level-neutral if a third caller appears.
- The Generate button has no cancel, and a slow call only shows "Generating…".

**Technical debt:** work_item migration stays drop-and-recreate (pre-release — loses existing rows on schema change); cost fields commit on blur (no debounce/undo); the drag gesture uses HTML5 drag (jsdom can't drive pointer coords) — the real tear-off is a same-window gesture triggering `open_screen_window`, not native window drag.

## Report back

**Tests:** `cargo test` 57/57 green (new modules: product, solution, team_member, sprint, system_setting; rewritten work_item incl. migration; AI-gate tests). `npm test` 23/23 green (Product home, PlanningBoard, RoadMap, DevelopSolutions, shell). `npm run build` + `cargo build` clean; exe smoke test passed — including the round-2 migration running against a real old database file.

**How it was implemented:** frontend `ProductPlanning.tsx` (home) → `ProductWorkspace.tsx` (menu + pop-out) → `PlanningBoard.tsx` / `RoadMap.tsx`; standalone-window routing in `main.tsx` + `StandaloneScreen.tsx`. Backend commands: products/solutions/team_members/sprints/settings/windows/work_items (incl. `generate_user_stories`).

**The AI story hook:** `generate_user_stories(featureId)` validates feature type → hierarchy includes user stories → per-item policy allows reading via a named provider (deny-by-default; no policy = blocked). All gates are real and tested; actual generation ships with the AI-integration build, and the command says so once the gates pass.

**Technical debt:** real story generation pending AI Settings/keyring/Claude client (next roadmap item); work-item drop-and-recreate migration acceptable only pre-release; date editing on cards is sprint/assignee-first (item start/target dates are stored and shown on the RoadMap but only settable via the API, not the board UI yet).
