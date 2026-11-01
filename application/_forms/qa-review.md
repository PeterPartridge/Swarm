---
form: qa-review
item: ""                 # the brief this reviews, from the project root, e.g. ClothingWebsite/userLogin.md
status: blank            # blank | reviewing | happy
---

# QA Review — <Item Name>

> **Who fills this in:** QA. **When:** before work starts on the item, and again
> whenever its brief gets a new change round.
>
> **Where it goes:** `qa/<solution>/<item>.md`, mirroring the brief it reviews.
>
> **This is QA's, not the build's.** The AI that builds the item never reads
> it: tests a builder can see are tests it builds to pass, and then a passing
> run tells you nothing. When you are happy, set `status: happy`, add your
> tests to `qa/regression.md`, and ask the AI (`/qa`) for the automation and
> scripts you want.

---

### can-test — Can I test this?
> Yes, or not yet — and why not. "Not yet: there is no way to reset a test
> account" is the kind of answer that gets something built.

### how — How should I test this?
> Through what, with what data, in which environment. e.g. "Through the website
> in dev, with a fresh customer account each run."

### tests — What tests should I be doing?
> One bullet per test, saying what it proves and what you expect to see. These
> are on top of the developers' own tests, never instead of them.
> - Proves: … — expect: …

### manual-or-automated — Are they manual, or can I automate them?
> Mark each test above `manual` or `automated`, and say anything the automation
> needs (a tool, test data, a way to reset state).

### questions-for-product — What questions do I have for Product?
> Ask Product directly. Their answer goes into the item's brief, and reaches the
> build the normal way, through `/translate`.

### problems — What problems do I see?
> Risks, gaps, things that look hard to test or likely to break.
