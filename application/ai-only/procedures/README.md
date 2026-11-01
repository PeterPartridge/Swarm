# The procedures

One file per thing the framework asks an AI to do. Plain Markdown, no vendor's
syntax, no tool's conventions — **any model can be pointed at one of these and
follow it.**

| When the request is | Follow |
|---|---|
| fill a brief in from an existing codebase | [`draft.md`](draft.md) |
| turn a filled-in brief into a spec | [`translate.md`](translate.md) |
| plan an idea with Product | [`product.md`](product.md) |
| add a new page, endpoint or database model | [`new-item.md`](new-item.md) |
| build the next iteration of an approved spec | [`build.md`](build.md) |
| verify a build against its spec | [`verify.md`](verify.md) |
| decide on the debt builds declared | [`debt.md`](debt.md) |
| help QA: automate tests, write scripts, run the regression suite | [`qa.md`](qa.md) |
| set up a solution's pipeline and infrastructure | [`pipeline.md`](pipeline.md) |
| write the rules out for another AI tool | [`emit-guardrails.md`](emit-guardrails.md) |

## Why they live here and not in a tool's folder

Each of these used to be the body of a Claude Code skill or slash command. The
text was never Claude-specific — it is a procedure written in English — but its
location was, so an agent that was not Claude Code arrived to find the framework's
instructions filed under `.claude/` and addressed to somebody else.

They are here once. Each tool's own format holds a pointer to the file rather
than a copy of it:

| Tool | What it has |
|---|---|
| Claude Code | `.claude/skills/<name>/SKILL.md` — the trigger description, then "read this file and follow it" |
| Any agent reading `AGENTS.md` | the table above, in `AGENTS.md` at the repo root |
| Cursor, Kiro, Copilot | the same table in their native format, written by `emit-guardrails.md` |

A pointer, never a copy, because a procedure duplicated into five tools' formats
is a procedure that is correct in one of them within a month.

## What a procedure can and cannot do

A procedure tells an AI *how* to do something. It cannot make it happen.

Claude Code invokes these as skills and slash commands, so asking for a build
runs the build procedure. With another agent, the procedure is a document you
point at — the agent has to be told to read it, and nothing checks that it did.
That is the honest difference, and it is why **a person still approves every
plan before code is written**: the approval gate is the one part that does not
depend on which model turned up.

## Changing one

Edit the procedure here. Do not edit a tool's pointer to add behaviour — a rule
that exists in `.claude/` and nowhere else is a rule only one model follows,
which is the thing this folder exists to stop.

**Keep them lean.** A procedure is read by the AI every time it runs, so each
holds the rules and a few words of reason. The longer *why* lives below, where
people read it and the AI does not pay for it. `tools/commands.test.mjs` holds a
token budget per procedure; it may only come down.

---

## Why the rules are the way they are

### translate

- **A drafted brief is refused.** `/draft` writes answers from the code and marks
  them as the AI's. Translating one would promote an AI guess to a requirement,
  silently. They become the project's answers only when a person sets `filled`.
- **Every line cites its source.** People no longer read specs line by line, so
  the read-back that used to catch invented scope is done by
  `tools/spec-lint.mjs`: a line with no source, or a source nobody answered, is
  the invented line.
- **`UNKNOWN`, never a guess.** A guess in a spec becomes a requirement the next
  build honours. An unknown is the most useful line the AI can write, and the
  build stops on it until a person answers or defers it with a named owner.
- **The digest is its own file.** Every item translate and every build reads it,
  so it holds only what binds every item. A rule left out of it is a rule no
  build sees. The full project spec is read only when the digest is not enough.
- **The solution spec carries its preset.** Copying the one named preset and
  baseline into `_solution.md` at translate time means no build reads the whole
  of `boilerplates.json`, which was a third of what a build read.
- **A change says what it affects.** Because every line cites its answer, and
  git holds that answer as it read when the spec was written, `spec-lint` can
  tell which lines a brief change made stale. `--impact` lists them across the
  project; `--ready` refuses to build from them. A change to a question no spec
  cites affects nothing, and is not reported.
- **No plan at translate time.** `/build` plans with the approval card, and two
  plans for one change disagree.

### build

- **Tests name the check they prove** (`<item>#C<n>`), so the claim that an item is
  done is traceable to a test, and a test is traceable to something somebody
  asked for. `spec-lint` checks both directions.
- **The approval card.** People approve from ten plain-English lines, not from
  the AI's plan. "Unknowns: 0" is on it because a plan with an open unknown is
  built on a guess.
- **Smallest change; existing code is production.** Large changes at AI speed
  overwhelm reviewers and destabilise production, and code that looks broken is
  usually doing something somebody relies on.
