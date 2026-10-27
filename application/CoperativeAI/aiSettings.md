---
form: page-brief
page: "AI Settings"
solution: "CoperativeAI"
depends-on: ["workspaceShell.md", "CoperativeAIdb/AIProvider-model.json"]
status: built            # blank | filled | approved | built
---

# Page Brief — AI Settings

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So developers can connect the app to AI providers: add a provider (Claude first, others pluggable) with its API endpoint and API key, and choose which models to use — like you can with Claude.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: a developer) can: add an AI provider with a name, API base URL, and API key.
- Someone (who: a developer) can: see the list of configured providers (never their key values).
- Someone (who: a developer) can: pick which models a provider offers to the rest of the app.
- Someone (who: a developer) can: test a provider's connection.
- Someone (who: a developer) can: replace or remove a provider's key.

### look — What should it look like?
A settings screen in the Develop environment: one card per provider showing its name, URL, and models — with the key shown only as "stored" or "not stored", never the value.

### information — What information does this page show or collect?
- Provider name, API base URL, and the models it offers.
- The API key — collected once, then only its stored/not-stored state is ever shown.

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
Provider details with a key alias only — see [`CoperativeAIdb/AIProvider-model.json`](../CoperativeAIdb/AIProvider-model.json). The key value itself goes to the OS credential store (Windows Credential Manager / Linux Secret Service) via a Tauri keyring plugin, under that alias — per the solution's security rules, never in the database, config, code, or logs.

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
The key value only during entry, until it is handed to the credential store; then it is discarded.

### tests — How will we know it works? What should we test?
- Adding a provider stores its details in the database and its key in the OS credential store.
- The key value never appears in the database file, app logs, or the UI after entry.
- Removing a provider removes its key from the credential store.
- Test-connection reports success against a valid provider and a clear error against a wrong URL/key.

### limits — Any known limits or things to watch out for?
Linux machines without a Secret Service need a documented fallback (an encrypted local file) — never plaintext.

### model-and-effort — Which AI model and effort level should this page use by default?
Most capable model, high effort (security-sensitive).

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
- Round 4 (my feedback): **Two tabs — Main AI and Secondary AI — and inside each, a tab per area: Product, Develop and QA, all with the same options.** Every one of those six cells is a platform dropdown (Claude Code, Ollama) that populates the fields that platform actually needs. **Main is what does the work. Secondary assumes nothing and is optional** — a fresh install has none, and nothing on the page implies one is missing. Its purpose is the two jobs the main one cannot do for itself: **peer-reviewing a change**, and **carrying on when the main one runs out of tokens or budget**. *(The reason for the tabs is that the page currently asks somebody to understand the app's provider model before they can add anything — providers are a flat list of rows, and which one gets used is decided elsewhere. Naming the slots says what each provider is **for**, which is the thing a person actually wants to set. The platform dropdown exists because the fields genuinely differ: Claude Code needs nothing but a plan, a local Ollama needs a URL, a hosted Ollama needs a URL and a key and is metered — and showing all of them at once is what makes the page look harder than the decision is. Per area because Develop and QA are not the same job, which the routing table already says in those words.)*
  - **What decides which model runs a job:** this page defines the platforms and models that are available per area and slot; the **effort level set on the work item** picks which of them is used. That is the whole answer — no separate per-Product provider order on top of it. The existing cheapest/mid/most-capable tiers are what the effort level selects between.
  - **Peer review runs on every completed run**, not on request. A review nobody remembers to ask for is a review that does not happen. It is a **second opinion, not a second gate**: there is already a rules-based review of every change, and this adds a different model reading the same diff. What it must never do is imply the two are equivalent — a local model reviewing work done by a far more capable one is worth having and is not the same as that model reviewing itself, so the page and the run report **which model reviewed it** rather than saying "reviewed".
  - **Fallback is a change of quality, not just of provider.** Work finished by the cheaper model after the budget ran out is not the same work, so a run records **which model did what** rather than leaving somebody to assume one model did all of it. Stopping dead when the budget runs out is what the local-Ollama option already exists to avoid, so the fallback is the point rather than a nicety.
  - **Product's routing moves into Admin, and that is the decision rather than an open question.** The routing table's areas were `develop` and `test` only, because Product's planning was gated *and* routed by the Product policy itself. It is now routed here with the other two, which draws the line where it belongs: **a policy decides whether the AI may act at all; this page decides which AI acts.** So the Product policy keeps allow-read and allow-generate and gives up its provider and effort fields, and there is one answer for Product instead of two. *(The version worth avoiding is the one where both places still hold a provider and the behaviour depends on which code path runs first — which is exactly the shape of bug that is invisible until somebody changes a setting and nothing happens.)*
- Round 3 (my feedback): When a new model appears on Ollama or any provider, the system must **detect it and prevent its use until it is installed**. Installation converts the platform's own rules and process into a **Model Capability Pack** (system instructions, developer rules, product strategy rules, coding standards, planning tools, architecture templates, work-item interpretation, cost-management and AI-handover logic) that the new model can work from, then **validates** the model by generating real outputs for work-item interpretation, solution strategy, architecture planning and cost recommendations. Pass and it becomes available; fail and the system reports the errors, the missing capabilities, suggested fixes, and offers re-installation. The aim is that **any** model can build products to the platform specification, follow the rules, respect budgets and take part in handover.
- Round 2 (my feedback): The app must stop burning tokens. Cache the Product context that every AI call repeats, and pick the model from the work item's **effort tier** instead of always using the first configured model — the cheapest/mid/most-capable rules in the Project Brief's Part 4 were being ignored. The provider's model list is therefore ordered **cheapest first**, and the page must say so.
