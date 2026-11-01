# Regression suite

> **QA's.** Every test that answers "does the application still work and do
> what is expected?" One row per test; it grows with each deliverable and only
> shrinks when QA says so.
>
> - **Item:** the brief it tests, from the project root.
> - **Kind:** `manual` or `automated`.
> - **Steps:** numbered steps, for a manual test.
> - **Expected:** what you see when it passes.
> - **Automation:** for an automated test, the file that runs it, from the
>   project root — usually in the solution's own repo, e.g.
>   `../clothing-website/tests/regression/login.spec.ts`. Empty until `/qa`
>   writes it.
>
> The automated tests run every time, through the solution's `regression`
> command in its pipeline. QA runs the manual ones before signing off.
> `node tools/brief-lint.mjs` checks each row: unique IDs, a real item, a known
> kind, and automation that exists.

| ID | Proves | Item | Kind | Steps | Expected | Automation |
|---|---|---|---|---|---|---|
| <R-001> | <what it proves> | <Solution/item.md> | <manual / automated> | <steps> | <expected> | <path> |
