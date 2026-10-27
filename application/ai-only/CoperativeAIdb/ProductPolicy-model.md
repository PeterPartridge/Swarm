# Page Spec — ProductPolicy (database model)

> Produced by `/translate` from [`../../CoperativeAIdb/ProductPolicy-model.json`](../../CoperativeAIdb/ProductPolicy-model.json). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
What the AI may do with a whole Product — read its brief and strategy, create work items — and through which provider. The Product-level counterpart of [`WorkItemPolicy-model.md`](WorkItemPolicy-model.md).

**Depends on**
- `CoperativeAIdb/Product-model.json`, `CoperativeAIdb/AIProvider-model.json`

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
