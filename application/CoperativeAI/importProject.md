---
form: page-brief
page: "Import a Project"
solution: "CoperativeAI"
deliverable: ""
depends-on: ["productPlanning.md", "solutionCreation.md", "CoperativeAIdb/RepoLink-model.json"]
status: drafted            # blank | drafted | filled | approved | built
---

# Page Brief — Import a Project

> Drafted by Claude on 2026-09-13 from the request "for the app, import and it
> fills everything in, and import can be multi repo", read against what the app
> already has. **Every answer below is the AI's until you accept it**: read it,
> fix what is wrong, answer the questions at the end, then set `status: filled`.
> `/translate` refuses this brief while it says `drafted`.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So a team with software that already exists can start using this app in one sitting instead of filling in blank forms. Point it at the repositories a product is built from — one or several — and it creates the Product, its Solutions, and drafts every brief from what the code already says, leaving a short list of questions only people can answer.
> drafted · confident · from the request itself, and `.claude/skills/draft-brief/SKILL.md`

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: a developer) can: pick **one or more folders** — each one a repository of the same product — and give the product a name.
- Someone (who: a developer) can: see what the app worked out about each repository before anything is created: its **type** (website / api / database / application), its stack, and why it thinks so.
- Someone (who: a developer) can: correct that type, or drop a repository from the import entirely.
- Someone (who: Product) can: read the drafted answers with **where each came from and how sure it is**, and accept, edit or clear each one.
- Someone (who: Product) can: answer **the questions at the end** — at most five, multiple choice wherever the code offers real candidates.
- Someone (who: a developer) can: stop partway and come back — an import that is half-accepted is not lost.
> drafted · guessed · from the request, plus the accept-per-answer rule in the draft skill

### look — What should it look like?
Like the Product creation flow it extends, not a new environment: pick folders, a table of what was found per repository, then the drafted brief with a marker beside every answer and an accept control. The questions sit at the end, in one short list, answerable by choosing.
> drafted · guessed · from `src/pages/ProductPlanning.tsx` and `src/components/FolderField.tsx`

### information — What information does this page show or collect?
- The folders chosen, and for each: repository name, detected type, the evidence for that type, and whether it is included.
- The drafted answers to the Product brief questions, each with its source files and a confidence of confident / guessed / could not tell.
- The open questions, with their options.
- What was created when it finishes: the Product, the Solutions, the briefs, and where each file was written.
> drafted · confident · from `template/Project_brief.md` and `.claude/skills/draft-brief/SKILL.md`

### who-can-use — Who is allowed to use this page?
Anyone using the app — roles decide visibility only and are not a security boundary. This creates local records and reads local folders; it makes no AI call until the person presses the button that starts drafting, and that call is subject to the Product's AI policy like any other.
> drafted · confident · from the app's roles model and deny-by-default policy rule

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
No new model if it can be avoided: a Product already exists, Solutions already carry a type and a local path, `RepoLink` already records a repository, and `emitted_file` already tracks what the app wrote. The import needs to remember only its own progress — which repositories were chosen, which drafted answers have been accepted — so it can be resumed.
> drafted · guessed · from `src-tauri/src/db/{solution,emitted_file}.rs` and the RepoLink model

### in-memory — Is there anything that **must not** be saved permanently, or must survive between screens?
The drafted answers must survive leaving the page before they are accepted, so they are stored rather than held in memory. Nothing read out of a repository during detection is written anywhere except as an answer somebody can see.
> drafted · guessed

### tests — How will we know it works? What must be true for this to be accepted?
- Importing two repositories creates one Product with two Solutions, each with the right local path.
- A repository whose type cannot be determined is reported as unknown and asks, rather than guessing.
- Drafted answers are never treated as accepted: the Product's brief stays `drafted` until a person accepts, and translation refuses it.
- An import of a folder that is not a repository fails with a reason, and creates nothing.
- Stopping halfway and returning keeps the accepted answers and loses nothing.
- Nothing is written outside the folders chosen.
> drafted · guessed · from the acceptance style of the other briefs in this solution

### limits — Any known limits or things to watch out for?
Reading several repositories costs several times the tokens of one, so detection must read the map — manifests, folder names, README, route and schema files — before any deep read, and the synthesis across repositories should be a single pass rather than one per repository. A monorepo containing several solutions is a different shape from several repositories holding one each, and the first round need not handle both.
> drafted · confident · from the budget rule in the draft skill

### model-and-effort — Which AI model and effort level should this page use by default?
Most capable, high effort for the synthesis across repositories; cheapest model, low effort for per-repository type detection, which is mostly manifest reading.
> drafted · guessed · from the tiers in the Project Brief

---

## Before this can be translated — 4 questions

**1. Which deliverable does this work towards?** *(I cannot read this from code, and the Project Brief does not yet name any.)*
- **a)** Name the deliverables first, then come back to this.
- **b)** It is its own deliverable — "a team can start from code they already have".
- **c)** Something else.

**2. What does "multi-repo" mean first?** *(Both are real; the first round should do one.)*
- **a)** Several separate repositories, one product — pick N folders.
- **b)** One monorepo containing several solutions — pick one folder, detect the solutions inside it.
- **c)** Both, and accept that the first round is bigger.

**3. How much does import draft?**
- **a)** The Product brief only — Solutions get created, their item briefs stay blank until somebody asks.
- **b)** The Product brief plus one item brief per obvious entry point (a route file, a screen, a table).
- **c)** Everything it can find. *(This is how you get two hundred drafted briefs nobody reads.)*

**4. What happens when a repository already has a `.CoperativeAI/` folder from a previous import?**
- **a)** Refuse, and say which — never overwrite somebody's answers.
- **b)** Import as an update: draft only what is still blank, leave accepted answers alone.
- **c)** Ask, per repository.

---

## Part 4 — changes-over-time

> - Round 1: …
