---
spec: model
from: Swarmdb/ProductPolicy-model.json
deliverable:
depends-on: [Swarmdb/Product-model.json, Swarmdb/AIProvider-model.json]
---
objective: What the AI is allowed to do with a whole Product — read its brief and strategy, and create work items — and through which provider. [whatThisModelIs]
field: id — id / key, required, default auto — unique — The unique identifier [fields.entries.0]
field: productId — id / key, required — must reference a Product row; one policy per Product — The Product this policy governs [fields.entries.1]
field: allowRead — yes/no, required, default no — May the AI read this Product's brief, strategy, and deliverables? [fields.entries.2]
field: allowGenerate — yes/no, required, default no — May the AI create planning work items against this Product? [fields.entries.3]
field: providerId — id / key, optional — must reference an AIProvider row when set; no provider means blocked — The only AI provider this Product's work may go to [fields.entries.4]
field: effortTier — list, required, default low — one of: low / medium / high — How much effort the AI may spend on this Product's requests [fields.entries.5]
field: updatedAt — date, required, default now — updated on every change — When the policy last changed [fields.entries.6]
rel: productId — one-to-one to Product.id (FK_ProductPolicy_Product) [relationships.entries.0]
rel: providerId — many-to-one to AIProvider.id (FK_ProductPolicy_AIProvider) [relationships.entries.1]
index: productId [lookupsAndPerformance.answer.0]
retention: Kept with its Product. Setting a policy again replaces the previous row, so there is only ever one per Product. [lifecycleAndRules.retention]
sensitive: This table is itself a protection: it decides whether a Product's brief and strategy may be sent to an AI provider. No secret values are stored here — the provider's API key lives in the OS credential store. [lifecycleAndRules.sensitiveFields]
invariant: Deny-by-default: a Product with no row here is closed to AI. Generation requires allowRead AND allowGenerate AND a providerId that still exists. One policy per Product; effortTier stays in its list. This policy is deliberately coarser than a work-item policy — allowing generation covers every Deliverable of the Product. [lifecycleAndRules.invariants]

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — ProductPolicy (database model)

> Produced by `/translate` from [`../../Swarmdb/ProductPolicy-model.json`](../../Swarmdb/ProductPolicy-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
What the AI may do with a whole Product — read its brief and strategy, create work items — and through which provider. The Product-level counterpart of [`WorkItemPolicy-model.md`](WorkItemPolicy-model.md).

**Depends on**
- `Swarmdb/Product-model.json`, `Swarmdb/AIProvider-model.json`

**Data to store**
id · productId FK → Product (unique — one policy per Product) · allowRead · allowGenerate · providerId FK → AIProvider (nullable; null = blocked) · effortTier (low/medium/high) · updatedAt.

**Invariants / tests**
- [x] A Product with no policy row is closed (deny-by-default).
- [x] Setting a policy round-trips, and setting it again replaces rather than duplicates.
- [x] Rejects an unknown Product, an unknown provider, and an effort tier outside the list.
- [x] Generation requires allowRead **and** allowGenerate **and** a named provider (gate tested in `commands/work_items.rs`).

**Status:** built (2026-07-18)

## Report back
Implemented as `src-tauri/src/db/product_policy.rs`, mirroring `work_item_policy.rs` — same delete-then-insert shape so there is exactly one row per Product, same validation order, and `EFFORT_TIERS` re-exported from the work-item module rather than duplicated. Command layer lives in `commands/policies.rs` beside the work-item commands (`get_product_policy` / `set_product_policy`). The gate that consumes it is `resolve_deliverable_generation` in `commands/work_items.rs`, kept separate from the network call so deny-by-default is unit testable without a credential store.

**Why a second policy table rather than extending WorkItemPolicy:** the flags differ in meaning (`allowGenerate` creates *new* items; `allowEdit`/`allowGenerateTests` act on an existing one) and the subject differs (a Product has no work-item row to hang a policy on). Sharing one table would have meant a nullable `workItemId` *and* a nullable `productId` with a check constraint — more fragile than two small tables.

**Technical debt:**
- **Coarse by design, and that is a real trade-off:** one switch covers every Deliverable of the Product. There is no per-Deliverable override, so a user who wants AI planning on one deliverable grants it for all of them.
- No audit trail — `updatedAt` records *when* a policy changed, not what it was or who changed it. With the no-login model there is no "who" to record.
- The two policy tables now duplicate the provider/effort validation logic; if a third policy appears, that validation is worth extracting.
