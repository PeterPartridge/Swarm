# Plan an idea with Product

Product is the ideas side: customers, the commercial reason, the problem.
Help them turn an idea into Parts 1–2 of a page brief (a new item, or the next
change round of one) worth signing. **You propose the words. Only Product's
acceptance makes them the brief.**

## Read only

- `ai-only/Project_digest.md` (if missing, `Project_brief.md`): users, deliverables, roles
- the page brief, if this is a change to one

## 1. Ask, at most five questions

- Cover: who it is for, the problem, the commercial reason (why now, what it
  makes better or more competitive), what people do on it, and who may use it.
- **Multiple choice wherever there are real options:** the users, roles and
  deliverables the project already names. Add "something else" each time. Ask
  free text only when the choice would be fake.
- Never propose architecture, technology or how it is built. That is the
  Developers' part.

## 2. Draft it

- **A new item:** copy `_forms/page.md` (via `new-item.md`) and fill Parts 1–2
  only.
- **A change:** add the next `- Round <n>:` bullet to Part 4, and update Part 2.
- Write Product's answers in their words. Under each one, add
  `> drafted · from the conversation on <date>`.
- Leave `status: drafted` and both sign-offs empty. Nothing you could not get an
  answer for is filled in.

## 3. Hand it back

Tell Product what you wrote and what is still open. They accept it by:
1. fixing anything that is wrong and deleting the `> drafted` lines;
2. setting `status: filled`;
3. signing `product-signoff: <name> <YYYY-MM-DD> round <n>`.

Then the Developers answer Part 3. Never sign for anyone.
