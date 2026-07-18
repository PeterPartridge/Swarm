# Page Spec — Workspace Shell

> Produced by `/translate` from [`../../CoperativeAI/workspaceShell.md`](../../CoperativeAI/workspaceShell.md). Project constraints: [`../Project_system.md`](../Project_system.md) → Project Digest.

**Objective** _(unchanging)_
The main window: a top menu of environment tabs — Product, Develop, Test, and (round 2) Admin — each with its own colour; clicking a tab enters that environment. Everything else in the app lives inside one of these environments.

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
- [x] App opens straight into the workspace with the tabs — no login screen.
- [x] Clicking each tab switches to its environment.
- [x] Each tab shows its own colour; the active tab is clearly marked.
- [x] A changed colour updates the UI and survives an app restart.
- [x] (round 2) Tabs are filtered to what the active member's role allows, falling back to the first visible tab.

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

**Status:** built — round 2 (2026-07-18)

---

## Round 2 — Admin tab + "Working as…" picker

**Behaviour:** a fourth tab, **Admin** (colour `#475569`), and an active-member picker beside the tabs. The active member's role decides which tabs are shown and which commercial fields appear on work items.

**Implemented:** `pages/WorkspaceShell.tsx` (fourth tab, `shell-topbar`, tabs filtered by `canAccess`, falls back to the first visible tab if the current one becomes hidden), `components/ActiveUserPicker.tsx`, `lib/permissions.tsx` (`PermissionProvider` / `usePermissions` / `canAccess` / `canSeeField`), `lib/theme.ts` + `TabBar.tsx` (the `admin` environment id and its colour). Active member persists as the `activeTeamMemberId` system setting.

**The safe default matters:** `ActivePermissions` returns **full access** when no active member is set, so an empty team or a fresh install never hides the app from its own user.

**Technical debt — read this before treating roles as security:** this is **visibility, not access control**. There is no authentication, and anyone at the keyboard can change the active member from the header, so a role cannot keep data from a person — only tidy the view. Hiding the cost fields does not stop the data reaching the frontend either: the work-item DTO carries every field regardless of role, and the gate is applied in React. Anything genuinely sensitive must not rely on this. Recorded the same way in [`../Project_system.md`](../Project_system.md).

**The placeholder panels are gone:** Product, Develop, Test, and Admin each render a real page as of the Test-area round, closing this brief's expected debt.
