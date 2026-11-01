# Translate a brief into a spec

Follow the format in [`ai-only/2-ai-system.template.md`](../2-ai-system.template.md).
`<projectRoot>` is the nearest folder above the brief that holds
`Project_brief.md`. Framework files are in its `_forms/` and `ai-only/` (in this
repository, `template/`).

## Stop if

- The brief is `status: drafted`: the AI's answers until a person sets `filled`.
  Offer to go through its questions.
- The brief is `blank`, or its kind is unclear. Ask once.

## What to write

| Brief | Write | Read as well |
|---|---|---|
| `Project_brief.md` | `ai-only/Project_digest.md`, `ai-only/Project_system.md` | nothing |
| `<solution>/application-spec.json` | `ai-only/<solution>/_solution.md` | only its preset and baseline: `node -e "const b=require('./_forms/boilerplates.json');console.log(JSON.stringify([b.boilerplates['<preset>'],b.securityBaselines['<baseline>']]))"` |
| `<solution>/<item>.md` or `.json` | `ai-only/<solution>/<item>.md` | `ai-only/Project_digest.md` (translate the Project Brief first if it is missing) |

- **Digest:** only what binds every item:
  - platform;
  - each solution's repo and local path;
  - infra and environments;
  - where secrets live, by name;
  - house rules with their meanings;
  - the testing floor;
  - deliverables in order;
  - security model and roles;
  - model and effort tiers.

  Anything left out, no build sees.
- **System:** the rest: users, look and feel, skills.
- **Solution:** its answers, plus the preset's layout, tests and commands and the
  baseline's rules. Its own answers override the preset; its security rules only
  add to the baseline.
- **Item:** only what the digest does not already say. Its `check` lines come
  from `tests` and `ai-tests`, numbered `C1`, `C2`, … Re-translating keeps each
  check's ID.

Translate the person's answers only. `>` lines and `question`, `guidance` and
`example` fields are part of the form. Write no plan; `/build` plans. Never read `qa/`.

## Then

1. Run `node tools/spec-lint.mjs <projectRoot>` and fix every error.
2. Show the person each open `UNKNOWN`. They answer it in the brief (and you
   re-translate), or they defer it with an owner.
3. A long or surprising `skill` list? Say the brief may be too big, or misread.
4. Re-translate when a brief changes; `spec-lint --impact` lists what went
   stale. Keep everything from the first `## Round` heading on.
