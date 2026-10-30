# Draft a brief from an existing codebase

Fill in `Project_brief.md` from the code. Every answer stays the AI's until a
person accepts it: save with `status: drafted`, and `/translate` refuses it until
a person sets `filled`.

## 1. Read for intent, in this order, and stop when the picture is clear

1. `README`, `docs/`, `CONTRIBUTING`
2. Tests. Their names are often the clearest statement of purpose.
3. Commit messages from the last ~3 months
4. The public surface: routes, endpoints, CLI commands, schema, exported types
5. Manifests and CI config
6. The implementation: last, and least

Read the map before the territory, and sample deeper only where the picture is
thin. Minutes, not a full read. Note every file you actually read.

## 2. Draft only what the code evidences

After each answer, write one line:

```
> drafted · confident|guessed|could not tell · from <files you read>
```

- **confident:** more than one source agrees.
- **guessed:** one weak source, or an inference. Say so.
- **could not tell:** leave the answer **empty**. Write only the marker line. A
  plausible sentence here reads exactly like a real answer, and is the worst
  thing this procedure can produce.

**Never draft** `deliverables`, `apps-to-avoid`, who the users are unless a
source says it, anything about cost, models or effort, or any sign-off. Those
are the team's decisions, not facts in the code.

## 3. End with at most five questions

- Rank by what blocks the most work: `deliverables` first, then whatever a build
  would have to guess (security, environments, the testing floor). The rest stay
  empty with their `could not tell` marker.
- **Multiple choice where the code offers real options:** 2–4 one-line options
  drawn from evidence (half-built routes, feature flags, skipped tests, TODOs),
  plus "something else". Free text only when there are no candidates, and then
  say what you looked at.
- Write them at the end of the brief under
  `## Before this can be translated — <n> questions`, and ask them in
  conversation so they can be answered by letter:

```markdown
**1. What are we working towards first?** *(The code can't tell me, and this decides when a build stops.)*
- **a)** Finish checkout — `src/checkout/` has routes and no tests.
- **b)** Stabilise what exists — 14 tests are skipped.
- **c)** Something else (tell me in a sentence).
```

## 4. Save

- Front matter `status: drafted`. **Never overwrite a `filled` or `approved`
  brief.** Replacing a `drafted` one is fine.
- Under the front matter:
  `> Drafted from the codebase on <date>. Every answer below is the AI's until you accept it: read it, fix what is wrong, answer the questions at the end, then set status: filled.`
- Tell the person how many answers are confident, guessed and could not tell,
  and ask the questions by letter.

## 5. Items, only when asked

`/draft item <path>` drafts **one** item brief by the same rules. Never draft
every item in a repository.
