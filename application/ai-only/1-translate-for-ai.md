# Translate your brief into something the AI can build from

> **Why this step exists.** People write best in plain language; AI models follow
> a short, labelled structure most reliably. This step is the bridge: you hand
> over your filled-in brief and the AI rewrites it as a **spec**, one fact per
> line, each line saying which of your answers it came from. You stay in plain
> English. You never have to read the spec — `tools/spec-lint.mjs` checks every
> line has a real source — but you can, any time.

## What you get back

| From | The AI writes | What it is |
|---|---|---|
| `Project_brief.md` | `ai-only/Project_digest.md` | the rules every item obeys, in a few lines |
| `Project_brief.md` | `ai-only/Project_system.md` | everything else: users, look and feel, skills |
| a solution's `application-spec.json` | `ai-only/<solution>/_solution.md` | its tech, commands and security rules, with its preset copied in |
| an item brief | `ai-only/<solution>/<item>.md` | what to build for that one page, endpoint or model |

**What you do read:** the lines that start `UNKNOWN:`. Each is a question the AI
could not answer from your brief. It will not guess, and a build will not start,
until you answer it in the brief or mark it
`DEFERRED: … — owner: <name>`.

**Skills** are what the AI says it needs to be good at, such as "building login
screens". A long or surprising list is your cue that the brief is too big, or
was misread.

## How to run it

- **Claude Code:** `/translate <path to the brief>`.
- **Another coding agent:** tell it to follow `ai-only/procedures/translate.md`.
- **A chat model with no file access:** paste the prompt below, then the format
  ([`2-ai-system.template.md`](2-ai-system.template.md)), then your brief. For an
  item, paste `ai-only/Project_digest.md` too. Save what comes back at the path in
  the table above, then run `node tools/spec-lint.mjs` on it.

```text
Translate the brief below into the spec format below, following it exactly:
one "key: value [source]" line per fact, citing the question each came from.
Translate only the person's answers — never guidance, examples or ">" lines.
Invent nothing: anything missing or contradictory becomes an
"UNKNOWN: <question> [source]" line. Write no plan.

<<< PASTE 2-ai-system.template.md >>>
<<< FOR AN ITEM: PASTE ai-only/Project_digest.md >>>
<<< PASTE THE FILLED-IN BRIEF >>>
```
