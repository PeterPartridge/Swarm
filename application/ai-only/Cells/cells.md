# Solution Spec — Cells

> Produced from the request of 2026-10-27 and the plan approved that day. The solution brief is [`../../Cells/application-spec.json`](../../Cells/application-spec.json), which is `drafted · guessed` throughout until a person accepts it. The page Cells reports on is still Swarm's: [`../../Swarm/agentSandbox.md`](../../Swarm/agentSandbox.md), whose rounds 1–12 built everything moved here. Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Turn where agents run into a bolt-on: one crate and one set of panels, beside the app rather than inside it, so a new cell — Sandboxie, a native Linux jail — is added to Cells rather than threaded through Swarm. The page's rule comes with it unchanged: no protection is claimed that detection did not prove.

**Deliverable.** Agent governance (the project's second goal) — the sandbox boundary. **Not the MVP**, which the project's goals put first; the user chose to proceed with this on 2026-10-27.

**Model & effort.** Most capable tier, high effort — this is the seam every process the app starts on somebody's behalf goes through.

---

## Round A — the move, with no change in behaviour

### Spec

- **New crate `app/Cells`** (`cells`). `tooling/sandbox{,_detect,_docker,_intune,_policy,_provision,_run}.rs` move there unchanged except for their `crate::` paths. Swarm depends on it by path and **re-exports the seven modules under `tooling::`**, so no Swarm caller changes.
- **`which` moves with them.** It was the only thing the sandbox code borrowed from the rest of Swarm (`dev_runner::which`); Cells cannot reach back into its host, so it lives in `cells::which` and `dev_runner` re-exports it.
- **The seam test stays in Swarm**, because what it guards is Swarm's callers. Its scanner moves to `cells::seam::spawners` and Cells checks its own two spawning files with the same one.
- **`sha2` moves to Cells**: the policy digest was Swarm's only use of it.
- **The panels move to `app/Cells/ui`**: `SandboxTable`, `PolicySource`, `DevicePolicyExport`, their types, `movingGithubRef`, their CSS, and their tests. Each takes what it needs from its host through a small interface (`SandboxBackend`, `PolicyBackend`, `DevicePolicyBackend`; `CellsBackend` is all three). Swarm keeps its Tauri wrappers and hands them in as `cellsBackend`.
- **Swarm resolves Cells through an `@cells` alias** (tsconfig `paths`, Vite `resolve.alias`), and runs and type-checks its tests. Cells has no `node_modules`; the packages its panels import are pointed at Swarm's.
- **CI runs Cells' cargo gates**: a dependency's tests are not run by its host's `cargo test`.

### Tests

- [x] Every Rust test that moved still passes in Cells, and none was lost: 107 moved plus 1 new = 97 run + 11 ignored (live).
- [x] Cells' clippy with `-D warnings` is clean.
- [x] The seam test still holds Swarm's caller set, now through `seam::spawners`.
- [x] A new test holds Cells' own spawning files to a named list.
- [x] Every panel test that moved still passes with only its setup changed: 10 + 20 + 6 = 36, as before.
- [x] Swarm's `tsc --noEmit` and full `npm test` (76 files, 814 tests) pass, and `npm run build` succeeds.
- [x] The panels' CSS lands after Swarm's own rules in the built bundle, which is the position it held before.
- [ ] Swarm's `cargo clippy` and `cargo test` — **not run**: this machine has no MSVC linker and WSL lacks Tauri's GTK/WebKit libraries. They run in CI on the pull request.

### Open questions

- **Swarm's names are still inside Cells**: the `swarm` distribution, the agent image, `.swarm/policy.json`. That is no change in behaviour, and it means Cells is not yet usable by another host. A host's choice of names is a round of its own if it is wanted.
- **Round B onward** — a `Cell` trait, Sandboxie, the native Linux cell — each needs its own approval. The questions blocking them are in the solution brief's `openQuestions`.

---

## Report back — Round A

**Built as specified.** One addition to the spec: `ui/__tests__/fakeBackend.ts`. Before the move, the panel tests mocked part of Swarm's backend and every call they did not list fell through to a real Tauri `invoke`, which rejects outside Tauri. The fake reproduces exactly that, with listed calls as plain mocks and everything else rejecting. The tests' setup changed and their assertions did not.

**Found while building it:**
- **The CSS could not simply be imported by the component.** `main.tsx` imports `App` before `styles.css`, so a stylesheet imported inside a component lands *before* every Swarm rule, and any equal-specificity rule would flip. It is imported in `main.tsx` straight after `styles.css` instead. That position is safe because every rule in the block starts with a class and no later Swarm rule targets these elements. The built bundle was checked to confirm the order.
- **A catch-all `"*"` tsconfig mapping was tried and narrowed.** It made the panels resolve, but it changed how every Swarm import resolves, putting `@types` ahead of a package's own types. The mapping now names only the four packages the panels import.
- **Vite serves only its own folder**, so `server.fs.allow` names `../Cells/ui`. Without it the tests fail to load with a `/@fs/` error that names no cause.
- **This machine cannot build any Rust crate natively**: no Visual Studio build tools, and Git Bash's `link` shadows the linker's name. Cells' gates were run in WSL Ubuntu. Swarm's need CI.
