# Page Spec — AI Settings

> Produced by `/translate` from [`../../CoperativeAI/aiSettings.md`](../../CoperativeAI/aiSettings.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
Connect the app to AI providers (Claude first, pluggable): endpoint, API key, and model choices — with keys held only in the OS credential store.

**Model & effort**
Most capable tier (Claude Fable 5), high effort — security-sensitive.

**Depends on**
- `CoperativeAI/workspaceShell.md`
- `CoperativeAIdb/AIProvider-model.json`

**Actions**

| User | Can do |
|------|--------|
| Developer | Add a provider (name, API base URL, API key). |
| Developer | See configured providers — never key values. |
| Developer | Pick which models a provider offers to the app. |
| Developer | Test a provider's connection. |
| Developer | Replace or remove a provider's key. |

**Information shown / collected**
- Provider name, API base URL, models. The key is collected once; afterwards only "stored / not stored" is shown.

**Data to store**

| Item | What it looks like |
|------|--------------------|
| Provider config | AIProvider row with a **keyAlias only** — see the model spec. |
| API key value | OS credential store (Windows Credential Manager / Linux Secret Service) via Tauri keyring plugin, under the alias. Never the DB, config, code, or logs. |

**Access & security**
Implements the project's key-handling security rule directly. The key value exists in frontend memory only during entry, then goes to the credential store and is discarded. HTTPS-only provider URLs.

**Tests**
- [ ] Adding a provider stores details in the DB and the key in the credential store.
- [ ] The key value never appears in the DB file, logs, or post-entry UI.
- [ ] Removing a provider removes its credential-store entry.
- [ ] Test-connection: success on valid provider, clear error on bad URL/key.

**Open questions**
- Exact keyring fallback on Linux without Secret Service (documented encrypted file) — design at build time; never plaintext.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| OS keyring integration | Keys must live in the OS credential store under an alias. | Tauri keyring plugin: set/get/delete by alias; DB stores the alias only. | Yes. |
| Claude API client | First provider; test-connection and later AI calls. | Minimal HTTPS client against the provider's base URL; consult the `claude-api` skill when building. | Yes. |

---

## PLAN

**Summary:** Build provider management: AIProvider table + keyring-backed key storage + a settings UI, and a test-connection command — the foundation the policy-gated AI call path plugs into.

**Changes:**
- Tauri commands: add/list/remove provider (add stores key via keyring, remove deletes it), test connection.
- Settings page with provider cards and a key-entry field that never redisplays the value.
- cargo tests: alias-only persistence, key deletion on remove; Vitest for the form.

**Expected technical debt:** Linux keyring fallback deferred until a target distro without Secret Service is confirmed.

**Status:** built (2026-07-16)

---

## Report back

**Tests:** `cargo test` 62/62 green (4 new client tests: prompt building, story parsing, error cases; keyring behaviour verified manually — unit tests deliberately don't touch the real OS credential store). `npm test` 30/30 green (4 AiSettings tests: stored-state display, add-clears-key, test-connection notice, remove). UI verified in the browser; exe smoke test passed.

**How it was implemented:**
- `src-tauri/src/ai/keys.rs` — keyring 3.6.3 (windows-native / sync-secret-service): store/get/delete/exists under service "CoperativeAI" with the provider's alias; delete tolerates missing entries.
- `src-tauri/src/ai/client.rs` — Claude Messages API over raw HTTPS (reqwest 0.12): `POST {base}/v1/messages` with x-api-key + anthropic-version headers; story generation uses structured outputs (`output_config.format` json_schema) so responses parse deterministically; `stop_reason: "refusal"` handled; effort tier from the item's policy maps to `output_config.effort`.
- `commands/ai_settings.rs` — add (db row + keyring store, rolled back together), list (keyStored flag, never values), remove (keyring entry deleted with the row), test connection (tiny Messages call against the provider's first model).
- `src/components/AiSettings.tsx` in the Develop tab — form defaults suggest Claude at https://api.anthropic.com with claude-opus-4-8; the key field is password-type and cleared the moment the key leaves for the credential store.

**Technical debt:** Linux encrypted-file fallback still deferred; test-connection uses the provider's first model only; per-model 400s from providers whose models don't support `effort`/structured outputs are surfaced verbatim rather than adapted.
