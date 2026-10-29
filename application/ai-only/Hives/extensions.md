# Solution Spec — Extensions (installing Hives and Cells)

> Produced from the request of 2026-10-27: "can we add a section to swarm in the Admin area to add and remove Hives and cells. Can Swarm start with nothing added and we add it grabbing from this repo or from a different URL using a standard format to install". The plan was proposed the same day, and its defaults were approved on 2026-10-29 ("yes, use your defaults and write the spec"). There is no solution brief yet. This changes the Hives spec ([`hives.md`](hives.md)) and Admin ([`../Swarm/adminArea.md`](../Swarm/adminArea.md)), and it touches where agents run ([`../Cells/cells.md`](../Cells/cells.md)). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Hives and Cells are installed and removed from Admin. A new Swarm starts with none. Each one is described in a single standard file that can be read from this repository or from any other URL.

**Deliverable.** None of the three in the project's goals. This is not the MVP loop. Rounds 2 and 3 touch on agent governance (goal 2), because what an installed extension may do is declared and approved, but Round 1 does not. The user chose to go ahead outside the MVP on 2026-10-29.

**Decisions taken with the user (2026-10-29).**
- **Round 1 first.** It installs only extensions this build of Swarm already contains, and no outside code runs. The other rounds each need their own approval.
- **Other URLs, later:** allowed for anyone, with a warning and a permissions prompt (Round 2).
- **Cells:** for now this means switching the built-in cells on and off, with no Cells from other people. With no cell installed, agent runs are refused. **See open question O1, because this premise was wrong.** O1 was answered **(a)** on 2026-10-29.
- **"This repository" means `main`** (O2, answered 2026-10-29).
- **Removing a Hive** deletes its role grants and keeps its data. Work items, test cases and products belong to the project, not to a Hive.
- **Existing installs** keep everything installed. Only a new database starts empty.

**This reverses one earlier decision.** [`hives.md`](hives.md) recorded on 2026-10-27: "Adding a Hive means a developer adds a folder in code. The user cannot create one at runtime." That decision still holds for the *code* in Round 1: a Hive is still a folder a developer adds. What changes is that a Hive can now be **installed or not**, and only an installed Hive is shown.

---

## The standard format — `swarm-extensions.json`

One file format, whether it lists one extension or many. This repository publishes one at its root, which lists everything Swarm contains. Anybody else can publish the same format at any HTTPS URL.

```json
{
  "format": 1,
  "extensions": [
    {
      "kind": "hive",
      "id": "product",
      "name": "Product",
      "version": "0.1.0",
      "publisher": "PeterPartridge/Swarm",
      "description": "Plan products, deliverables and work items.",
      "minSwarm": "0.1.0"
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `format` | yes | Must be `1`. Any other value is refused, so a later format is never half-read. |
| `kind` | yes | `hive` or `cell`. |
| `id` | yes | Lower-case letters, digits and hyphens: the rule `role_hive::is_hive_id` already uses. For a Hive it is the registry id, and for a Cell the sandbox id (`wsl`, `docker`). |
| `name`, `version`, `publisher`, `description` | yes except `description` | Shown in Admin. `version` is `major.minor.patch`. |
| `minSwarm` | yes | The oldest Swarm it works with. An entry that needs a newer Swarm is shown but cannot be installed. |
| `entry`, `sha256`, `permissions` | no | **Reserved for Round 2** (code to download, its checksum, and what it asks to do). They are named now so the format does not change. **Round 1 refuses any entry that has `entry`**, with the message "This Swarm can only install extensions it already contains." |

Unknown fields are ignored. A file over 256 KB, a URL that is not `https://`, a reply that is not JSON, and a missing required field are all refused with a message that names the problem. The file is data: nothing in it is run, and its text is shown escaped.

**"From this repository"** is the default URL in Admin: `https://raw.githubusercontent.com/PeterPartridge/Swarm/main/swarm-extensions.json`. The person can replace it with any other URL.

**The repository's own file is also Swarm's built-in catalogue.** The Rust side reads it with `include_str!` at build time, so "what this Swarm contains" has one source. A frontend test checks that the Hives in that file are exactly the ids in `app/Hives/registry.ts`, and a Rust test checks that the Cells in it are exactly the ids in `cells::sandbox::SANDBOXES` other than `off`.

---

## Round 1 — install and remove what Swarm contains; a new Swarm starts empty

### Spec

**Storage**
- **New table `installed_extensions (kind TEXT, id TEXT, version TEXT, source TEXT, installedAt TEXT, PRIMARY KEY (kind, id))`** in `db/installed_extension.rs`. `source` is the URL it was installed from, so Admin can say where each extension came from.
- **The first time the table is made:**
  - **If the database already existed** before this start, rows are added for `hive/product`, `hive/develop`, `hive/test`, `cell/wsl` and `cell/docker`, with source `built-in`. Nothing disappears for anyone already using Swarm.
  - **If the database is new**, no rows are added.
  - "Already existed" is read once at the top of `create_all_tables`, before any table is made, and is passed in. This runs once, the same way `role_hive` copies its old columns once.