- **The code map.** A method already built is reused rather than rebuilt; the
  map is read before code is written and fixed in the same build that changes a
  method, because a stale row sends the next build looking in the wrong place.
- **Stop at the end of a deliverable.** It is a point for people to evaluate
  direction, which is worth nothing if the AI builds straight past it.
- **Debt, not retries.** Thrashing on something it cannot do burns tokens and
  produces worse code than a clear "I could not do this, here is why".

### product

- **Two sign-offs, because two kinds of person decide.** Product knows the
  customers and the commercial reason; Developers know how it can be built.
  Product signs the idea and its use case first; then Developers ask how, what
  can go wrong and whether there is a better way, and when both are happy they
  sign together, with QA's review done. A build nobody agreed to is the thing
  both sign-offs exist to stop.
- **Sign-offs name a round.** A brief changes by gaining change rounds, so a
  sign-off says which round it covers. A new round shows its missing sign-offs
  instead of carrying an old approval forward silently.
- **The AI plans with Product, but never signs.** Its words stay `drafted`
  until Product accepts them. A sign-off is a person saying so, the same as
  QA's.
- **No architecture from Product.** How it is built is the Developers' part.
  An idea brief that prescribes a mechanism makes a design nobody chose.

### qa

- **QA is a separate track, not part of building.** QA checks the work from
  outside and signs it off. If the AI that builds an item can see QA's tests, it
  builds to pass them, and a passing run stops telling anyone anything. So
  `translate` and `build` never read `qa/`, and `qa` tests what the brief
  promised, not what the spec or the code says.
- **Only when QA asks.** The AI helps QA. It does not decide what QA tests.
- **Never fix a failure.** A failing regression test is news for people. Changing
  the test hides it, and changing the app is a development round nobody planned.
- **Never sign off.** A sign-off is a person saying the work is done. The AI
  stops at a built deliverable; QA's sign-off is what finishes it.

### debt

- **Debt that is not decided on goes nowhere.** A round record is written and
  then nobody reads it. So each debt gets an ID (`D<n>`), and `spec-lint` keeps
  the books: open (nobody has decided), scheduled (a change round names it),
  accepted (the brief says why it is fine for now), or paid (a round says so).
- **Decisions live in the brief, as people's words.** Paying down debt is a change
  round like any other, so it needs the two sign-offs. Accepting it is a line with
  a reason. The AI drafts either; a person accepts it.
- **Never decides, never signs, and opens an issue only when asked.** Writing to
  a tracker is outward-facing, so it needs the person's yes to the title and the
  text.

### verify

- **A check marked by its own author is the weakest kind.** The agent that
  built an item wrote its tests and believes its code; `/verify` is a second
  reader, ideally a fresh session or another model, before people review.
- **Two questions, two tools.** `spec-lint` proves a test *names* each check
  (`<item>#C<n>`), and fails a built item where one does not. `/verify` asks
  whether that test would actually fail if the check broke. The first is
  mechanical and always true; the second is judgement, so every verdict cites
  a file and line.
- **Report, never fix.** A verifier that edits code is a second builder nobody
  approved.

### pipeline

- **Infrastructure is its own plan.** Created as a side effect of a feature,
  nobody approved it.
- **A committed secret is a rotated secret.** It is the one failure that editing a
  file afterwards does not undo, so values are never written or asked for.

### draft

- **The blank form is why people stop.** Twenty questions is a fair price for a
  new project and an unreasonable one for code that already answers most of them.
- **Read for intent.** Code shows mechanism; a brief drafted from it describes
  how the thing is built and misses what it is for.
- **"Could not tell" stays empty.** A plausible invented sentence reads exactly
  like somebody's answer.
- **Never draft deliverables, users, cost or models.** What a team works towards
  next cannot be read out of code that exists, and a wrong guess corrupts the one
  field that decides when a build stops.
- **Five questions, multiple choice.** People do not read long question lists. A
  person picking `b` has answered; a person facing a blank box has a task.

### emit-guardrails

- **`AGENTS.md` first.** Kiro always includes it and Cursor accepts it, so one
  file reaches several tools; native files earn their place only for file-scoped
  rules, which a single root file can't express.
- **Definitions, not names.** "DRY" alone tells an agent nothing; "code repeated
  three times moves to a shared library" is a rule.
- **A pointer table, not the procedures.** Guardrail files are loaded on every
  turn; inlining six procedures would spend most of a context window on five
  things the agent is not doing.
- **Overwrite only generated files.** A file without the header was written by a
  person, and losing it is discovered only in a diff nobody reads.
- **"Nothing here can make you follow them".** The procedures do travel to every
  tool; enforcement does not. Saying less than that, or more, gets the whole
  file ignored once somebody finds out.
