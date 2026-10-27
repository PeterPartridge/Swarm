# Solution Spec — Hives

> Produced from the request of 2026-10-27 — "move the Product, Development and QA sections into their own folder … we can add hives that are work areas and this is added to permissions checks … the only main screen should be an AI chat window where I can talk to an AI and set up the work station" — and the plan approved that day ("yes the entire plan is approved"). There is no solution brief yet. The page this changes is Swarm's [`../../Swarm/workspaceShell.md`](../../Swarm/workspaceShell.md), which says "the tabs themselves are fixed". This round makes that no longer true. Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Turn the work areas into Hives: each one is a folder beside Swarm, listed in one registry, granted per role, and opened from an AI chat that is the app's main screen.

**Deliverable.** None of the three in the project's goals. This is a restructure of the shell, not part of the MVP loop, agent governance or the Feature Designer. The user chose to proceed with it on 2026-10-27, and the answers below are theirs.

**Decisions taken with the user (2026-10-27).**
- **Location:** `app/Hives`, beside Cells, and not inside Swarm's `src`.
- **Adding a Hive** means a developer adds a folder in code. The user cannot create one at runtime.
- **Main screen:** the chat is home, and the rail of Hives stays.
- **AI reach:** anything the app can do. It is held to a list of actions, each checked against the active role, and an action that is hard to undo needs the person's confirmation in the chat.
- **Admin is not a Hive.** It stays Swarm's settings screen, where Hives are granted.
- **Marketing and Design** stay sub-permissions inside the Product Hive.

---

## Round 1 — the move, with no change in behaviour

### Spec

- **`app/Hives/{product,develop,test}/`**, each holding its page plus a `hive.tsx` that gives the id, label, icon, default colour, screen and (for Develop) the views the palette can open.
- **`app/Hives/registry.ts`** lists them in rail order. The rail, the shell's screen switch, the ⌘K palette and the colour settings all read from it. Admin is appended by Swarm.
- **Components move only if one Hive alone uses them.** That means `TestCases`, `TestWorkItems` and `RunOutcome` go to the Test Hive. `TestExplorer` stays in Swarm because Develop's agent workspace uses it.
- **`@hives` and `@swarm` aliases.** Swarm imports the registry, and the Hives import Swarm's components and backend. Their tests run under Swarm's `npm test` and are type-checked by Swarm's `tsc`.
- **Tab colours are keyed by id**, not by a fixed four. `theme.ts` no longer knows the area names.

### Tests

- [x] The registry lists Product, Develop and Test in that order, with unique ids, and each has a screen.
- [x] The rail shows every registered Hive and then Admin.
- [x] Every test that moved still passes with only its imports changed.
- [x] The source-scanning tests (`HiddenPanes`, `Card`) also scan `app/Hives`.
- [x] `tsc --noEmit` and `npm test` pass (78 files, 830 tests: 827 before and 3 new), and `npm run build` succeeds.

---

## Round 2 — permissions per Hive

### Spec

- **New table `role_hives (roleId, hiveId)`**: one row means that role may see that Hive. The migration copies each role's `canProduct`, `canDevelop` and `canTest` into rows, once, and the old columns stay in place unread.
- **Deny by default:** a Hive with no row is hidden from every role except Admin, and Admin sees every Hive whatever the table says.
- **`get_active_permissions`** returns the list of Hive ids the user may open, and `canAccessHive(id)` reads it.
- **The Admin role editor** lists Hives from the registry rather than three fixed checkboxes.

---

## Round 3 — the chat as home

### Spec

- **The app opens on a chat.** The rail stays, with the chat as its first entry.
- **The AI is offered a list of actions.** In this round they are: open a Hive, and the app's own commands as the action list names them. Each is checked against the active role before it runs, so the AI cannot open a Hive the person cannot see.
- **An action that is hard to undo** (delete, merge, push, start a run) is shown to the person in the chat to confirm, and is not run until they do.
- **Every AI call goes through the existing router, budget and policy checks.** The chat is not a way around them.

---

## Report back — Round 1

**Built as specified.** `git mv` kept each moved file's history. The moved tests changed only their import paths: `../../lib/backend` became `@swarm/lib/backend`.

**Found while building it:**
- **The default colours could not live in `theme.ts`.** Building them from the registry there would make an import cycle: the registry imports the Hive screens, and some of those reach `theme.ts` through the code editor's `useThemeMode`. Whichever module loaded first would read the other half-initialised. The defaults are now built in `TabBar.tsx`, which nothing inside a Hive imports, and passed into `loadTabColors`.
- **The palette's Develop entries are now Develop's own.** They were four hard-coded lines in the shell. They are now the `views` on Develop's `hive.tsx`, and the shell builds one palette group per Hive that has views. The entries, their order and their glyphs are unchanged.
- **`TestExplorer` stayed in Swarm.** It sits in `components/testing` but Develop's agent workspace uses it, so it is not the Test Hive's alone.

