# Page Spec — Feature Designer

> Produced by `/translate` from [`../../CoperativeAI/featureDesigner.md`](../../CoperativeAI/featureDesigner.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
A drag-and-drop canvas (per work item) where Product arranges and connects blocks — UI pieces, API endpoints, data models — to design a feature. Designs later feed the specifications that generate endpoints/front-end/database designs.

**Model & effort**
Most capable tier (Claude Fable 5), high effort.

**Depends on**
- `CoperativeAI/productPlanning.md`
- `CoperativeAIdb/FeatureDesign-model.json`

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
