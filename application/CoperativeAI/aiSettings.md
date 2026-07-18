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
- Round 2 (my feedback): The app must stop burning tokens. Cache the Product context that every AI call repeats, and pick the model from the work item's **effort tier** instead of always using the first configured model — the cheapest/mid/most-capable rules in the Project Brief's Part 4 were being ignored. The provider's model list is therefore ordered **cheapest first**, and the page must say so.