**Reading and checking a catalogue (pure Rust)**
- **`extensions::catalogue`** parses the format above and checks every rule in the table. It returns, for each entry, either installable or the reason it is not:
  - not contained in this Swarm
  - needs a newer Swarm
  - carries code
  - malformed
- **No network in this module**, so every rule is unit-tested.

**Commands**
- `list_installed_extensions` returns the rows.
- `read_extension_source(url)` fetches the URL with the existing `reqwest`, with a 10 s timeout and the 256 KB limit, and returns the checked list. It installs nothing.
- `install_extension(url, kind, id)` **fetches and checks the source again** rather than trusting what the screen sends, then writes the row. Installing twice counts as one install.
- `remove_extension(kind, id)` deletes the row. For a Hive it also deletes that Hive's rows in `role_hives`, in the same transaction. Its data stays.

**What "installed" changes**
- **A Hive that is not installed is treated as not granted to anyone, Admin included.**
  - `get_active_permissions` keeps only installed Hives in `hives`. For Admin, `all_hives` becomes the installed list rather than "everything".
  - `canAccessHive` already gates the rail, the ⌘K palette and the chat's actions, so all three follow without changes of their own.
  - The Admin role editor's Hive columns list only installed Hives.
  - If the Hive that is open is removed, the shell returns to the chat.
- **A Hive installed again comes back with no grants.** Admin grants it again. Deny by default.
- **A Cell that is not installed cannot be chosen** in the sandbox setting. Where agent runs read the setting (`commands::sandbox_mode`), a mode whose cell is not installed is refused, and the error names **Admin → Extensions**. **What happens with no cell installed is open question O1**, and that rule is not built until it is answered.

**Admin → Extensions**
- A new section, placed between Appearance and Activity log, with two cards:
  - **Installed:** kind, name, version, source, and a **Remove** button. Removing a Hive asks for confirmation and says that its role grants go and its data stays.
  - **Add:** a URL field filled in with this repository's URL, and a **Read** button. It lists what the source offers. Each entry has **Install**, or the reason it cannot be installed, or "Installed".
- **The warning for other URLs is written now but only matters in Round 2.** In Round 1 nothing from a URL can run, so the only thing to say is the "contained in this Swarm" reason above.

**Files a developer adds**
- `swarm-extensions.json` at the repository root, listing the three Hives and the two Cells.

### Tests (written first)

- [x] `extensions::catalogue`: a valid file reads; `format` other than 1 is refused; each required field missing is refused; a bad id, a bad version, a `minSwarm` above this Swarm, an unknown id, and an entry with `entry` are each refused with their own reason; unknown fields are ignored; a second entry with the same kind and id is refused.
- [x] `db::installed_extension`: an existing database gets the five rows once; a new one gets none; install is idempotent; removing a Hive drops its `role_hives` rows and leaves another Hive's; removing then reinstalling leaves no grants; it survives a restart on a real file.
- [x] Fetching refuses `http://`, a body over 256 KB (with and without a Content-Length), and a non-success reply, against a local listener. A non-JSON reply is refused by the catalogue. The live fetch of this repository's file is `#[ignore]`d and **has not been run**, because the file is not on `main` until this merges.
- [x] Permissions: Admin's Hives are the installed ones, and a granted but uninstalled Hive is not openable. This is tested on the rule `get_active_permissions` calls (`extensions::openable_hives`), not on the command.
- [x] Agent runs: with no cell installed the `cell` gate is unmet, names Admin → Extensions, and `prepare_run` refuses in its words; once a cell is installed the run starts (`a_run_with_no_cell_installed_is_refused`). An uninstalled cell is refused, both for a run and for the setting, through the pure rules.
- [x] The repository's `swarm-extensions.json` matches `HIVES` (vitest) and `SANDBOXES` (cargo).
- [x] Frontend: with no Hives in the permissions the rail is Chat and Admin; Remove on a Hive asks first, and Cancel does nothing; a cell is removed at once and a refusal is shown; Read uses the URL typed; each entry shows Install, its reason, or Installed; Install uses the URL that was read and refreshes; the role editor shows only installed Hives; Admin has the section.
- [ ] **Not tested by a test of this round:** that an install or removal changes the rail. Admin reloads the permissions after either, and the backend computes the rail from what is installed, but no test joins the two. Removing the open Hive returning to the chat is the shell's existing fallback, and is not tested here either.
- [x] `TauriBoundary` covers the four new commands.
- [x] Gates: `tsc --noEmit`, `npm test` (82 files, 864 tests) and the code-map lint pass. Swarm's `cargo clippy --all-targets -D warnings` is clean in WSL. `cargo test` in WSL: 867 pass and 5 fail, all on WSL's git 2.34 lacking `merge-tree --write-tree`. Unchanged `main` fails the same 5 in the same place (832 pass), so they are the machine, not this round. Cells: clippy clean, 97 pass (11 live tests ignored).