---

## Report back — Round 2

**Built as specified.** It adds a new table (`role_hives`), one command (`set_role_hive`) and `canAccessHive`, and the Admin role table now draws its Hive columns from the registry. `update_role` no longer takes the three area flags. It reads the role first and writes the old values back unchanged, so `db::role` itself did not change.

**Tests:**
- [x] **Rust: 8 new tests in `db/role_hive.rs`.** They cover: the seeded roles keep their areas; an existing custom role is carried across; the copy runs once; a new role sees nothing; grant and revoke are idempotent; Admin, an unknown role and a malformed id are refused; clearing a role drops its grants; a grant survives a restart on a real file.
- [x] **Frontend: 4 new tests.** The rail shows only the granted Hives; a role that sees them all gets every Hive plus Admin; a Hive box calls `setRoleHive`; Admin's boxes are ticked and disabled.
- [x] `tsc --noEmit` and `npm test` pass (79 files, 834 tests). `TauriBoundary` checks `set_role_hive`'s arguments against the Rust signature.
- [ ] **Swarm's `cargo clippy` and `cargo test` were not run.** This machine has no MSVC linker, and WSL has no GTK/WebKit. Instead, `db/role.rs` and `db/role_hive.rs` were compiled and tested in WSL in a scratch crate holding only `turso`: 16 tests pass and clippy with `-D warnings` is clean. `commands/roles.rs` was type-checked and clippy'd there too, with Tauri's `State`, `team_member` and `system_setting` stubbed. CI must confirm against the real crate.

**Found while building it:**
- **The test "sees every Hive" first passed for the wrong reason.** The permission provider starts at full access, so a check that ran before the mocked permissions arrived could not fail. Both rail tests now wait for the permissions to load before reading the rail.

---

## Report back — Round 3

**Built.** The spec left the action list open ("the app's own commands as the action list names them"). The first list is five actions:

| Action | Runs | Who may use it |
|---|---|---|
| `openHive` | at once | anyone, for a Hive they can open |
| `openView` | at once | anyone, for a view of a Hive they can open |
| `setTheme` | at once | anyone |
| `setHiveColour` | at once | anyone, for a Hive they can open |
| `createWorkItem` | after Confirm | a role with the Product or Develop Hive |

**One rule is stricter than the plan.** The plan asked for confirmation before anything hard to undo. Creating a work item is not hard to undo, but it writes the project's own data on the AI's say-so, so it asks too. Layout and appearance do not ask.

**Where things live:**
- `ai/chat.rs` — the prompt, schema and parser, all pure.
- `ai::backend::chat` — dispatch by provider kind, through the providers' existing structured calls.
- `commands/chat.rs::chat_turn` — the gate, routing and ledger. It runs no action.
- `lib/chatActions.ts` — the action list and its checks.
- `components/chat/ChatHome.tsx` — the screen.
- The shell puts Chat first on the rail, opens on it, and keeps it mounted (hidden) while a Hive is open.

**Tests:**
- [x] Rust, `ai/chat.rs`: 7 tests. The context names the Product, the Hives and every offer; the conversation is the task, in order, and stays out of the cached context; it says so when nothing is offered; it reads a reply with and without actions; it refuses an empty reply and malformed JSON; the schema requires both fields. They pass in WSL with clippy clean.
- [x] Frontend: `chatActions.test.ts` (10) covers offers by role, and refusing an unknown action, unreadable arguments, a Hive the role lacks, a missing view and a bad colour. It also checks that a work item is confirmed before it is created. `ChatHome.test.tsx` (7) covers what is sent, a layout action running, Confirm, Cancel, a refusal, the policy's refusal, and no Product. The shell tests check that the app opens on the chat and keeps it while a Hive is open, and the rail order (Chat, Hives, Admin).
- [x] `tsc --noEmit`, `npm test` (81 files, 852 tests), `npm run build`, and the code-map lint (0 errors).
- [ ] **Not compiled anywhere:** `ai::backend::chat`, `commands/chat.rs`, `ai_run::product_policy_gate`, the three visibility changes, and the command and module registrations. Nor was the ledger guard test (now listing `chat`) run. CI must build them.
- [ ] **Not tested:** a conversation with a real model, and how the chat looks in the running app.

**Found while building it:**
- **AI calls in this app are scoped to a Product.** The router, the budget and the ledger all take a `product_id`, and the policy is the Product's. So the chat is about a Product, which is chosen at the top of the chat. With no Product, the chat says so and does not call. An app-wide chat would need an app-wide policy and budget, and that is a decision for a person.
- **The Product policy check is now shared** (`ai_run::product_policy_gate`), because the chat was its third caller. The two older copies, in `design` and `architecture`, were left in place and are recorded as debt.
- **A hidden `section` loses its region role,** so the test that checks the chat stays mounted follows the chat's own text across the switch, rather than looking it up by role.
