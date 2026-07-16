# Page Spec — Solution Creation

> Produced by `/translate` from [`../../CoperativeAI/solutionCreation.md`](../../CoperativeAI/solutionCreation.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
The Develop tab's card for creating a Solution linked to a Product, answering the solution-spec core questions (type, purpose, hosting, language, frameworks), plus the list of Solutions grouped by Product.

**Depends on**
- `CoperativeAI/workspaceShell.md`, `CoperativeAIdb/Solution-model.json`

**Tests**
- [x] Requires a name, an existing Product, and a valid type.
- [x] Created Solution appears under its Product (persisted via the Solution table).
- [x] With no Products, the card asks to create a Product first.
- [x] Deleting a Solution leaves the Product and its work items untouched.

**Status:** built (2026-07-16)

## Report back
Implemented inside `src/pages/DevelopSolutions.tsx` (the Develop environment page) over `commands/solutions.rs`. Vitest covers the create flow (questions serialised as answers JSON), listing under the product name, and the no-products hint. Generating the framework's actual solution files on disk remains with the Creation Page (self-hosting roadmap item), per the brief's limits answer.
