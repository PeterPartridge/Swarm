# Build the next iteration of an approved spec

Build from `ai-only/<solution>/<item>.md`; with none named, list them and ask. `<projectRoot>` is the nearest folder above it that holds `Project_brief.md`.

## Read only

- `ai-only/Project_digest.md`
- `ai-only/<solution>/_solution.md` (translate its `application-spec.json` first if missing)
- the item spec
- `ai-only/Code_map.md`, if it exists: the first sentence of each row

Never read `qa/`.

## Stop before planning if

- `node tools/spec-lint.mjs --ready <spec>` fails. Name what it reports.
- `node tools/brief-lint.mjs --ready <its brief>` fails. Name what's missing; never sign for anyone.
- `node tools/brief-lint.mjs --status <each depends-on brief>` shows one not `built`.
- `node tools/brief-lint.mjs <projectRoot>` reports this item's deliverable.
- The repo in `_solution.md` is not checked out.
- It needs new infrastructure or a pipeline. That is `/pipeline`.

## 1. Plan, then wait

Open with the approval card: at most ten plain lines.

```
Change:      <one sentence>
Deliverable: <name> — <what this adds>
Where:       <solution, repo>
Reuses:      <code-map rows, or nothing>
Rules hit:   <rules touched, or none>
New deps:    <or none>
Debt:        <expected, or none>
Unknowns:    0
```

Under it, for the AI: how each action and check is done. **Wait for approval.**

No code in the solution yet? Plan only the scaffold, from `_solution.md`, with
pinned versions; record the exact version of anything unpinned.

## 2. Build

- Use the spec's `model` line. Make the smallest change that meets the spec.
- Existing code is production, even when it looks wrong.
- Every `rule` binds; breaking one means not done.
- No secrets anywhere; name settings instead.
- Name each test after the check it proves: `<item>#C<n>`.
- TDD, if the floor or `test` line asks: failing test, pass, tidy.
- Stuck? Record debt and stop. Don't loop.

## 3. Report

Run `cmd: test` and `cmd: build`, then append to the spec:

```
## Round <n>
### What I did
### What I could not do  (and what you would need to tell me)
### Debt I left behind
```

Number each debt `- D<n>: …`, on from earlier rounds; write `Paid D<n>` for
debt this round paid. Include the command results and a token estimate. `spec-lint` fails a built
item with a check no test names.

Then:
- **Code map:** one row in `ai-only/Code_map.md` per method you created or
  changed (new map: copy `ai-only/3-code-map.template.md`). Run
  `node tools/code-map-lint.mjs`.
- **First successful build:** set the brief's `status: built`.

## 4. Stop at a deliverable's end

Last item of its deliverable? Say what it now does end to end, and wait for QA
to sign it off in `qa/signoff.md`.
