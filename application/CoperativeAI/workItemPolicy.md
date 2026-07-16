---
form: page-brief
page: "Work Item AI Policy"
solution: "CoperativeAI"
depends-on: ["productPlanning.md", "aiSettings.md", "CoperativeAIdb/WorkItemPolicy-model.json"]
status: filled            # blank | filled | approved | built
---

# Page Brief — Work Item AI Policy

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So developers decide how each work item may be used by the AI: per item, what the AI is allowed to do (read it, edit code for it, generate tests for it), which provider it may use, and at what effort. Nothing is allowed unless the policy says so.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: a developer) can: open a work item's AI policy from the work item.
- Someone (who: a developer) can: allow or deny each AI use: read the item, edit code for it, generate tests for it.
- Someone (who: a developer) can: pick which configured AI provider (and effort tier) the item may use.
- Someone (who: a developer) can: see at a glance which items have no policy yet (meaning the AI can do nothing with them).

### look — What should it look like?
A small panel in the Develop environment attached to a work item: a short list of allow/deny switches, a provider picker, and an effort picker. Minimal.

### information — What information does this page show or collect?
- Per work item: the allow/deny state of each AI use, the allowed provider, and the effort tier.

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
One policy per work item — see [`CoperativeAIdb/WorkItemPolicy-model.json`](../CoperativeAIdb/WorkItemPolicy-model.json).

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
No.

### tests — How will we know it works? What should we test?
- A work item with no policy: every AI action against it is blocked (deny-by-default, per the solution's security rules).
- Denying "read" blocks the item's content from ever being sent to a provider.
- The item may only use the provider its policy names — a call via any other provider is blocked.
- Policy changes take effect immediately on the next AI call.

### limits — Any known limits or things to watch out for?
The policy check must sit in the one code path through which every AI call passes — no way around it.

### model-and-effort — Which AI model and effort level should this page use by default?
Most capable model, high effort (security-sensitive).

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
> - Round 2: …
