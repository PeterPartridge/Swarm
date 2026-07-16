# Page Spec — AIProvider (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/AIProvider-model.json`](../../CoperativeAIdb/AIProvider-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A configured AI provider (Claude first, pluggable): endpoint, models, and the **alias** of its key in the OS credential store — never the key itself.

**Model & effort**
Most capable tier (Claude Fable 5), high effort — security-sensitive semantics.

**Depends on**
- (none)

**Data to store**

| Field | What it looks like |
|-------|---------------------|
| id | Unique identifier (auto). |
| name | Text, unique (e.g. "Claude"). |
| apiBaseUrl | Text; must be an https URL. |
| models | List of model names offered to the app. |
| keyAlias | Text, unique — the credential-store entry name. **The key value never enters this table.** |
| createdAt | Timestamp. |

**Access & security**
The key value lives only in the OS credential store (keyring plugin) under keyAlias — never the DB file, config, code, or logs (project security rule). Deleting a row must also delete the credential-store entry.

**Tests**
- [ ] name and keyAlias uniqueness enforced.
- [ ] Non-https apiBaseUrl rejected.
- [ ] No column or serialisation path ever contains a key value.
- [ ] Provider deletion triggers credential-store cleanup (verified at the command layer).

**Open questions**
- (none — the Linux keyring fallback is tracked on the AI Settings page spec)

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| (covered by project skills) | Secure secret handling. | Table stores alias only; keyring calls live in the command layer. | No. |

---

## PLAN

**Summary:** Create the AIProvider table (alias-only key reference) and queries; https validation; deletion contract with the keyring layer.

**Changes:**
- Schema + CRUD in `src-tauri/src/db/ai_provider.rs`; TDD per the tests above.

**Expected technical debt:** none acceptable on the alias-only rule.

**Status:** translated — waiting for approval
