---
spec: page
from: Swarm/featureDesigner.md
deliverable:
depends-on: ["productPlanning.md", "Swarmdb/FeatureDesign-model.json"]
---
objective: let Product design a feature visually — a drag-and-drop canvas of blocks for UI pieces, API endpoints and data models, arranged and connected [why-exists]
objective: the design belongs to a work item and later feeds the specifications that generate API endpoints, front-end changes and database designs [why-exists]
model: most capable model, high effort — interactive canvas work [model-and-effort]
action: Product opens a work item's design canvas from the Product Planning board [actions]
action: Product drags blocks — UI piece, API endpoint, data model — from a palette onto the canvas and moves them [actions]
action: Product connects blocks to show what uses what [actions]
action: Product names and describes each block in plain English [actions]
action: Product saves the design, and it reloads exactly as left [actions]
look: a canvas filling the Product environment with a small palette of block types at the side; blocks are simple rounded cards with a name; connections are lines; Product's tab colour as accent; minimal [look]
info: each block's type, name, plain-English description and position; the connections; which work item the design belongs to [information]
access: anyone using the app — single-user, no login [who-can-use]
store: feature designs — blocks, positions, connections — per work item, in Swarmdb/FeatureDesign-model.json [data-stored]
store: the in-progress canvas between saves, such as drag positions, in memory only [in-memory]
check: C1 dragging a block from the palette adds it at the drop position [tests]
check: C2 moving a block and saving keeps its position after reopening [tests]
check: C3 connecting two blocks shows a line, and the connection is saved [tests]
check: C4 each work item has its own design [tests]
limit: keep rendering simple; up to about 100 blocks stay smooth on low-spec machines [limits]
uses: Swarmdb FeatureDesign model [data-stored]
skill: drag-and-drop canvas with dnd-kit — the page is an interactive canvas [why-exists, Swarm/application-spec.json#core.frameworks]
> The brief's Part 4 change rounds have no question ID to cite, so what they
> add beyond the answers above is not translated here. Read them in the brief.

## Round history — kept from the spec before the re-translation

> The spec this file held before the re-translation, kept whole: its body,
> then every plan, build report and round, under the heading styles it used.
> It is history. The spec above is what a build reads.

### The old spec — Page Spec — Feature Designer

> Produced by `/translate` from [`../../Swarm/featureDesigner.md`](../../Swarm/featureDesigner.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A drag-and-drop canvas (per work item) where Product arranges and connects blocks — UI pieces, API endpoints, data models — to design a feature. Designs later feed the specifications that generate endpoints/front-end/database designs.

**Model & effort**
Most capable tier (Claude Fable 5), high effort.

**Depends on**
- `Swarm/productPlanning.md`
- `Swarmdb/FeatureDesign-model.json`

**Actions**

| User | Can do |
|------|--------|
| Product | Open a work item's canvas from the board. |
| Product | Drag blocks (UI / endpoint / model) from a palette onto the canvas; move them. |
| Product | Connect blocks to show what uses what. |
| Product | Name and describe each block in plain English. |
| Product | Save; the design reloads exactly as left. |

**Information shown / collected**
- Blocks: type, name, description, position. Connections between blocks. The owning work item.

**Data to store**

| Item | What it looks like |
|------|--------------------|
| Feature design | One JSON canvas per work item — see the FeatureDesign model spec. |

**Access & security**
No login (project security model). Nothing sensitive.

**Tests**
- [ ] Palette drag adds a block at the drop position.
- [ ] Moved block keeps its position after save + reopen.
- [ ] Connecting two blocks draws a line and persists.
- [ ] Each work item shows its own canvas.

**Open questions**
- Whether connections need labels/types (e.g. "calls" vs "reads") isn't specified — start unlabelled.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| dnd-kit canvas | Drag-and-drop blocks with persisted positions. | Palette as drag sources, canvas as drop target, absolute-positioned blocks. | Yes. |
| SVG connection lines | Show links between blocks. | Simple SVG lines between block anchor points, re-rendered on move. | Yes. |

---

## PLAN

**Summary:** Build the per-work-item design canvas: dnd-kit palette + canvas, block editing, SVG connections, saved as one JSON document per item via the FeatureDesign table.

**Changes:**
- Tauri commands: get/save a work item's design (JSON validated before save).
- Canvas page: palette, draggable blocks, connection drawing, save/load.
- Vitest for canvas interactions; cargo tests for the commands (including JSON-validity invariant).

**Expected technical debt:** keep rendering simple (no zoom/pan initially); performance target ~100 blocks on low-spec machines.

**Status:** translated — waiting for approval
