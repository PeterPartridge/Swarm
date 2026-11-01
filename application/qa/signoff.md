# Sign-off

> **QA's, and only QA's.** When the AI has built the last item of a deliverable
> it stops and waits; a deliverable is **done** when QA has run the regression
> suite and signed it off here. The AI never writes in this file.
>
> - **Deliverable:** exactly as the Project Brief names it.
> - **Regression run:** what was run and the result, e.g. "R-001…R-014: 14
>   passed".
> - **Accepted issues:** anything known and accepted for now, or "none".
>
> `node tools/brief-lint.mjs` says which deliverables are built and waiting on
> sign-off, and checks every row names a real deliverable and a person.

| Deliverable | Date | Signed off by | Regression run | Accepted issues |
|---|---|---|---|---|
| <MVP> | <YYYY-MM-DD> | <name> | <what ran, the result> | <none> |
