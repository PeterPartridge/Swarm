# Page Spec — Workspace Shell

> Produced by `/translate` from [`../../CoperativeAI/workspaceShell.md`](../../CoperativeAI/workspaceShell.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
The main window: a top menu with three tabs — Product, Develop, Test — each with its own colour; clicking a tab enters that environment. Everything else in the app lives inside one of the three environments.

**Model & effort**
Mid-range tier (Claude Sonnet 5), medium effort.

**Depends on**
- (none — first page; the app opens straight into it, no login)

**Actions**

| User | Can do |
|------|--------|
| Anyone using the app | Click Product / Develop / Test to enter that environment. |
| Anyone using the app | See which environment is active from the tab and its colour. |
| Anyone using the app | Customise the app's colours, including each tab's colour. |

**Information shown / collected**
- The active environment (Product, Develop, or Test).
- The user's colour choices.

**Data to store**

| Item | What it looks like |
|------|--------------------|
| Colour choices | A small set of named colours (e.g. per-tab), persisted locally so they survive restarts. |

**Access & security**
No login — single-user local desktop app (project security model). Nothing sensitive on this page.

**Tests**
- [ ] App opens straight into the workspace with the three tabs — no login screen.
- [ ] Clicking each tab switches to its environment.
- [ ] Each tab shows its own colour; the active tab is clearly marked.
- [ ] A changed colour updates the UI and survives an app restart.

**Open questions**
- Where colour choices persist (the turso DB vs. a small local settings file) is not specified — decide at build time and record it.

#### Page Skills
| Skill | Why it's needed | How the AI will use it | New for this page? |
|-------|------------------|--------------------------|----------------------|
| CSS-variable theming | Per-tab colours + user-customisable colours with no CSS framework. | One variable set per tab colour; a small colour-settings panel writes the variables. | Yes. |

---

## PLAN

**Summary:** Build the three-tab shell as the app's root view: tab bar, colour theming via CSS variables, and placeholder panels for the three environments. Keep it light — heavy panels (editor, terminal) lazy-load later.

**Changes:**
- Tab bar component (Product / Develop / Test) with per-tab colours from CSS variables; active tab accents its environment.
- Environment container that renders the active environment's panel (placeholders initially).
- Colour customisation persisted locally and reapplied at startup.
- Vitest: render, tab switching, colour persistence.

**Expected technical debt:** placeholder environment panels until the per-environment pages are built.

**Status:** translated — waiting for approval
