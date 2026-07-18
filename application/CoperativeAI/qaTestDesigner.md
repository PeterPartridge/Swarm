---
form: page-brief
page: "QA Test Designer"
solution: "CoperativeAI"
depends-on: ["workItemPolicy.md", "CoperativeAIdb/TestCase-model.json"]
status: built            # blank | filled | approved | built
---

# Page Brief — QA Test Designer

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So QA can design tests around work items — plain-English test scenarios attached to a work item that the AI can then implement as real tests, within the item's AI policy. It is the Test environment's main page.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: QA) can: pick a work item and see its test scenarios.
- Someone (who: QA) can: add a test scenario in plain English (given / when / then style is fine but not required).
- Someone (who: QA) can: edit or remove a scenario.
- Someone (who: QA) can: ask the AI to implement a scenario as a real test — allowed only if the work item's policy permits generating tests.
- Someone (who: QA) can: see which scenarios have been implemented and which are still design-only.

### look — What should it look like?
The Test environment: work items on the left, the selected item's scenarios as a list on the right, each showing its state (designed / implemented). Test tab colour as accent.

### information — What information does this page show or collect?
- Test scenarios per work item: description, state, and where the implemented test lives.

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
Test scenarios per work item: the plain-English scenario (text), its state (one of: designed / implemented), and the file path of the implemented test. Stored as work items of type "test" linked to their parent item, or as a later model if that proves too thin — decide at build time and record it.

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
The scenario currently being written.

### tests — How will we know it works? What should we test?
- Adding a scenario to a work item saves it and it survives a restart.
- The AI "implement" action is blocked when the item's policy denies generating tests.
- An implemented scenario shows where its test file lives.

### limits — Any known limits or things to watch out for?
AI implementation goes through the same single policy-checked AI call path as everything else.

### model-and-effort — Which AI model and effort level should this page use by default?
Mid-range model, medium effort.

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
- Round 2 (my feedback): The Testing area needs a **Testing Strategy** section — test plans, test environments, required tooling, and links to test cases / automated suites. Tests must also be able to be **associated with Deliverables or Work Items**, not only with a work item.
