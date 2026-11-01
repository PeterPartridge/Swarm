# Scaffold a new solution item

Create a new blank item form for the person to fill in, from the arguments in
the request
(order: type, solution folder, item name, optional project root — a folder whose
root contains `Project_brief.md`, e.g. `template/`, `example/`).
If type/solution/name are missing, ask once. If the project root was not given
and more than one non-template project root exists, ask which one; default to
the only non-template project root otherwise.

**Where the blank forms live.** `<forms>` below means the project's own `_forms/` folder — what `coperativeai init` puts at the project root — falling back to `template/_forms/` when you are working inside the framework's own repository. Use whichever exists.

Steps:
1. Map the type to its master form in `<forms>/` (pages are Markdown;
   record-style forms are JSON):
   - `page` → `<forms>/page.md`
   - `endpoint` → `<forms>/endpoint.json`
   - `model` → `<forms>/database-model.json`
2. Ensure the solution folder exists at `<projectRoot>/<solution>/`. If the folder is
   new, also remind me it needs a solution spec — copy
   `<forms>/application-spec.json` into it and set `solutionType` to
   `website`, `api`, `database`, or `application` (CLI/TUI/desktop).
3. Copy the master form to `<projectRoot>/<solution>/<itemName>.<same extension>`
   **without filling it in** — it stays a blank form. A human answers in plain
   English: under the question headings in a Markdown form, or in the `answer`
   fields of a JSON form (and sets the name/status fields at the top).
4. Do NOT overwrite an existing file; if it exists, stop and tell me.
5. Tell me the path, and what's next: Product fills Parts 1–2 (or uses
   `/product`) and signs; Developers answer Part 3 and sign with Product.
