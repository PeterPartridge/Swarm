# Help QA test: automation, scripts and regression runs

Only when QA asks. This is QA's track, which checks the build from outside;
it is not part of building.

## Read only

- `qa/regression.md`, and the `qa/<solution>/<item>.md` reviews named in the request
- the human briefs those reviews name
- `ai-only/<solution>/_solution.md` for the repo and its `cmd` lines

Don't read the AI's item specs or the code map. Test what the brief promises,
not what was built.

## Do what QA asked

- **Automate:** for each `automated` row with no Automation, write a test in
  the solution's repo under `tests/regression/` (or where `_solution.md`'s
  `layout` puts them), named after its ID. Test from the outside, through the UI
  or the API. Then fill in the row's Automation path.
- **Script:** for each `manual` row with no Steps, write numbered steps and the
  expected result into the row.
- **Hooks:** if a test needs the app changed (a stable selector, seed data, a
  way to reset state), that is a code change. List it separately in the plan.
- **Run:** run `cmd: regression` and report each ID as passed or failed. List
  the manual tests for QA to run.

## Rules

- **Plan first:** open with `build.md`'s approval card and wait for QA's approval.
- **Never fix a failure,** not the test and not the app. Report it. The fix is a
  new development round.
- **Never write in `qa/signoff.md`.** Signing off belongs to QA.
- No `cmd: regression`? Propose one for QA to add to the solution spec.

## Report

Append to `ROUND-RECORD.md` under its three headings. Run
`node tools/brief-lint.mjs <projectRoot>` and fix what it reports about
`qa/regression.md`.
