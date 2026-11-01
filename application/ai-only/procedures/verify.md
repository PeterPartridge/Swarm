# Verify a build against its spec

A second opinion after `/build`, before people review. Run it in a fresh
session, or with a different model from the one that built. A check marked
by its own author is the weakest kind there is.

## Read only

- the item spec (`ai-only/<solution>/<item>.md`): its `check` lines and its
  last `## Round`
- `ai-only/<solution>/_solution.md` for the repo and its `cmd` lines
- the tests that name a check (`<item>#C<n>`), and the code they exercise

Never read `qa/`.

## Steps

1. Run `node tools/spec-lint.mjs <projectRoot>`. A check with no test naming it
   is already a finding.
2. Run `cmd: test`.
3. For each check, read its test and give a verdict:
   - **proves:** it would fail if the check were broken;
   - **weak:** it passes but would not catch a real break (it asserts too little, or mocks the very thing it checks);
   - **missing:** no test names it;
   - **failing:** the test fails.

   Then say in one line why.
4. Look for what no check covers: an `action`, `must` or `rule` in the spec that
   the code does not do.

## Rules

- **Report, never fix:** not the code, not the tests. Fixes are a new build
  round, planned and approved like any other.
- Every verdict cites a file and line. "Looks fine" is not a verdict.

## Report

Append to the spec under `## Verify <date>`: one line per check
(`C<n> — verdict — file:line — why`), then anything uncovered. Say plainly whether
it is safe to call the round done.
