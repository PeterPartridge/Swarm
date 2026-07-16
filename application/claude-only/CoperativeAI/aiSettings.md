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

**Status:** translated — waiting for approval
