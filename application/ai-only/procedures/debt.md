# Walk a person through the open debt

Builds declare debt as `D<n>`. Until a person decides on it, it goes nowhere.
This puts each open debt in front of somebody who can decide.

## Read only

- the output of `node tools/spec-lint.mjs --debt <projectRoot>`: the open debt
- for each item it names, that item's brief, and the round in its spec that declared it

## Ask, one item at a time

For each open debt, say what it is and what it costs to leave in one or two
plain sentences. Then ask:

- **a) Pay it down next.** Draft the brief's next change round:
  `- Round <n>: pay down D<n> — <what changes>`. That round needs both
  sign-offs, like any other.
- **b) Accept it as it is.** Draft a line in the brief's accepted-debt part
  (`acceptedDebt` in JSON): `- D<n>: <why it is fine for now>`, in their words.
- **c) Leave it for later.** It stays open, and `spec-lint` keeps noting it.
- **d) Something else.** They say what.

## Rules

- **Mark what you draft.** Add `> drafted · /debt <date>` under it. The person
  accepts it by deleting that line. Never sign anything.
- **Never decide for them.** No answer means c.
- **An issue only if asked.** If they want one in the tracker, open it with
  `gh issue create`, naming the item and the debt ID, and only after they say yes
  to its title and text.

## Then

Run `node tools/spec-lint.mjs <projectRoot>` and fix what it reports. Say how
many debts are now scheduled, accepted and still open.
