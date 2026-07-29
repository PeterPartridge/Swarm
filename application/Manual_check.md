# The three steps only you can run

Everything between these is covered by tests that run on every push
(`.github/workflows/ci.yml`). The loop itself — Product → plan → parallel runs →
merge — is driven end to end against a real git repository and a real database
by `commands/runs.rs::tests::a_work_item_goes_from_plan_to_merged` and
`…::two_runs_on_one_solution_stay_apart_and_the_second_conflicts`.

What no test can reach is anything needing a credential, a paid call, or a
window. That is this list. It is short on purpose.

---

## Before you start

```bash
npm run tauri dev
```

Run it from `app/CoperativeAI`. The Vite preview is **not** enough — it has no
Tauri IPC, so every data panel shows an error there and nothing below works.

You will need a Solution pointed at a **real git repository** with at least one
commit, on a branch you are happy to have merged into. Develop → Solutions →
point it at a folder.

---

## 1. The AI planning call

**Needs:** an AI provider that works. Either an Anthropic key, or Ollama running
locally with a model pulled.

1. Develop → **AI Settings**. Add a provider.
   - For Ollama: it must already be serving (`ollama serve`) with a model pulled
     (`ollama pull <model>`), or adding it is refused — by design, since a
     provider with no models can never be routed to.
   - Press **Test**. Expected: `Connection OK` — and for Ollama it should *not*
     ask for an API key. (It used to; that was a bug, fixed 2026-07-29.)
2. Install the model: Admin → models → **Install**. The platform validates a
   model with probe prompts before trusting it with work, so this is not
   optional — `ai_run::plan` refuses an uninstalled model at the last gate.
3. Admin → **AI planning policy** for your Product: allow reading, allow
   generating, and name the provider. It is deny-by-default, so all three.
4. Develop → **Work** → open a work item → **Submit for planning**.

**Expected:** it returns immediately and the job appears in the queue panel as
`waiting`, then `running`, then `planned`. The point of the queue is that you can
submit a second work item while the first runs — do that, and watch it sit behind
the first rather than blocking the UI.

**Also check:** the bell in the topbar. A job that asks a question or fails
should raise the dot; one that plans successfully should not.

> If it fails: the message says which gate refused. "no AI policy" is step 3,
> "has not been installed yet" is step 2.

---

## 2. The agent

**Needs:** the `claude` CLI on PATH.

1. Develop → **Work** → **Runs** panel → **Start** on a run.
2. **Expected:** a worktree appears beside the repository (in
   `../.coperativeai-worktrees/`), a terminal opens in it, and the handover
   command is typed into that terminal — visible in the scrollback, not run
   behind your back.
3. If the Solution has something runnable, a **second** terminal opens beside it
   and boots the app. That is the "spin the front end up" behaviour.
4. Press **Start all** with two runs ready. **Expected:** two worktrees, two
   branches, two agents, and editing in one does not disturb the other.

**Read the brief** the agent was given: it is at
`.coperativeai/briefs/<slug>.md` *inside the worktree*. It should name the work,
carry the developer rules, and — under "Running it while you work" — tell the
agent how to start the app and hot-refresh it.

---

## 3. The buttons

Quick passes that need eyes rather than assertions:

- **Theme** — Admin → Theme → Light. Every surface should flip together; nothing
  should stay white-on-white or dark-on-dark. Reopen the app: the choice sticks.
- **⌘K** — opens anywhere, arrow keys cross the group headings, `>` narrows to
  commands, Escape closes.
- **Merge** — Runs panel → **Check merge** on a finished run. It should name the
  commit count, and any conflicting files, *without touching your checkout*.
  Then **Merge**. With uncommitted work in the main checkout it must refuse and
  say so. A conflicted merge should be left open for the Code tab's three-way
  view, with **Abandon this merge** as the way out.
- **Architecture map** — Develop → Planning and Architecture. Drag the boxes,
  press **Save**, then open the written `.drawio` and confirm the boxes are where
  you left them.

---

## The one that stays open

```bash
ANTHROPIC_API_KEY=sk-... cargo test -- --ignored caching_is_live
```

Prompt caching against the real Anthropic API. It needs your key, so it has
never been run here — the Claude path's caching is the only part of the cost
model still unproven against the real service. The Ollama path has equivalent
`--ignored` tests (`ollama_is_live`, `strategy_is_live`, `install_probes`).