### Not in this round

- Code downloaded from a URL, checksums, a sandboxed frame for Hives, and a permissions prompt: Round 2.
- The `Cell` trait and Cells from other people: Round 3, after Cells' own Round B.
- Updating an installed extension to a newer version. In Round 1 versions only matter for `minSwarm`, because the code is whatever this build contains.

---

## Report back — Round 1

**Built as specified, with three changes. Each is stricter than the spec or follows from O1's answer:**
- **The "no cell" rule is a run gate**, `cell`, the last in `gates::for_run`. That list is both what the run panel shows and what `prepare_run` refuses by, so the refusal and the panel cannot disagree. It applies to **agent runs only**. The terminal, the test runner and the inspectors also read the sandbox setting, but they run the person's own commands, so they still run where the setting says, `off` included. Refusing them on a new Swarm would break the embedded terminal, which O1 did not ask for.
- **The cell the sandbox setting names cannot be removed** (`extensions::may_remove`). Otherwise the terminal and the test runner would be left pointing at a cell that is no longer installed. The spec only refused choosing an uninstalled cell; this also refuses getting into that state by removing one.
- **`ActivePermissions.allHives` is now always false.** `hives` is the exact openable list, Admin included, because "every Hive" would include ones that are not installed. The field is kept so the frontend's loading default still reads (see the debt).

**Found while building it:**
- **The existing run tests start a run on a fresh database**, which is a new Swarm with no cell, so they would all have been refused. Their shared fixture (`product_with_run`) now installs a cell, the same way it already sets the AI policy. The test that lists the gates in order now expects `cell` last.
- **Removing the open Hive needed no change.** The shell already falls back to the first tab it can show (the chat) when the active one disappears.
- **The catalogue's tests were written alongside its code, not before it.** The table, the panel and the Admin changes were tests first, and each test failed before its code existed.

## Round 2 — Hives from other URLs _(outline; needs its own approval)_

- `entry` points at a built bundle, and `sha256` must match it. The bundle is stored in the app's data folder, never in the repository.
- The bundle runs in a sandboxed `iframe` with no direct `invoke`. It talks to Swarm only through a fixed message channel. Each kind of message is a permission listed in `permissions` and approved by the person at install, and anything not listed is refused (deny by default).
- A small Hive toolkit replaces the `@swarm` imports, which a Hive from outside cannot have.
- The install screen warns that this code was not written by this project, and shows the publisher, the URL and every permission requested.

## Round 3 — Cells from other URLs _(outline; needs its own approval, and the user's current answer is "not yet")_

- First comes Cells' Round B (the `Cell` trait). Then a Cell from outside is a separate program per operating system, with checksums, that Swarm talks to through a JSON protocol over stdio.

---

## Open questions

_Both answered on 2026-10-29: O1 is (a) and O2 is `main`. They are kept below as they were asked._

- **O1 — Cells, and what "no cell installed" means. My default rested on a wrong premise.**
  - I proposed "switch the built-in Docker and Intune cells on and off; refuse agent runs when no cell is installed". The code says otherwise:
    - **The cells are WSL and Docker.** Intune is a policy check on the machine (`sandbox_intune`), not a place to run.
    - **`off` is a third choice, and it is the current default.** It runs on this machine, and the app says plainly that there is no boundary.
  - So refusing runs when no cell is installed would mean a new Swarm cannot run an agent until WSL or Docker is set up. It would also leave `off` refused on a new install but allowed on an old one. Three readings:
    - **(a) As approved, and consistent:** `off` is refused for agent runs whenever no cell is installed. A new Swarm needs a cell before any agent runs, and an existing install, which keeps its cells, carries on as today.
    - **(b) `off` is always available, and installing only adds WSL and Docker to the choice.** No run is ever refused for lack of a cell. This is today's behaviour on every install.
    - **(c) Refuse `off` for agent runs everywhere.** This changes behaviour for everyone already on the default and breaks their runs until they set up a cell.
  - **My recommendation is (a).** It is what you approved, it changes nothing for existing installs, and it is the only one of the three that means "a new Swarm does not run agents unprotected".
  - **The rest of Round 1 does not depend on this.** Only the "with no cell" rule waits.
- **O2 — Which branch "this repository" means.** The default URL reads `main`. A release build reading `main` can be offered an extension added after it was built, which Round 1 shows as "not contained in this Swarm". A release tag would match exactly, but there is no tag convention yet to point at.
