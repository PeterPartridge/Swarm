# The AI workspace

This folder is where the AI does its work. People write the briefs in plain
English in the folders beside this one; the AI works here. It translates those
briefs into specs, plans each change, reports what it built and what it could
not build, and keeps track of what already exists so it does not rebuild it.

**It works with any AI model.** Nothing in here depends on one vendor's model or
tool. Claude, GPT, Gemini or a local model all read and write the same plain
Markdown files, so work one model started can be picked up by another.

**People can read anything here, and nobody has to.** "AI-only" means the AI
writes these files for the AI to read, as tersely as clarity allows. They are
not hidden. Every line of a spec names the brief answer it came from, and
`node tools/spec-lint.mjs` checks that, so the routine read-back is done by a
check. What people do read is short and plain: the `UNKNOWN` lines, the approval
card at the top of every plan, and the round reports.

---

## What is in it

| File | What it is | Who writes it |
|---|---|---|
| `README.md` | This page. | the framework |
| [`1-translate-for-ai.md`](1-translate-for-ai.md) | The bridge, for people: what translation gives back, and a prompt for a chat model with no file access. | the framework |
| [`2-ai-system.template.md`](2-ai-system.template.md) | The spec format: one `key: value [source]` line per fact, and the keys allowed. | the framework |
| [`3-code-map.template.md`](3-code-map.template.md) | The shape of the code map, and how it is checked. | the framework |
| [`procedures/`](procedures/README.md) | One file per thing the framework asks an AI to do — draft, translate, new-item, build, pipeline, emit-guardrails. Plain Markdown; any model can be pointed at one and follow it. Each tool holds a pointer, never a copy. | the framework |
| `Project_digest.md` | The rules every build obeys, from `Project_brief.md`. Every item translate and build reads this and nothing else at project level. | the AI, from the brief |
| `Project_system.md` | The rest of the brief: users, look and feel, skills, open questions. Read only when the digest is not enough. | the AI, from the brief |
| `<solution>/_solution.md` | One per solution: its tech, commands and security rules, with its named preset and baseline copied in, so no build reads all of `boilerplates.json`. | the AI, from `application-spec.json` |
| `<solution>/<item>.md` | One **item spec** per page, endpoint or model, mirroring the human folders (`ClothingAPI/Login.json` → `ClothingAPI/Login.md`). The spec, then a report for every build round. | the AI, from the item's brief |
| `Code_map.md` | The **reuse index**: one row per method the AI built, saying what it does and what it uses. | the AI, as it builds |

The specs are what the AI builds from. The code map is a supporting index. It is
one file here, not the purpose of the folder.

---

## How an AI works in here

The reading order keeps each step cheap. No step re-reads the whole project.

1. **Translate.** A filled-in brief becomes a spec here. The Project Brief
   becomes `Project_digest.md` and `Project_system.md`; a solution spec becomes
   `<solution>/_solution.md`; each item brief becomes `<solution>/<item>.md`.
   Gaps become `UNKNOWN` lines, never guesses.
2. **Plan.** To build an item, read the digest, the solution's `_solution.md`,
   the item's spec, and the first sentence of each `Code_map.md` row, looking for
   something to reuse. Open the plan with the approval card and wait for a person
   to approve it.
3. **Build and report.** After approval, make the smallest change that answers
   the spec. Append a round report to the item's spec: what was done, the tests,
   and the debt left behind. Update the code-map rows for any method created or
   changed.

## What the code map costs, and what it buys

It costs one row per method the AI creates or changes, written in the same build
that changes the method. `node tools/code-map-lint.mjs` checks that every file
and method a row names still exists.

It buys a cheap reuse check before code is written. Reading the first sentence
of each row costs less than reading the code, and a method found there is one
the AI does not rebuild. If keeping the rows up to date stops being worth what
that check saves, change the rule where it is written (step 3 of
[`procedures/build.md`](procedures/build.md), and the project's guardrails). Don't skip it
quietly in a build.

---

## Using it with your agent

- **Claude Code, Cursor, Codex, Gemini CLI, Copilot, opencode and Kiro** run the
  steps as their own commands. `coperativeai init --agents <list>` installs
  them; each points at a procedure in `procedures/`.
- **Any other agent** can follow the same steps: point it at the procedure, e.g.
  "follow `ai-only/procedures/build.md` for this spec". `/emit-guardrails`
  writes the project's rules into the file each tool reads, such as `AGENTS.md`,
  Cursor rules or Kiro steering.
- **A chat model with no file access** can still translate: paste a prompt from
  [`1-translate-for-ai.md`](1-translate-for-ai.md) along with the brief, and
  save what it returns at the mirrored path here.

The rules travel to every agent; the machinery does not. Plan approval, cost per
change and the sandbox are enforced by the Swarm app and its commands.
With any other agent, enforcing them is up to you.
