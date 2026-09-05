// Thin wrapper over Tauri invoke so pages depend on one mockable module.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/** Opens the OS folder picker; returns the chosen path, or null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  const chosen = await open({ directory: true, multiple: false });
  return typeof chosen === "string" ? chosen : null;
}

/** Opens the OS file picker for UI mockups; returns the chosen paths. */
export async function pickImages(): Promise<string[]> {
  const chosen = await open({
    multiple: true,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
  });
  if (Array.isArray(chosen)) return chosen;
  return typeof chosen === "string" ? [chosen] : [];
}

export interface Product {
  id: number;
  name: string;
  answers: string;
}

export interface Solution {
  id: number;
  name: string;
  productId: number;
  solutionType: string;
  answers: string;
  origin: string; // "created" | "imported"
  githubUrl: string | null;
  githubVisibility: string | null; // "private" | "public" | null
  /** Where the code lives on this machine. Null until someone points at it —
   *  a linked GitHub repository is not the same as a working copy. */
  localPath: string | null;
  /** How to run this Solution's tests, when detection gets it wrong or the
   *  language is one nothing here recognises. Null means "work it out". */
  testCommand: string | null;
  /** The starter it was created from. A record of what it was begun as, not a
   *  claim about what it is now — repositories grow other languages. */
  language: string | null;
  /** Where each kind of thing lives in **this** working copy, as JSON:
   *  `{"screen":"src/pages"}`.
   *
   *  A convention an agent cannot reliably read out of the code, and what lets
   *  the build plan suggest the screens that already exist. Set in Develop →
   *  Solutions, beside the folder the paths are relative to. Empty means nobody
   *  has said, and nothing is scanned for that kind — never a licence to guess
   *  at a layout this repository may not follow. */
  kindLocations: string;
  /** How to start this Solution running, when detection gets it wrong. Null
   *  means "work it out". */
  runCommand: string | null;
  /** What to hand the **debugger** as the thing to start, relative to the
   *  working copy. Null means "work it out".
   *
   *  **Not the run command.** That is a shell line — `npm run dev` — and this
   *  is a path an adapter is pointed at: debugpy wants one `.py`, Delve a
   *  package folder, netcoredbg a built `.dll`. */
  startFrom: string | null;
}

export interface GithubStatus {
  connected: boolean;
}

// Developer Workspace — reading a Solution's working copy and reviewing it
export interface TreeEntry {
  /** Relative to the Solution's folder, forward slashes on every platform. */
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
}

export interface FileTree {
  entries: TreeEntry[];
  /** True when the walk stopped early — a partial tree must say so. */
  truncated: boolean;
}

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  addedLines: number;
  removedLines: number;
  diff: string;
}

export interface ReviewFinding {
  /** No `unlistedTech` here, unlike a solution strategy: that check needs the
   *  list of technologies a proposal *declares*, and a diff declares nothing.
   *  Inferring it from source text would be guesswork. */
  kind: "disallowedTech" | "noTests";
  /** Empty when the finding is about the change as a whole. */
  path: string;
  detail: string;
}

export interface ReviewReport {
  /** A rule was broken. */
  violations: ReviewFinding[];
  /** Worth attention, but not a breach. */
  notices: ReviewFinding[];
  filesChanged: number;
  addedLines: number;
  removedLines: number;
}

export interface ChangeReview {
  changes: FileChange[];
  report: ReviewReport;
  /** True when the Product has no developer rules, so nothing was checked —
   *  silence for want of rules reads exactly like silence for want of problems. */
  noRules: boolean;
  /** The unsettled handover this review was recorded against, when one exists.
   *  Keep/discard is offered on it — always, whatever the findings, but the
   *  findings travel with the run so accepting over a violation is recorded as
   *  exactly that. */
  runId: number | null;
  runState: string | null;
}

/** A work item assembled into one brief and written into its working copy.
 *
 *  There is no cost here, deliberately. Claude Code bills against its own
 *  subscription; this app's ledger meters the calls it makes itself, so any
 *  figure shown would be one the app cannot see. */
export interface Handover {
  runId: number;
  briefPath: string;
  brief: string;
  /** Shown, never executed. */
  command: string;
}

export const prepareHandover = (workItemId: number): Promise<Handover> =>
  invoke("prepare_handover", { workItemId });
/** The app cannot see whether a change was committed, so it records what it
 *  is told. */
export const settleChangeRun = (
  runId: number,
  state: "kept" | "discarded",
): Promise<void> => invoke("settle_change_run", { runId, state });

export const setSolutionPath = (
  solutionId: number,
  localPath: string | null,
): Promise<void> => invoke("set_solution_path", { solutionId, localPath });
export const readSolutionTree = (solutionId: number): Promise<FileTree> =>
  invoke("read_solution_tree", { solutionId });
export const readSolutionFile = (
  solutionId: number,
  path: string,
): Promise<string> => invoke("read_solution_file", { solutionId, path });
/** Saves an edited file. Refused outside the Solution's folder or under
 *  `.git` — a write into `.git/config` would change what the repository is. */
export const writeSolutionFile = (
  solutionId: number,
  path: string,
  contents: string,
): Promise<void> => invoke("write_solution_file", { solutionId, path, contents });
/** Creates a new empty file. Refused outside the Solution's folder, under
 *  `.git`, or where the parent folder does not exist. */
export const createSolutionFile = (
  solutionId: number,
  path: string,
): Promise<void> => invoke("create_solution_file", { solutionId, path });

/** What the coding pal said. A replacement never touches disk by itself — it
 *  goes into the editor buffer, and your own save is the gate. */
export interface PalAnswer {
  explanation: string;
  replacement: string;
  /** Forbidden technologies found in the proposal — shown before you apply. */
  violations: string[];
  provider: string;
  model: string;
  reason: string;
  blocked: Blocked | null;
}

export type PalAction = "explain" | "refactor" | "docs" | "tests";

export const PAL_ACTION_LABELS: Record<PalAction, string> = {
  explain: "Explain this",
  refactor: "Refactor",
  docs: "Document it",
  tests: "Draft tests",
};

export const askCodingPal = (args: {
  solutionId: number;
  path: string;
  action: PalAction;
  instruction: string;
  selection: string | null;
}): Promise<PalAnswer> => invoke("ask_coding_pal", args);
/** What has changed and how it reads against the rules.
 *
 *  **Give it the run when reviewing an agent.** A run works in its own
 *  checkout, so reviewing the Solution's folder instead reports "nothing has
 *  changed" while the work sits finished in a worktree next door. Without a run
 *  it reviews your own workspace, which is a real thing to review. */
export const reviewSolutionChanges = (
  solutionId: number,
  runId?: number,
): Promise<ChangeReview> =>
  invoke("review_solution_changes", { solutionId, runId });

export interface TeamMember {
  id: number;
  name: string;
  roleId: number | null;
}

export interface Role {
  id: number;
  name: string;
  canProduct: boolean;
  canDevelop: boolean;
  canTest: boolean;
  canAdmin: boolean;
  seeCost: boolean;
  seeProfit: boolean;
  seeChargeable: boolean;
  /** May set AI budgets and the provider chain — separate from seeing spend. */
  canManageBudget: boolean;
  /** The Marketing and Design screens — separate from canProduct, because a
   *  developer often needs Planning without campaign drafts, and a marketer
   *  the reverse. */
  canMarketing: boolean;
  canDesign: boolean;
}

export interface Deliverable {
  id: number;
  productId: number;
  name: string;
  description: string;
  /** What this deliverable waits on. Kept acyclic by the backend. */
  dependsOnDeliverableId: number | null;
}

/** Sets what a deliverable waits on, or clears it with null. The backend
 *  refuses anything that would make the plan circular. */
export const setDeliverableDependency = (
  id: number,
  dependsOn: number | null,
): Promise<void> => invoke("set_deliverable_dependency", { id, dependsOn });

export interface TestCase {
  id: number;
  productId: number;
  title: string;
  scenario: string;
  state: string; // "designed" | "implemented"
  testPath: string | null;
  deliverableId: number | null;
  workItemId: number | null;
  /** The names of the tests in `testPath`, as their runner prints them.
   *  Recorded when the AI writes the test; empty for a hand-written one. */
  testNames: string[];
  lastRunAt: number | null;
  /** "passed" | "failed" | "skipped" | "errored", or null if never run. */
  lastRunOutcome: string | null;
  lastRunSummary: string | null;
  /** Whether this scenario is in the regression suite — the set run to prove
   *  the product still works, rather than to prove one change. */
  regression: boolean;
}

/** The active user's effective permissions (full access when no active user). */
export interface ActivePermissions {
  memberId: number | null;
  role: Role | null;
  canProduct: boolean;
  canDevelop: boolean;
  canTest: boolean;
  canAdmin: boolean;
  seeCost: boolean;
  seeProfit: boolean;
  seeChargeable: boolean;
  canManageBudget: boolean;
  canMarketing: boolean;
  canDesign: boolean;
}

export interface Sprint {
  id: number;
  productId: number;
  name: string;
  startDate: number | null;
  endDate: number | null;
}

export interface WorkItem {
  id: number;
  title: string;
  itemType: string;
  status: string;
  description: string | null;
  productId: number;
  parentItemId: number | null;
  assigneeId: number | null;
  sprintId: number | null;
  startDate: number | null;
  endDate: number | null;
  deliverableId: number | null;
  expectedCost: number | null;
  estimatedProfit: number | null;
  chargeable: boolean;
  customerCoverPct: number | null;
  /** Free text — what could go wrong, in the planner's own words. */
  risk: string;
  /** The Solution this work touches, and so the repository it lands in.
   *  Null for the plenty of work that is not code. */
  solutionId: number | null;
}

/** A dependency between two work items. When their Solutions differ this is a
 *  cross-repo dependency — derived from `solutionId`, never stored twice. */
export interface WorkItemLink {
  id: number;
  fromWorkItemId: number;
  toWorkItemId: number;
  kind: WorkItemLinkKind;
}

/** `blocks` orders work and must stay acyclic; `relatesTo` implies no order. */
export type WorkItemLinkKind = "blocks" | "relatesTo";

export const WORK_ITEM_LINK_KINDS: WorkItemLinkKind[] = ["blocks", "relatesTo"];

export interface Repository {
  id: number;
  name: string;
  localPath: string;
  isActive: boolean;
}

export interface AiProvider {
  id: number;
  name: string;
  apiBaseUrl: string;
  models: string[];
  keyStored: boolean;
  /** "anthropic" (metered API, needs credits) | "ollama" (local, free) |
   *  "claudeCode" (the CLI on this machine, on your own subscription). For
   *  claudeCode, `apiBaseUrl` holds the executable rather than a URL — a CLI has
   *  no endpoint. */
  kind: string;
  metered: boolean;
}

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

/** Money is carried in micropence (millionths of a penny) so token pricing is
 *  exact — see db/ai_usage.rs. Use `formatMoney` for display. */
export interface ProductBudget {
  productId: number;
  totalBudgetMicropence: number;
  aiBudgetMicropence: number;
  tokenLimit: number;
  warnPct: number;
  handoverPct: number;
  hardStopPct: number;
  periodDays: number;
  providerChain: number[];
}

export interface SpendSummary {
  spentMicropence: number;
  spentTokens: number;
  calls: number;
  aiBudgetMicropence: number;
  tokenLimit: number;
  usedPct: number;
  /** "none" | "ok" | "warn" | "handover" | "blocked" — decided by the router. */
  state: string;
  activeProvider: string | null;
  reason: string;
  periodStart: number;
}

export interface ModelPrice {
  id: number;
  providerId: number;
  model: string;
  inputPencePerMtok: number;
  outputPencePerMtok: number;
  tokensPerSecond: number;
}

/** £ from micropence. 100 pence = £1, and a penny is 1e6 micropence. */
export const formatMoney = (micropence: number): string =>
  `£${(micropence / 100_000_000).toFixed(2)}`;

/** Micropence from a pounds string typed into a form. */
export const poundsToMicropence = (pounds: string): number =>
  Math.round((Number(pounds) || 0) * 100_000_000);

export const micropenceToPounds = (micropence: number): string =>
  (micropence / 100_000_000).toFixed(2);

export interface WorkItemPolicy {
  workItemId: number;
  allowRead: boolean;
  allowEdit: boolean;
  allowGenerateTests: boolean;
  providerId: number | null;
  effortTier: string;
}

/** Product-level AI policy — gates Deliverable planning. Coarser than a
 *  work-item policy: allowing it covers every Deliverable of the Product. */
export interface ProductPolicy {
  productId: number;
  allowRead: boolean;
  allowGenerate: boolean;
  /** May the AI change this Product's work — code, plans, schemas?
   *
   *  Here since permission moved up from the work item: it was granted per
   *  item, so a new item was denied until somebody permitted it individually
   *  and permission had to be granted again for every item, forever. */
  allowEdit: boolean;
  /** May the AI write tests for this Product's work? */
  allowGenerateTests: boolean;
  providerId: number | null;
  effortTier: string;
}

/** How hard a job is, cheapest first — mirrors `work_item_policy::EFFORT_TIERS`.
 *
 *  Three, because "harder than high" is an *effort*, not a complexity. This
 *  briefly carried six; extra, max and ultra were borrowed from Claude's own
 *  effort levels, which is where they belong — see `EFFORT_LEVELS`. The
 *  ceiling they were meant to lift was on effort all along. */
export const EFFORT_TIERS = ["low", "medium", "high"] as const;

/** Suggested defaults for the AI Settings form (Claude first, pluggable).
 *  Models are listed **cheapest first** — the effort tier indexes into this
 *  order, so reversing it would make every low-effort task use the dearest
 *  model. See ai/tiering.rs. */
export const DEFAULT_PROVIDER = {
  name: "Claude",
  apiBaseUrl: "https://api.anthropic.com",
  models: "claude-haiku-4-5-20251001, claude-sonnet-5, claude-opus-4-8",
};

export const STATUSES = [
  "planned",
  "designing",
  "building",
  "testing",
  "done",
] as const;

export const ANY_LEVEL_TYPES = ["bug", "test"] as const;

export const HIERARCHY_PRESETS: { label: string; value: string[] }[] = [
  {
    label: "Epics → Features → User Stories → Tasks",
    value: ["epic", "feature", "userStory", "task"],
  },
  {
    label: "Features → User Stories → Tasks",
    value: ["feature", "userStory", "task"],
  },
  { label: "Features → Tasks", value: ["feature", "task"] },
];

export const ROADMAP_MODES = ["sprints", "kanban"] as const;

export const TEAM_ROLES = ["Developer", "QA", "Product", "Designer"] as const;

export const SOLUTION_TYPES = [
  "website",
  "api",
  "database",
  "application",
] as const;

/** The whole Product brief. Edited in Strategy, because thinking about a
 *  Product is strategy — the creation card only asks enough to start. */
export const PRODUCT_QUESTIONS: { id: string; label: string }[] = [
  { id: "purpose", label: "In one or two sentences, what is the purpose of this product?" },
  { id: "problem", label: "What problem does it solve, and for whom?" },
  { id: "users", label: "Who is the customer?" },
  { id: "commercialModel", label: "What is the commercial model?" },
  { id: "roadmap", label: "What is the long-term roadmap?" },
  { id: "constraints", label: "What are the constraints?" },
  { id: "risks", label: "What are the risks?" },
  { id: "appsYouLike", label: "Are there any apps or websites you like?" },
  { id: "appsToAvoid", label: "Are there any apps or websites you want to avoid copying?" },
  { id: "designs", label: "Any designs, sketches, or look-and-feel notes?" },
];

/** What the Add-a-Product card asks. Deliberately short: a Product should be
 *  cheap to start, and answering ten questions before it exists is how a
 *  planning tool becomes a form nobody fills in. The rest is Strategy's job. */
export const CREATE_PRODUCT_QUESTIONS = PRODUCT_QUESTIONS.filter((q) =>
  ["purpose", "problem", "users"].includes(q.id),
);

/** Saves brief answers edited in Strategy after the Product exists. */
export const updateProductAnswers = (
  id: number,
  answers: string,
): Promise<void> => invoke("update_product_answers", { id, answers });

/** The solution-spec questions the Develop tab's Solution card asks. */
export const SOLUTION_QUESTIONS: { id: string; label: string }[] = [
  { id: "purpose", label: "What is the purpose of this solution?" },
  { id: "hosting", label: "Where will it be hosted, deployed, or distributed?" },
  { id: "language", label: "What language will it use?" },
  { id: "frameworks", label: "What frameworks, libraries, or UI toolkit should it use?" },
];

/** Structured fields for each strategy area (product fields live in ProductStrategy). */
/** A field in a structured strategy. `lead` marks the one drawn first and large
 *  as the standing direction the rest are written under — a property of the
 *  field list, so the editor does not have to be told which by name. */
export interface StrategyField {
  id: string;
  label: string;
  lead?: boolean;
}

export const DEVELOP_STRATEGY_FIELDS: StrategyField[] = [
  { id: "infrastructure", label: "Required infrastructure" },
  { id: "architecture", label: "Architecture requirements", lead: true },
  { id: "solutionGuidelines", label: "Solution creation guidelines" },
  { id: "dependencies", label: "Dependencies / environment prerequisites" },
  // Defaults for every work item's per-Solution plan, so the team's branch
  // convention is applied rather than retyped differently by each person.
  {
    id: "branchPattern",
    label: "Branch naming pattern — {id}, {title} and {type} are filled in",
  },
  { id: "defaultCloneFrom", label: "Branches are cut from" },
];

/** What one work item requires of one Solution it touches. The written half is
 *  the team's; the schema half is generated from it. */
export interface WorkItemPlan {
  id: number;
  workItemId: number;
  solutionId: number;
  solutionName: string;
  changesRequired: string;
  unitTests: string;
  branchName: string;
  cloneFrom: string;
  /** JSON array of file paths — UI mockups. */
  mockups: string;
  apiSchema: string;
  pageSchema: string;
  filesToChange: string;
  /** When somebody read this plan and agreed to it; 0 for not yet.
   *
   *  A run refuses to start without it, and editing or regenerating the plan
   *  sets it back to 0 — so it is consent to *this* version, not an earlier one. */
  approvedAt: number;
}

export const listWorkItemPlans = (workItemId: number): Promise<WorkItemPlan[]> =>
  invoke("list_work_item_plans", { workItemId });

/** Approves the plan for one (work item, Solution) pair, or withdraws approval.
 *
 *  Withdrawing after a run has started does not stop that agent — it is already
 *  working in its own checkout — it only refuses the next start. */
export const setPlanApproval = (
  workItemId: number,
  solutionId: number,
  approved: boolean,
): Promise<void> =>
  invoke("set_plan_approval", { workItemId, solutionId, approved });
/** Marks a Solution as affected, prefilling branch and clone-from from the
 *  Develop Strategy. Attaching one already attached changes nothing. */
export const attachSolutionToWorkItem = (
  workItemId: number,
  solutionId: number,
): Promise<number> =>
  invoke("attach_solution_to_work_item", { workItemId, solutionId });
export const saveWorkItemPlan = (args: {
  id: number;
  changesRequired: string;
  unitTests: string;
  branchName: string;
  cloneFrom: string;
  mockups: string;
}): Promise<void> => invoke("save_work_item_plan", args);
export const detachWorkItemPlan = (id: number): Promise<void> =>
  invoke("detach_work_item_plan", { id });
/** Turns what the team wrote into API and page schemas per Solution.
 *
 *  `instruction` is what a reviewer asked to be different about the plan they
 *  are reading. With it the model is shown the current plan and told to keep
 *  the rest, so "use anyhow instead" changes one thing rather than everything. */
export const generateChangePlan = (
  workItemId: number,
  instruction?: string,
): Promise<GenerationResult> =>
  invoke("generate_change_plan", { workItemId, instruction });

/** A reviewer's own edit to the generated plan. Withdraws approval, exactly as
 *  regenerating does — consent belongs to the version that was read. */
export const savePlanSchemas = (args: {
  id: number;
  apiSchema: string;
  pageSchema: string;
  filesToChange: string;
}): Promise<void> => invoke("save_plan_schemas", args);

export const TEST_STRATEGY_FIELDS: { id: string; label: string }[] = [
  { id: "testPlans", label: "Test plans" },
  { id: "testEnvironments", label: "Test environments" },
  { id: "tooling", label: "Required tooling" },
  { id: "testLinks", label: "Links to test cases / automated suites" },
];

export const DEV_VIEWS = ["board", "sprint", "list"] as const;

// Products
export const listProducts = (): Promise<Product[]> => invoke("list_products");
export const createProduct = (
  name: string,
  answers: string,
  scaffoldDir?: string,
): Promise<number> =>
  invoke("create_product", { name, answers, scaffoldDir: scaffoldDir ?? null });
export const getProduct = (id: number): Promise<Product> =>
  invoke("get_product", { id });
/** What happened to each generated framework file. `conflicts` are files
 *  changed on disk since the app wrote them (or never written by it) — they are
 *  left exactly as they are, never overwritten. */
export interface EmitReport {
  written: string[];
  unchanged: string[];
  conflicts: string[];
}

/** Writes the Product's framework files (solution specs, page briefs) into its
 *  scaffold folder, so the framework governs what the app holds. */
export const generateFrameworkFiles = (
  productId: number,
): Promise<EmitReport> => invoke("generate_framework_files", { productId });

export const getProductScaffold = (name: string): Promise<string | null> =>
  invoke("get_product_scaffold", { name });
export const deleteProduct = (id: number): Promise<void> =>
  invoke("delete_product", { id });

// Solutions
export const listSolutions = (): Promise<Solution[]> => invoke("list_solutions");
export const createSolution = (args: {
  name: string;
  productId: number;
  solutionType: string;
  answers: string;
}): Promise<number> => invoke("create_solution", args);
export const deleteSolution = (id: number): Promise<void> =>
  invoke("delete_solution", { id });

// GitHub (token lives in the OS credential store — never returned)
export const githubStatus = (): Promise<GithubStatus> =>
  invoke("github_status");
export const setGithubToken = (token: string): Promise<string> =>
  invoke("set_github_token", { token });
export const removeGithubToken = (): Promise<void> =>
  invoke("remove_github_token");
export const linkSolutionRepo = (solutionId: number, url: string): Promise<void> =>
  invoke("link_solution_repo", { solutionId, url });

/** One Solution's git situation: the folder on this machine and the repository
 *  on GitHub, which are two different questions with two different fixes. */
export interface SolutionGitState {
  localPath: string | null;
  isRepo: boolean;
  /** A repository with no commit still cannot be branched from, so a run
   *  cannot start from it. */
  hasCommit: boolean;
  branch: string;
  githubUrl: string | null;
  githubVisibility: string | null;
}

export const solutionGitState = (solutionId: number): Promise<SolutionGitState> =>
  invoke("solution_git_state", { solutionId });

/** `git init` plus a first commit, so the folder is one a run can branch from.
 *  Returns what it found and did, in a sentence to show. */
export const initSolutionRepo = (solutionId: number): Promise<string> =>
  invoke("init_solution_repo", { solutionId });
export const createSolutionRepo = (args: {
  solutionId: number;
  repoName: string;
  private: boolean;
  description: string;
}): Promise<string> => invoke("create_solution_repo", args);

// Team members (roles assigned in the Admin area)
export const listTeamMembers = (): Promise<TeamMember[]> =>
  invoke("list_team_members");
export const addTeamMember = (
  name: string,
  roleId: number | null,
): Promise<number> => invoke("add_team_member", { name, roleId });
export const setMemberRole = (id: number, roleId: number | null): Promise<void> =>
  invoke("set_member_role", { id, roleId });
export const removeTeamMember = (id: number): Promise<void> =>
  invoke("remove_team_member", { id });

// Roles + active-user permission gate
export const listRoles = (): Promise<Role[]> => invoke("list_roles");
export const createRole = (name: string): Promise<number> =>
  invoke("create_role", { name });
export const updateRole = (role: Role): Promise<void> =>
  invoke("update_role", {
    id: role.id,
    canProduct: role.canProduct,
    canDevelop: role.canDevelop,
    canTest: role.canTest,
    canAdmin: role.canAdmin,
    seeCost: role.seeCost,
    seeProfit: role.seeProfit,
    seeChargeable: role.seeChargeable,
    canManageBudget: role.canManageBudget,
    canMarketing: role.canMarketing,
    canDesign: role.canDesign,
  });
export const deleteRole = (id: number): Promise<void> =>
  invoke("delete_role", { id });
export const getActiveMember = (): Promise<number | null> =>
  invoke("get_active_member");
export const setActiveMember = (id: number | null): Promise<void> =>
  invoke("set_active_member", { id });
export const getActivePermissions = (): Promise<ActivePermissions> =>
  invoke("get_active_permissions");

// Deliverables (Product strategy)
export const listDeliverables = (productId: number): Promise<Deliverable[]> =>
  invoke("list_deliverables", { productId });
export const createDeliverable = (args: {
  productId: number;
  name: string;
  description: string;
}): Promise<number> => invoke("create_deliverable", args);
export const deleteDeliverable = (id: number): Promise<void> =>
  invoke("delete_deliverable", { id });

// Marketing & Design
export interface DesignAsset {
  id: number;
  productId: number;
  kind: DesignAssetKind;
  name: string;
  content: string;
  /** Decided by the kind, not the caller — tokens are JSON, flows are Mermaid. */
  format: "json" | "mermaid" | "markdown";
  figmaFileKey: string | null;
  figmaNodeId: string | null;
}

export type DesignAssetKind =
  | "tokens"
  | "uiFlow"
  | "componentDiagram"
  | "wireframe"
  | "brandGuidelines"
  | "campaign"
  | "launchPlan"
  | "messaging";

export const DESIGN_ASSET_LABELS: Record<DesignAssetKind, string> = {
  tokens: "Design tokens",
  uiFlow: "User flow",
  componentDiagram: "Component diagram",
  wireframe: "Wireframe",
  brandGuidelines: "Brand guidelines",
  campaign: "Campaign idea",
  launchPlan: "Launch plan",
  messaging: "Messaging",
};

/** Which kinds belong on which screen — one Product's assets serve both. */
export const MARKETING_ASSET_KINDS: DesignAssetKind[] = [
  "campaign",
  "launchPlan",
  "messaging",
];

/** A Figma file reduced to what a designer would describe out loud. The raw
 *  document runs to megabytes; this is what makes it affordable to show an AI. */
export interface FigmaFile {
  fileKey: string;
  name: string;
  pages: FigmaPage[];
  components: string[];
  styles: string[];
  /** Exactly what would be sent to a model, so the cost is visible up front. */
  promptPreview: string;
}

export interface FigmaPage {
  name: string;
  frames: string[];
  textCount: number;
  /** True when copy was left out to stay within the cap. */
  textTruncated: boolean;
}

export const listDesignAssets = (productId: number): Promise<DesignAsset[]> =>
  invoke("list_design_assets", { productId });
export const saveDesignAsset = (
  productId: number,
  kind: DesignAssetKind,
  name: string,
  content: string,
): Promise<number> =>
  invoke("save_design_asset", { productId, kind, name, content });
export const deleteDesignAsset = (id: number): Promise<void> =>
  invoke("delete_design_asset", { id });
/** Writes the design assets to files under `design/`. On any Figma plan below
 *  Enterprise this is the only route design tokens have into Figma, so it is a
 *  first-class action rather than a fallback. Returns the paths written. */
export const emitDesignFiles = (productId: number): Promise<string[]> =>
  invoke("emit_design_files", { productId });

// Figma (token lives in the OS credential store — never returned)
export const figmaStatus = (): Promise<{ connected: boolean }> =>
  invoke("figma_status");
export const setFigmaToken = (token: string): Promise<string> =>
  invoke("set_figma_token", { token });
export const clearFigmaToken = (): Promise<void> => invoke("clear_figma_token");
export const readFigmaFile = (fileRef: string): Promise<FigmaFile> =>
  invoke("read_figma_file", { fileRef });
/** Enterprise-only at Figma's end — fails with an explanation naming the plan
 *  on any lesser one. */
export const pushDesignTokens = (
  assetId: number,
  fileRef: string,
  collectionName: string,
): Promise<void> =>
  invoke("push_design_tokens", { assetId, fileRef, collectionName });
export const postFigmaComment = (
  fileRef: string,
  message: string,
): Promise<void> => invoke("post_figma_comment", { fileRef, message });

export const generateDesignStrategy = (args: {
  productId: number;
  area: "marketing" | "design";
  brief: string;
  figmaFileRef: string | null;
}): Promise<GenerationResult> => invoke("generate_design_strategy", args);

// Developer Planning — architecture documents and how Solutions depend on each other
export interface ArchitectureDoc {
  id: number;
  productId: number;
  /** Null means the document is about the Product as a whole. */
  solutionId: number | null;
  kind: ArchitectureDocKind;
  name: string;
  content: string;
  format: DiagramFormat;
}

export type ArchitectureDocKind =
  | "systemInteraction"
  | "componentMap"
  | "apiContract"
  | "eventFlow"
  | "infrastructure";

export type DiagramFormat = "mermaid" | "drawio" | "plantuml" | "jsonGraph";

export const ARCHITECTURE_KIND_LABELS: Record<ArchitectureDocKind, string> = {
  systemInteraction: "System interaction",
  componentMap: "Component map",
  apiContract: "API contract",
  eventFlow: "Event flow",
  infrastructure: "Infrastructure",
};

/** `drawio` sits beside the text notations because an infrastructure diagram is
 *  an architecture document like any other — the notation is a rendering choice,
 *  not a different kind of thing. Mermaid renders inline; draw.io is stored and
 *  also written as a `.drawio` file the real editor can open. */
export const DIAGRAM_FORMATS: DiagramFormat[] = [
  "mermaid",
  "drawio",
  "plantuml",
  "jsonGraph",
];

export const DIAGRAM_FORMAT_LABELS: Record<string, string> = {
  mermaid: "Mermaid (renders here)",
  drawio: "draw.io (opens in draw.io)",
  plantuml: "PlantUML",
  jsonGraph: "JSON graph",
};

/** How two of a Product's Solutions — and so two repositories — depend on
 *  each other. `buildsOn` orders work and must stay acyclic; the rest describe
 *  runtime, where mutual dependence is a real and workable arrangement. */
export interface RepoLink {
  id: number;
  fromSolutionId: number;
  toSolutionId: number;
  kind: RepoLinkKind;
  notes: string;
}

export type RepoLinkKind = "callsApi" | "sharesSchema" | "publishesEvent" | "buildsOn";

export const REPO_LINK_LABELS: Record<RepoLinkKind, string> = {
  callsApi: "calls the API of",
  sharesSchema: "shares a schema with",
  publishesEvent: "publishes events to",
  buildsOn: "builds on",
};

export const listArchitectureDocs = (
  productId: number,
): Promise<ArchitectureDoc[]> =>
  invoke("list_architecture_docs", { productId });
export const saveArchitectureDoc = (args: {
  productId: number;
  solutionId: number | null;
  kind: ArchitectureDocKind;
  name: string;
  content: string;
  format: DiagramFormat;
}): Promise<number> => invoke("save_architecture_doc", args);
export const deleteArchitectureDoc = (id: number): Promise<void> =>
  invoke("delete_architecture_doc", { id });

export const listRepoLinks = (productId: number): Promise<RepoLink[]> =>
  invoke("list_repo_links", { productId });
export const linkSolutions = (
  fromSolutionId: number,
  toSolutionId: number,
  kind: RepoLinkKind,
  notes: string,
): Promise<number> =>
  invoke("link_solutions", { fromSolutionId, toSolutionId, kind, notes });
export const unlinkSolutions = (id: number): Promise<void> =>
  invoke("unlink_solutions", { id });
/** What a change to this Solution would reach, at any depth — the question the
 *  cross-repo map exists to answer. */
export const solutionsReachedBy = (solutionId: number): Promise<number[]> =>
  invoke("solutions_reached_by", { solutionId });

export const generateArchitectureDoc = (args: {
  productId: number;
  solutionId: number | null;
  kind: ArchitectureDocKind;
  format: DiagramFormat;
  brief: string;
}): Promise<GenerationResult> => invoke("generate_architecture_doc", args);

// Strategy (structured document per product + area)
export const getStrategy = (productId: number, area: string): Promise<string> =>
  invoke("get_strategy", { productId, area });
export const saveStrategy = (
  productId: number,
  area: string,
  content: string,
): Promise<void> => invoke("save_strategy", { productId, area, content });

// Test cases (Test area) — associated with a Deliverable or a Work Item
export const TEST_STATES = ["designed", "implemented"] as const;

export const listTestCases = (productId: number): Promise<TestCase[]> =>
  invoke("list_test_cases", { productId });
export const createTestCase = (args: {
  productId: number;
  title: string;
  scenario: string;
  deliverableId: number | null;
  workItemId: number | null;
}): Promise<number> => invoke("create_test_case", args);
/** Puts a scenario in the regression suite, or takes it out. Nothing infers
 *  this: the same spec can be a one-off check or the thing guarding checkout
 *  for two years, and only a person can say which. */
export const setTestCaseRegression = (
  id: number,
  regression: boolean,
): Promise<void> => invoke("set_test_case_regression", { id, regression });

export const updateTestCase = (args: {
  id: number;
  title: string;
  scenario: string;
  state: string;
  testPath: string | null;
  deliverableId: number | null;
  workItemId: number | null;
}): Promise<void> => invoke("update_test_case", args);
export const deleteTestCase = (id: number): Promise<void> =>
  invoke("delete_test_case", { id });

/** What implementing a QA scenario produced. */
export interface TestImplementationResult {
  /** Where the test was written, relative to the Solution's working copy.
   *  Empty when the AI declined. */
  testPath: string;
  provider: string;
  model: string;
  reason: string;
  /** Set when the AI declined rather than writing a test that asserts
   *  nothing — a question is then waiting against the work item. */
  blocked: Blocked | null;
}

/** Asks the AI to implement one scenario as a real test file. Gated on the
 *  associated **work item's** policy allowing test generation — a case with no
 *  work item is refused by the backend, so the button is disabled for one. */
export const implementTestCase = (
  testCaseId: number,
): Promise<TestImplementationResult> =>
  invoke("implement_test_case", { testCaseId });

/** What running a scenario's test produced. */
export interface TestRunResult {
  /** "passed" | "failed" | "skipped" | "errored". */
  outcome: string;
  summary: string;
  /** **Whether this verdict is about this scenario's own tests.** False means
   *  the whole suite ran and nothing could be attributed to this scenario, so
   *  the outcome is the suite's — it may be red for unrelated reasons. */
  aboutThisTest: boolean;
  narrowed: boolean;
  commandLine: string;
  /** The runner's full output. Returned for reading, never stored. */
  output: string;
  durationMs: number;
}

/** Runs the test written for one scenario and records how it went.
 *
 *  Not an AI call — no provider, no policy, no spend. A failure is not an
 *  error: before the work is built, red is the expected result. */
export const runTestCase = (testCaseId: number): Promise<TestRunResult> =>
  invoke("run_test_case", { testCaseId });

/** What one person has available in a sprint, beside what they have been
 *  given. `assignedItems` is a count of work items, not estimated effort —
 *  work items carry no estimate, so this is a weak signal shown honestly
 *  rather than arithmetic that looks precise. */
export interface MemberLoad {
  teamMemberId: number;
  capacity: number;
  assignedItems: number;
}

export const getSprintLoad = (sprintId: number): Promise<MemberLoad[]> =>
  invoke("get_sprint_load", { sprintId });
export const setSprintCapacity = (
  sprintId: number,
  teamMemberId: number,
  capacity: number,
): Promise<number> =>
  invoke("set_sprint_capacity", { sprintId, teamMemberId, capacity });

// Sprints
export const listSprints = (productId: number): Promise<Sprint[]> =>
  invoke("list_sprints", { productId });
export const createSprint = (args: {
  productId: number;
  name: string;
  startDate?: number | null;
  endDate?: number | null;
}): Promise<number> => invoke("create_sprint", args);
export const removeSprint = (id: number): Promise<void> =>
  invoke("remove_sprint", { id });

// Settings
export const getPlanningHierarchy = (): Promise<string[]> =>
  invoke("get_planning_hierarchy");
export const setPlanningHierarchy = (hierarchy: string[]): Promise<void> =>
  invoke("set_planning_hierarchy", { hierarchy });
export const getRoadmapMode = (): Promise<string> => invoke("get_roadmap_mode");
export const setRoadmapMode = (mode: string): Promise<void> =>
  invoke("set_roadmap_mode", { mode });

// Work items
export const listWorkItems = (productId: number): Promise<WorkItem[]> =>
  invoke("list_work_items", { productId });

/** One work item by id, for a screen that has an id and nothing else — a
 *  pulled-out window opened from a URL. Null when it is gone: an id in a URL
 *  can outlive the row it names. */
export const getWorkItem = (workItemId: number): Promise<WorkItem | null> =>
  invoke("get_work_item", { workItemId });
export const createWorkItem = (args: {
  title: string;
  itemType: string;
  productId: number;
  parentItemId?: number | null;
  description?: string;
}): Promise<number> => invoke("create_work_item", args);
export const setWorkItemDescription = (
  id: number,
  description: string,
): Promise<void> => invoke("set_work_item_description", { id, description });

export const updateWorkItemStatus = (id: number, status: string): Promise<void> =>
  invoke("update_work_item_status", { id, status });
export const updateWorkItem = (args: {
  id: number;
  assigneeId: number | null;
  sprintId: number | null;
  startDate: number | null;
  endDate: number | null;
  deliverableId: number | null;
  expectedCost: number | null;
  estimatedProfit: number | null;
  chargeable: boolean;
  customerCoverPct: number | null;
  risk: string;
  solutionId: number | null;
}): Promise<void> => invoke("update_work_item", args);
export const deleteWorkItem = (id: number): Promise<void> =>
  invoke("delete_work_item", { id });
/** Every link out of this Product's items — one call for a whole board. */
export const listWorkItemLinks = (productId: number): Promise<WorkItemLink[]> =>
  invoke("list_work_item_links", { productId });
export const linkWorkItems = (
  fromWorkItemId: number,
  toWorkItemId: number,
  kind: WorkItemLinkKind,
): Promise<number> =>
  invoke("link_work_items", { fromWorkItemId, toWorkItemId, kind });
export const unlinkWorkItems = (id: number): Promise<void> =>
  invoke("unlink_work_items", { id });
/** What a generation produced, and which provider actually ran it. `reason`
 *  explains the routing — it says so when a budget handed the work to a local
 *  model, because that changes the quality of what comes back. */
export interface GenerationResult {
  created: string[];
  provider: string;
  model: string;
  reason: string;
  /** Set when the AI declined rather than guessing — `created` is then empty
   *  and a question is waiting to be answered. */
  blocked: Blocked | null;
}

export interface Blocked {
  reason: string;
  whatIsNeeded: string;
  /** 0 when there was no work item to record it against (deliverables). */
  feedbackId: number;
}

/** A question the AI raised against a work item rather than guessing. */
export interface AiFeedback {
  id: number;
  workItemId: number;
  kind: string;
  message: string;
  whatIsNeeded: string;
  resolved: boolean;
  resolvedNote: string;
}

/** Constraints developers put on the AI. `disallowedTech` is enforced: it is
 *  stated as a prohibition in the prompt and the answer is checked against it. */
export interface DeveloperRules {
  productId: number;
  codingStandards: string;
  architecturePrinciples: string;
  maintainability: string;
  preferredFrameworks: string;
  allowedTech: string;
  disallowedTech: string;
  aiConstraints: string;
  /** The MCP servers an agent may use.
   *
   *  A constraint, not a setting: an agent that can reach any server it likes
   *  can read and write things nobody agreed to, so the list travels with the
   *  rules it is given. Blank is stated to the agent as "none named" rather
   *  than left silent — silence reads as permission. */
  mcpServers: string;
}

export interface SolutionStrategy {
  workItemId: number;
  strategy: string;
  /** JSON array of {name, kind, rationale, tradeoffs}. */
  architectureOptions: string;
  chosenOptionIndex: number | null;
  techStack: string;
  /** Forbidden technologies found in the AI's own output — a rule is broken. */
  ruleViolations: string[];
  /** Technologies not on the allow list. Not a rule break: an allow list of
   *  languages does not forbid a queue or a cloud service, so this is a
   *  question for a person rather than a violation. */
  unlistedTech: string[];
}

export interface ArchitectureOption {
  name: string;
  kind: string;
  rationale: string;
  tradeoffs: string;
}

/** The rule fields, all of which are a box of prose.
 *
 *  These are the team's rules — how people work — not one repository's. Where
 *  things live used to be here and is now on the Solution: it is a fact about a
 *  working copy, a Product grows more than one, and it was Develop's decision
 *  sitting in a Product-shaped store. */
export type DeveloperRuleField = Exclude<keyof DeveloperRules, "productId">;

/** Reads a Solution's locations blob into a map, tolerating anything that is
 *  not one. */
export const kindLocations = (json: string): Record<string, string> => {
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
};

/** One thing that appears to exist already, and how the app came to think so. */
export interface Suggestion {
  name: string;
  /** "recorded", or the folder it was found in. **The provenance is shown**:
   *  a name read off the disk is a guess about what the team calls that screen,
   *  and a guess presented as fact is how a plan names a file rather than a
   *  feature. */
  foundIn: string;
}

/** What already exists of one kind in a Solution — the team's own recorded
 *  names first, then whatever is in the folder the Develop rules put that kind
 *  in. Nothing is scanned when the rules say nothing about the kind. */
export const suggestChangeNames = (
  solutionId: number,
  kind: ChangeKind,
): Promise<Suggestion[]> => invoke("suggest_change_names", { solutionId, kind });

export const DEVELOPER_RULE_FIELDS: { id: DeveloperRuleField; label: string }[] = [
  { id: "codingStandards", label: "Coding standards" },
  { id: "architecturePrinciples", label: "Architecture principles" },
  { id: "maintainability", label: "Maintainability rules" },
  { id: "preferredFrameworks", label: "Preferred frameworks" },
  { id: "allowedTech", label: "Allowed technologies" },
  { id: "disallowedTech", label: "Disallowed technologies (enforced)" },
  { id: "aiConstraints", label: "Constraints on AI behaviour" },
];

/** A model the platform has seen, and whether it may be used.
 *  `detected` — seen on a provider, refused until installed.
 *  `installed` — passed every probe. `failed` — ran, but did not pass. */
export interface ModelStatus {
  providerId: number;
  provider: string;
  model: string;
  state: string;
  packPath: string;
  /** The last ValidationReport, as JSON. */
  validationReport: string;
  /** Whether this model can be shown pictures. Off until someone says so. */
  supportsVision: boolean;
}

export interface ProbeResult {
  probe: string;
  passed: boolean;
  detail: string;
}

export interface ValidationReport {
  model: string;
  passed: boolean;
  probes: ProbeResult[];
  suggestedFixes: string[];
}

export const PROBE_LABELS: Record<string, string> = {
  workItemInterpretation: "Work item interpretation",
  solutionStrategy: "Solution strategy",
  architectureKinds: "Architecture planning",
  respectsDisallowed: "Respects developer rules",
  declinesVagueWork: "Declines vague work",
};

export const listModelStatus = (): Promise<ModelStatus[]> =>
  invoke("list_model_status");
/** Re-reads a local server's models so a newly pulled one is noticed. */
export const refreshProviderModels = (providerId: number): Promise<string[]> =>
  invoke("refresh_provider_models", { providerId });
/** Builds the capability pack, writes it, and validates the model against it.
 *  All-or-nothing: any failed probe leaves the model refused. */
export const installModel = (
  providerId: number,
  model: string,
  productId: number,
): Promise<ValidationReport> =>
  invoke("install_model", { providerId, model, productId });
/** Records whether a model can be shown pictures. A person sets this: the
 *  platform cannot establish it cheaply, and a capability nobody has confirmed
 *  is treated as absent. */
export const setModelVision = (
  providerId: number,
  model: string,
  supportsVision: boolean,
): Promise<void> =>
  invoke("set_model_vision", { providerId, model, supportsVision });

/** One way of doing a piece of work, with what it is expected to cost. */
export interface Recommendation {
  kind: string; // "fastest" | "costEfficient"
  provider: string;
  model: string;
  estTokens: number;
  estCostMicropence: number;
  estMinutes: number;
  /** "priceTable" — a stated guess; "history" — median of real calls. */
  source: string;
  affordable: boolean;
}

export interface Recommendations {
  options: Recommendation[];
  /** Set when an option was withheld rather than shown. */
  note: string | null;
}

/** Estimates the fastest and cheapest ways to do a piece of work. Computed on
 *  demand rather than stored — prices, budget and history all move. */
export const recommendForWorkItem = (
  workItemId: number,
  purpose: string,
): Promise<Recommendations> =>
  invoke("recommend_for_work_item", { workItemId, purpose });

/** One ready-made set of rules, and where it came from.
 *
 *  **Named sources, not house opinion.** "Our architecture rules" carries very
 *  different weight from "the Twelve-Factor App", so each template says who
 *  wrote the original and under what licence, and links to it. */
export interface RuleTemplate {
  id: string;
  name: string;
  summary: string;
  source: string;
  url: string;
  /** The licence of the **source**, empty where it states none. */
  licence: string;
  codingStandards: string;
  architecturePrinciples: string;
  maintainability: string;
  aiConstraints: string;
}

/** The templates this app ships. The same for every Product — what differs is
 *  which one somebody chooses to insert. */
export const ruleTemplates = (): Promise<RuleTemplate[]> => invoke("rule_templates");

export const getDeveloperRules = (
  productId: number,
): Promise<DeveloperRules | null> => invoke("get_developer_rules", { productId });
export const setDeveloperRules = (rules: DeveloperRules): Promise<void> =>
  invoke("set_developer_rules", { ...rules });
export const getSolutionStrategy = (
  workItemId: number,
): Promise<SolutionStrategy | null> =>
  invoke("get_solution_strategy", { workItemId });
export const generateSolutionStrategy = (
  workItemId: number,
): Promise<GenerationResult> =>
  invoke("generate_solution_strategy", { workItemId });
export const chooseArchitectureOption = (
  workItemId: number,
  index: number | null,
): Promise<void> => invoke("choose_architecture_option", { workItemId, index });

export const listAiFeedback = (workItemId: number): Promise<AiFeedback[]> =>
  invoke("list_ai_feedback", { workItemId });
/** Raises a question for Product. Uses the same channel as the AI's own
 *  questions, so the answer becomes a clarification that travels into every
 *  later prompt for this item. */
export const askProductQuestion = (
  workItemId: number,
  question: string,
): Promise<number> => invoke("ask_product_question", { workItemId, question });
/** Answers the AI's question. The note travels with the next prompt for this
 *  item, so the same question is not asked (and paid for) twice. */
export const resolveAiFeedback = (id: number, note: string): Promise<void> =>
  invoke("resolve_ai_feedback", { id, note });

export const generateUserStories = (
  featureId: number,
): Promise<GenerationResult> => invoke("generate_user_stories", { featureId });
/** Generates the work that achieves a Deliverable, at the planning level above
 *  user stories. */
export const generateDeliverableWork = (
  deliverableId: number,
): Promise<GenerationResult> =>
  invoke("generate_deliverable_work", { deliverableId });

// AI providers (keys live in the OS credential store — never returned)
export const listAiProviders = (): Promise<AiProvider[]> =>
  invoke("list_ai_providers");
/** Adds a metered Claude API provider.
 *
 *  No models argument: which models this offers is the Complexity setting's
 *  answer, read on the backend. Two places to say it would be two places to
 *  disagree. */
export const addAiProvider = (args: {
  name: string;
  apiBaseUrl: string;
  apiKey: string;
}): Promise<number> => invoke("add_ai_provider", args);
/** Adds a local Ollama provider — no key, not metered; models are read from
 *  the running server so you pick from what is actually installed. */
export const addOllamaProvider = (
  name: string,
  apiBaseUrl: string,
): Promise<number> => invoke("add_ollama_provider", { name, apiBaseUrl });
/** Adds Ollama's hosted service rather than a local process.
 *
 *  Same provider kind as a local Ollama — the API is identical and only a bearer
 *  token differs — but stored **metered**, because this is somebody else's
 *  hardware being paid for. It goes through the same budget gate and ledger as
 *  Claude; marking it free because its local sibling is free would let a Product
 *  spend past its budget on the very provider picked up when the budget ran out.
 *
 *  Models are read from the service, so what is offered is what the account can
 *  actually reach. */
export const addOllamaCloudProvider = (
  name: string,
  apiBaseUrl: string,
  apiKey: string,
): Promise<number> =>
  invoke("add_ollama_cloud_provider", { name, apiBaseUrl, apiKey });

export interface ClaudeCodeStatus {
  installed: boolean;
  /** What `claude --version` printed, when it ran. */
  version: string;
  /** Which copy answered. The Claude desktop app keeps its own under %APPDATA%
   *  and never puts it on PATH, while npm puts shims on PATH that may not run —
   *  so "installed" is only half an answer without saying which one. */
  path: string;
  /** Why it did not, phrased as what to do next. */
  problem: string;
  /** Whether it is signed in.
   *
   *  **Installed and signed in are separate answers.** `claude --version`
   *  answers happily while the session is dead, which is why an expired
   *  sign-in used to look like a healthy provider right up until the first
   *  real turn failed. */
  signedIn: boolean;
  /** How — a subscription, an API key, or nothing. */
  authMethod: string;
}

/** Whether the `claude` CLI on this machine can run.
 *
 *  Answers the setup guide's first step, which has to be answerable *before* a
 *  provider exists. It says nothing about whether you are signed in — that
 *  cannot be established without a real turn that spends plan allowance, so the
 *  guide states it rather than showing a tick that means less than it looks. */
/** Whether calls that cost money may be made at all.
 *
 *  Off until somebody says otherwise, and enforced in the router rather than by
 *  hiding a form — a switch that only tidied the UI would leave a provider
 *  already in a Product's chain being billed by a queue nobody was watching.
 *
 *  It governs every metered provider, not only Claude's API: a hosted Ollama
 *  bills for someone else's hardware just as surely. */
export const getPaidApiAllowed = (): Promise<boolean> =>
  invoke("get_paid_api_allowed");
export const setPaidApiAllowed = (allowed: boolean): Promise<void> =>
  invoke("set_paid_api_allowed", { allowed });

export const claudeCodeStatus = (executable = ""): Promise<ClaudeCodeStatus> =>
  invoke("claude_code_status", { executable });

/** Opens a terminal and starts the Claude Code sign-in in it.
 *
 *  Signing in opens a browser and then waits for a person to confirm, so it
 *  cannot be a silent background call — what it needs is a terminal somebody is
 *  looking at, which this app has. The terminal it opens is a real one and
 *  appears with the others on the Build board. */
export const openClaudeSignIn = (
  executable = "",
  cols = 100,
  rows = 28,
): Promise<{ id: string; cwd: string }> =>
  invoke("open_claude_sign_in", { executable, cols, rows });

/** Opens a shell in the home folder and types the command that installs one
 *  debug adapter.
 *
 *  **Only the language is sent.** A terminal is arbitrary execution, so the
 *  command is looked up in the backend's own adapter table rather than passed
 *  from here — and it refuses the two adapters that are a download and an unzip
 *  rather than typing a sentence at a shell. */
export const openDebuggerInstall = (
  language: string,
  cols = 100,
  rows = 20,
): Promise<{ id: string; cwd: string }> =>
  invoke("open_debugger_install", { language, cols, rows });

/** Installs Claude Code globally with npm, returning what npm said.
 *
 *  A global install on this machine — the one part of setting Claude up that
 *  changes anything outside this app — so it only ever runs from a press.
 *  Installing over a broken half-install repairs it, which is the common case:
 *  the npm wrapper can land without its platform binary and leave `claude` on
 *  PATH unable to run. */
export const installClaudeCode = (): Promise<string> =>
  invoke("install_claude_code");

/** Adds Claude through the `claude` CLI already signed in on this machine.
 *
 *  This is the path for a Pro or Max subscription with no API credits: the
 *  subscription pays for the CLI, while the Messages API bills credits against
 *  an API key and cannot read a subscription. No key is asked for because there
 *  is none to give — and no spend is recorded, because the plan's allowance is
 *  charged where this app cannot see it.
 *
 *  `executable` is for installs that are not on PATH; empty means `claude`. */
export const addClaudeCodeProvider = (
  name: string,
  executable: string,
): Promise<number> =>
  invoke("add_claude_code_provider", { name, executable });
export const removeAiProvider = (id: number): Promise<void> =>
  invoke("remove_ai_provider", { id });
export const testAiProvider = (id: number): Promise<string> =>
  invoke("test_ai_provider", { id });

// Work-item AI policies (deny-by-default)
export const getWorkItemPolicy = (
  workItemId: number,
): Promise<WorkItemPolicy | null> =>
  invoke("get_work_item_policy", { workItemId });
export const setWorkItemPolicy = (policy: {
  workItemId: number;
  allowRead: boolean;
  allowEdit: boolean;
  allowGenerateTests: boolean;
  providerId: number | null;
  effortTier: string;
}): Promise<void> => invoke("set_work_item_policy", policy);

// Budgets, spend, and the model price table
export const getProductBudget = (
  productId: number,
): Promise<ProductBudget | null> => invoke("get_product_budget", { productId });
export const setProductBudget = (budget: {
  productId: number;
  totalBudgetMicropence: number;
  aiBudgetMicropence: number;
  tokenLimit: number;
  warnPct: number;
  handoverPct: number;
  hardStopPct: number;
  periodDays: number;
  providerChain: number[];
}): Promise<void> => invoke("set_product_budget", budget);
export const getSpendSummary = (productId: number): Promise<SpendSummary> =>
  invoke("get_spend_summary", { productId });
export const listModelPrices = (): Promise<ModelPrice[]> =>
  invoke("list_model_prices");
export const setModelPrice = (price: {
  providerId: number;
  model: string;
  inputPencePerMtok: number;
  outputPencePerMtok: number;
  tokensPerSecond: number;
}): Promise<number> => invoke("set_model_price", price);
export const deleteModelPrice = (id: number): Promise<void> =>
  invoke("delete_model_price", { id });

// Product AI policy (gates Deliverable planning — deny-by-default)
export const getProductPolicy = (
  productId: number,
): Promise<ProductPolicy | null> => invoke("get_product_policy", { productId });
export interface SolutionPolicy {
  solutionId: number;
  allowRead: boolean;
  allowEdit: boolean;
  allowGenerateTests: boolean;
  providerId: number | null;
  effortTier: string;
}

/** One Solution's override of its Product's policy, or null where it follows
 *  the Product. Absent is "not overridden", never "denied". */
export interface AiPermission {
  allowed: boolean;
  /** Empty when allowed; otherwise what to change and where. */
  reason: string;
  hasProvider: boolean;
}

/** Whether the AI may act on one work item — the same walk the backend gate
 *  uses, so the button and the backend cannot disagree. */
export const checkItemAiPermission = (
  workItemId: number,
): Promise<AiPermission> =>
  invoke("check_item_ai_permission", { workItemId });

export const getSolutionPolicy = (
  solutionId: number,
): Promise<SolutionPolicy | null> =>
  invoke("get_solution_policy", { solutionId });
export const setSolutionPolicy = (policy: SolutionPolicy): Promise<void> =>
  invoke("set_solution_policy", {
    solutionId: policy.solutionId,
    allowRead: policy.allowRead,
    allowEdit: policy.allowEdit,
    allowGenerateTests: policy.allowGenerateTests,
    providerId: policy.providerId,
    effortTier: policy.effortTier,
  });
export const clearSolutionPolicy = (solutionId: number): Promise<void> =>
  invoke("clear_solution_policy", { solutionId });

export const setProductPolicy = (policy: {
  productId: number;
  allowRead: boolean;
  allowGenerate: boolean;
  allowEdit: boolean;
  allowGenerateTests: boolean;
  providerId: number | null;
  effortTier: string;
}): Promise<void> => invoke("set_product_policy", policy);

// Pull-out windows
export const openScreenWindow = (
  screen: string,
  productId: number,
  productName: string,
): Promise<void> =>
  invoke("open_screen_window", { screen, productId, productName });

/** The console — a Solution's shell and the debugger's output — as its own OS
 *  window, so it can go on the other monitor.
 *
 *  The shell survives the trip: the PTY lives in the backend and the new window
 *  adopts it by id, with its recent output to catch up on. */
export const openConsoleWindow = (
  solutionId: number,
  solutionName: string,
  terminalId: string | null,
): Promise<void> =>
  invoke("open_console_window", { solutionId, solutionName, terminalId });

// Repositories (Develop side; full management is its own roadmap item)
export const listRepositories = (): Promise<Repository[]> =>
  invoke("list_repositories");

/** Type labels for badges. */
export const TYPE_LABELS: Record<string, string> = {
  epic: "Epic",
  feature: "Feature",
  userStory: "User Story",
  task: "Task",
  bug: "Bug",
  test: "Test",
};

/* ── The git hub and the test explorer ─────────────────────────────────── */

export interface RepoFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  /** git could not merge it — both sides changed it. */
  conflicted: boolean;
  staged: boolean;
}

export interface RepoStatus {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: RepoFile[];
  /** A merge is in progress — there are conflicts to resolve. */
  merging: boolean;
}

export interface SolutionRepo {
  solutionId: number;
  name: string;
  status: RepoStatus | null;
  /** Why there is no status. One Solution without a folder must not blank the
   *  whole hub, so this is per-Solution rather than a thrown error. */
  unavailable: string | null;
}

export interface SolutionChanges {
  solutionId: number;
  name: string;
  changes: FileChange[];
  unavailable: string | null;
}

/** The three versions a merge conflict is made of, plus git's attempt. */
export interface ConflictSides {
  path: string;
  base: string;
  /** Stage 2 — the branch being merged into. */
  mine: string;
  /** Stage 3 — the branch being merged in. */
  theirs: string;
  /** The working-tree file, markers and all. This is the editable one. */
  merged: string;
  unresolved: boolean;
}

export interface TestSuite {
  kind: string; // cargo | vitest | jest | npm | pytest | dotnet | go | custom
  directory: string;
  commandLine: string;
  foundBy: string;
}

export interface TestOutcome {
  name: string;
  state: "passed" | "failed" | "skipped";
}

export interface SuiteRun {
  suite: TestSuite;
  passed: number;
  failed: number;
  skipped: number;
  /** **Whether the counts were actually read from the output.** False means
   *  the run is known only by its exit code, and no numbers may be shown. */
  counted: boolean;
  exitOk: boolean;
  tests: TestOutcome[];
  output: string;
  durationMs: number;
}

export interface SolutionSuites {
  solutionId: number;
  name: string;
  suites: TestSuite[];
  customCommand: string | null;
  unavailable: string | null;
}

/** Every Solution in a Product with its branch, drift and working changes. */
export const productGitOverview = (productId: number): Promise<SolutionRepo[]> =>
  invoke("product_git_overview", { productId });
/** What has changed across every Solution, with each file's diff attached. */
export const productChangedFiles = (productId: number): Promise<SolutionChanges[]> =>
  invoke("product_changed_files", { productId });
export const readConflictSides = (
  solutionId: number,
  path: string,
): Promise<ConflictSides> => invoke("read_conflict_sides", { solutionId, path });
/** Stages a resolved file. Refuses while conflict markers remain. */
export const markConflictResolved = (solutionId: number, path: string): Promise<void> =>
  invoke("mark_conflict_resolved", { solutionId, path });

export const listTestSuites = (productId: number): Promise<SolutionSuites[]> =>
  invoke("list_test_suites", { productId });
/** Runs every suite in one Solution. Called per Solution so results appear as
 *  each finishes rather than after the slowest one in the Product. */
export const runSolutionTests = (solutionId: number): Promise<SuiteRun[]> =>
  invoke("run_solution_tests", { solutionId });
export const runTestSuite = (
  solutionId: number,
  kind: string,
  directory: string,
  commandLine: string,
): Promise<SuiteRun> =>
  invoke("run_test_suite", { solutionId, kind, directory, commandLine });
/** Replaces detection for this Solution. Blank clears it, so a command that
 *  did not work is never permanent. */
export const setSolutionTestCommand = (
  solutionId: number,
  command: string | null,
): Promise<void> => invoke("set_solution_test_command", { solutionId, command });

/** Records where each kind of thing lives in this Solution's working copy.
 *
 *  Develop's decision, on the Solution — a layout is a fact about one
 *  repository, and a Product grows more of them as it succeeds. */
export const setSolutionKindLocations = (
  solutionId: number,
  kindLocations: string,
): Promise<void> =>
  invoke("set_solution_kind_locations", { solutionId, kindLocations });

/** How to run a Solution while working on it: `start` spins it up (a front end
 *  reloads itself), and `watch` keeps a compiled backend refreshing on change —
 *  empty when `start` already reloads. */
export interface DevCommand {
  kind: string;
  start: string;
  watch: string;
  watchNeeds: string;
  foundBy: string;
  /** True when `start` is the Solution's own override, not detection. */
  custom: boolean;
  /** Whether the watcher's tool is on PATH. False means Hot refresh would fail
   *  with a "command not found", so the panel says so instead of offering it. */
  watchReady: boolean;
  unavailable: string | null;
}

/** The run command for one Solution — its own if set, otherwise detected. */
export const suggestDevCommand = (solutionId: number): Promise<DevCommand> =>
  invoke("suggest_dev_command", { solutionId });
/** Replaces run detection for this Solution. Blank clears it, so a command that
 *  did not work is never permanent — the same escape hatch as the test one. */
export const setSolutionRunCommand = (
  solutionId: number,
  command: string | null,
): Promise<void> => invoke("set_solution_run_command", { solutionId, command });

/** Names what the debugger should start for this Solution, replacing whatever
 *  it would work out. Blank clears it — a path that turned out wrong is never
 *  permanent, the same escape hatch as the run and test commands.
 *
 *  Relative to the working copy, because that is how somebody writes it. The
 *  path is checked when a session starts rather than here: a file that exists
 *  now can be renamed later, and validating on save would only buy a false
 *  sense of having been checked. */
export const setSolutionStartFrom = (
  solutionId: number,
  path: string | null,
): Promise<void> => invoke("set_solution_start_from", { solutionId, path });

export const TEST_KIND_LABELS: Record<string, string> = {
  cargo: "Rust (cargo)",
  vitest: "TypeScript (vitest)",
  jest: "JavaScript (jest)",
  npm: "npm test",
  pytest: "Python (pytest)",
  dotnet: ".NET (dotnet test)",
  go: "Go",
  custom: "Custom command",
};

/* ── The terminal panel ────────────────────────────────────────────────── */

export interface OpenedTerminal {
  id: string;
  /** The shell that was started, so the panel can say what it is. */
  shell: string;
  cwd: string;
}

/** Opens a real shell in a Solution's working copy. Output does not come back
 *  from this call — it arrives as `terminal-output` events, because a shell
 *  speaks when it feels like it and a request/response cannot carry that. */
export const openTerminal = (
  solutionId: number,
  cols: number,
  rows: number,
): Promise<OpenedTerminal> => invoke("open_terminal", { solutionId, cols, rows });
/** Sends keystrokes. Bytes, not lines — Ctrl-C is \x03. */
export const writeTerminal = (id: string, data: string): Promise<void> =>
  invoke("write_terminal", { id, data });
/** Tells the shell its new size, so it stops wrapping at the old width. */
export const resizeTerminal = (id: string, cols: number, rows: number): Promise<void> =>
  invoke("resize_terminal", { id, cols, rows });
export const closeTerminal = (id: string): Promise<void> =>
  invoke("close_terminal", { id });

/** A shell this app started that is still running.
 *
 *  The registry always existed — Tauri holds the sessions for the life of the
 *  app — but nothing could ask what was in it, so a panel that unmounted had no
 *  way back to its own shell and closed it instead. */
export interface RunningTerminal {
  id: string;
  solutionId: number;
  shell: string;
  cwd: string;
  /** When this app started it; the only start it can honestly claim to know. */
  startedAt: number;
}

export interface AttachedTerminal extends RunningTerminal {
  /** Recent output, to write into the fresh widget so a reattached shell does
   *  not look like one that failed. Bounded and in memory — never persisted. */
  replay: string;
}

/* ── Debugging, over the Debug Adapter Protocol ─────────────────────────── */

/** One language's debug adapter, and what this machine has to say about it.
 *
 *  `available` means a candidate was found **and ran** — being on PATH proves
 *  nothing, which this project has paid for more than once. */
export interface AdapterStatus {
  language: "typescript" | "python" | "go" | "csharp";
  label: string;
  adapter: string;
  transport: "stdio" | "tcp";
  available: boolean;
  /** What will be run, for a person to read. */
  program: string;
  /** What will be run, as argv. `{port}` is filled in for TCP adapters. */
  argv: string[];
  version: string;
  /** Why it is unavailable, in words somebody can act on. */
  problem: string;
  /** What to do to get it — always populated, available or not. Prose for two
   *  of the four, because two of them are a download and an unzip. */
  install: string;
  /** The same thing as one runnable command, or empty where there is not one.
   *  An Install button is offered only where this is populated — typing
   *  "Download js-debug-dap from …" into a shell produces `command not found`,
   *  which reads as a broken app rather than a manual step. */
  installCommand: string;
}

/** What actually starting an adapter and talking to it proved. */
export interface AdapterCheck {
  language: string;
  /** True only when it started **and** answered `initialize`. */
  speaksDap: boolean;
  configurationDone: boolean;
  conditionalBreakpoints: boolean;
  functionBreakpoints: boolean;
  logPoints: boolean;
  hitCounts: boolean;
  problem: string;
  /** Everything the adapter said about itself, verbatim. */
  reported: string;
}

/** Which languages this machine can debug. Each candidate is executed, not
 *  merely found, so a Store stub or an npm shim reports as missing. */
export const debugAdapters = (): Promise<AdapterStatus[]> => invoke("debug_adapters");
/** Starts one adapter and completes the DAP handshake with it — proof rather
 *  than inference from a filename. */
export const debugCheck = (language: string): Promise<AdapterCheck> =>
  invoke("debug_check", { language });

/** A line to stop on. */
export interface Breakpoint {
  /** Absolute, because that is what an adapter matches against. */
  path: string;
  line: number;
  /** An expression in the debugged language that has to be true to stop here.
   *  Empty means stop every time. Evaluated by the adapter in the running
   *  program, so it is the program’s own language rather than JavaScript. */
  condition: string;
  /** A message to print **instead of** stopping. `{expr}` inside it is
   *  evaluated in the program. Empty means stop, as normal. */
  log: string;
  /** How many times the line has to be reached first. The grammar belongs to
   *  the adapter — js-debug takes `7`, Delve takes `== 7` — so it is passed
   *  through verbatim. */
  hits: string;
}

/** Where a stopped program is, innermost frame first. */
export interface Frame {
  id: number;
  name: string;
  /** Empty for a frame with no source — runtime internals are real frames. */
  path: string;
  line: number;
  column: number;
  /** Whether **this** frame can be run again. A runtime or native frame is on
   *  the stack and cannot be restarted even where the adapter can restart
   *  others. */
  canRestart: boolean;
}

/** One thread the program is running, as the adapter names it.
 *
 *  **"Thread" is the protocol's word, not the runtime's.** Delve reports Go
 *  goroutines here, js-debug reports one per execution context, and netcoredbg
 *  reports real OS threads. All three are the thing you can ask for a stack. */
export interface DebugThread {
  id: number;
  name: string;
}

/** One name and value in scope. */
export interface DebugVariable {
  name: string;
  value: string;
  kind: string;
  /** Non-zero when it can be expanded. */
  children: number;
  /** The `variablesReference` this was read out of, and what `setVariable`
   *  names it by. Zero for something evaluated rather than read — an expression
   *  is not held in a container, so it can only be changed through
   *  `setExpression`. */
  parent: number;
}

/** Where one breakpoint ended up, as the adapter reported it.
 *
 *  **A first answer, not a final one.** Nothing is bound until the program is
 *  actually running, so an adapter can perfectly well take a breakpoint,
 *  answer `verified: false`, and bind it a moment later — js-debug says
 *  "breakpoint.provisionalBreakpoint" while doing exactly that. The correction
 *  arrives as a DAP `breakpoint` event carrying this same `id`. */
export interface Placed {
  path: string;
  requested: number;
  line: number | null;
  verified: boolean;
  message: string;
  /** The adapter's own handle for it, when it gave one. What ties a later
   *  correction to this row without guessing at line numbers the adapter is
   *  free to have moved. */
  id: number | null;
}

export interface StartedDebug {
  session: string;
  language: string;
  /** Where each breakpoint actually landed. An adapter slides one to the next
   *  executable line, and showing the requested line would be a lie about where
   *  the program will stop. */
  breakpoints: Placed[];
  /** Whether this adapter will evaluate a breakpoint condition. Reported so the
   *  editor can say "this debugger cannot do that" rather than offering a box
   *  whose contents would be dropped on the floor. */
  conditions: boolean;
  /** Whether it will print a message instead of stopping. */
  logPoints: boolean;
  /** Whether it will count hits before honouring a breakpoint. */
  hitCounts: boolean;
  /** Whether one frame can be run again from its first line.
   *
   *  The only thing DAP offers that acts on a **frame**: `next`, `stepIn` and
   *  `stepOut` all take a thread, so a step always acts on the innermost frame
   *  however the stack is selected. */
  restartFrame: boolean;
  /** Whether it answers an `evaluate` sent because a pointer moved.
   *
   *  `evaluate` itself is always available — the watch pane needs no
   *  permission. This is the adapter saying it is safe to call repeatedly and
   *  unasked, as a pointer travels over a file. */
  hovers: boolean;
  /** Whether a named value can be changed in its container. */
  setVariable: boolean;
  /** Whether whatever an expression denotes can be changed.
   *
   *  **Not the same question.** `setVariable` needs a name in a container and
   *  so cannot touch `order.Items[0].Price`; `setExpression` takes the
   *  expression itself. Delve reports the first and not the second, so for Go a
   *  local can be changed and a watch cannot. */
  setExpression: boolean;
  /** A caveat about this particular launch, or empty.
   *
   *  **Not an error and not a capability** — something true about what is
   *  running that somebody would otherwise discover by being confused. So far
   *  only C# has one, when the only build available was optimised. */
  note: string;
}

/** Starts a program under its debugger with breakpoints already set.
 *
 *  Go, Python, TypeScript and C# all launch today, and the shapes differ more
 *  than "different arguments" suggests: Delve is handed a folder and builds it,
 *  netcoredbg a built assembly, and debugpy exactly one `.py`. So a Python
 *  Solution with nothing in it that looks like the program is refused here
 *  rather than started and left stopping at nothing. */
export const debugStart = (
  language: string,
  program: string,
  breakpoints: Breakpoint[],
  /** The Solution, so its "start from" is honoured. */
  solutionId: number | null = null,
): Promise<StartedDebug> =>
  invoke("debug_start", { language, program, solutionId, breakpoints });
/** Replaces a running session's breakpoints. */
export const debugSetBreakpoints = (
  session: string,
  breakpoints: Breakpoint[],
): Promise<unknown[]> => invoke("debug_set_breakpoints", { session, breakpoints });
/** `continue` | `over` | `in` | `out`. */
export const debugResume = (
  session: string,
  how: "continue" | "over" | "in" | "out",
  threadId: number,
): Promise<void> => invoke("debug_resume", { session, how, threadId });
/** Every thread the program has, stopped or not.
 *
 *  **The reason this exists is deadlock.** The thread that stopped is rarely
 *  the one holding the lock, so a debugger that only ever showed the stopped
 *  thread could not show you the problem.
 *
 *  Read at each stop rather than kept: threads come and go, and DAP's `thread`
 *  events are advisory — an adapter need not send one for every start and
 *  exit. */
export const debugThreads = (session: string): Promise<DebugThread[]> =>
  invoke("debug_threads", { session });
/** Works out what an expression comes to, in one frame.
 *
 *  **What the variable list cannot do.** That shows what happens to have a name
 *  in scope; this shows what you want to know — `subtotal + tax`,
 *  `len(items)` — none of which are variables.
 *
 *  Evaluated in the frame, by the adapter, in the program's own language, so
 *  the same expression against a caller is a different question. Rejecting is
 *  ordinary: an expression out of scope in the selected frame is a normal thing
 *  to be looking at, and the message belongs against that one row. */
export const debugEvaluate = (
  session: string,
  expression: string,
  frameId: number,
  /** `"watch"` from the watch pane, `"hover"` from the editor. Not a label: it
   *  changes what the adapter is willing to do, and `"hover"` is refused where
   *  the adapter has not said it answers them. */
  context: "watch" | "hover" = "watch",
): Promise<DebugVariable> =>
  invoke("debug_evaluate", { session, expression, frameId, context });
export const debugStack = (session: string, threadId: number): Promise<Frame[]> =>
  invoke("debug_stack", { session, threadId });
export const debugVariables = (
  session: string,
  frameId: number,
): Promise<DebugVariable[]> => invoke("debug_variables", { session, frameId });
/** One variable’s own fields.
 *
 *  The reference comes from a variable already on screen and is only valid
 *  while the program is stopped where it was handed out — every handle dies
 *  when it moves, so an expansion is fetched on opening rather than kept. */
export const debugExpand = (
  session: string,
  reference: number,
): Promise<DebugVariable[]> => invoke("debug_expand", { session, reference });
/** Puts a new value into a named variable, in its container.
 *
 *  **This writes into a running program.** The value is written in the
 *  debuggee's own language and parsed by the adapter — `5000` for an int,
 *  `"desk"` with its quotes for a Go string — because the grammar belongs to
 *  the debugger, the same as a breakpoint condition.
 *
 *  Answers with what the value actually became, which is not always what was
 *  asked for: an adapter may round, truncate or reformat. */
export const debugSetVariable = (
  session: string,
  parent: number,
  name: string,
  value: string,
): Promise<DebugVariable> =>
  invoke("debug_set_variable", { session, parent, name, value });
/** Puts a new value into whatever an expression denotes. */
export const debugSetExpression = (
  session: string,
  expression: string,
  frameId: number,
  value: string,
): Promise<DebugVariable> =>
  invoke("debug_set_expression", { session, expression, frameId, value });
/** Runs one frame again from its first line.
 *
 *  The only per-frame operation there is. Everything else about a stopped
 *  program — every step — acts on the thread, and therefore on the innermost
 *  frame whichever one is selected. */
export const debugRestartFrame = (session: string, frameId: number): Promise<void> =>
  invoke("debug_restart_frame", { session, frameId });
export const debugStop = (session: string): Promise<void> =>
  invoke("debug_stop", { session });

/** One worktree of your own on a Solution.
 *
 *  **The same kind of thing an agent gets.** Each agent works in a real git
 *  worktree; these are made by the same call, in the same folder beside the
 *  repository. That is what makes two of them worth having — the same Solution
 *  open twice at different commits, and an experiment in one that cannot
 *  disturb the other. */
export interface MySpace {
  /** The branch, including the `myspace/` prefix — what identifies it to git. */
  branch: string;
  /** What to call it on screen, without the prefix. */
  name: string;
  /** Where it is checked out. */
  path: string;
}

/** Opens a new worktree of your own, branched from where the Solution is now. */
export const openMySpace = (solutionId: number, name: string): Promise<MySpace> =>
  invoke("open_my_space", { solutionId, name });

/** Every space of yours on this Solution.
 *
 *  Read from git rather than remembered, so a worktree somebody removed by hand
 *  is gone from the list rather than offered as a folder that is not there. */
export const listMySpaces = (solutionId: number): Promise<MySpace[]> =>
  invoke("list_my_spaces", { solutionId });

/** Closes one, removing the checkout and leaving the branch.
 *
 *  Removing a worktree throws away a folder; removing the branch would throw
 *  away commits, and a button labelled "close" must not do the second. */
export const closeMySpace = (solutionId: number, path: string): Promise<void> =>
  invoke("close_my_space", { solutionId, path });

/** Every shell still running. Ones that ended on their own are dropped on the
 *  way past, so this is what is live rather than what was ever started. */
export const listTerminals = (): Promise<RunningTerminal[]> =>
  invoke("list_terminals");
/** Picks a running shell back up, with its recent output. */
export const attachTerminal = (id: string): Promise<AttachedTerminal> =>
  invoke("attach_terminal", { id });

/** What the explorer's properties panel shows about the selected file. */
export interface FileProperties {
  path: string;
  name: string;
  bytes: number;
  /** Unix millis, or 0 when the filesystem will not say. */
  modified: number;
  extension: string;
  /** Null for a binary file — "lines" in a PNG is a number that means nothing. */
  lines: number | null;
  readOnly: boolean;
}

export const fileProperties = (
  solutionId: number,
  path: string,
): Promise<FileProperties> => invoke("file_properties", { solutionId, path });

/* ── What a work item changes: screens, APIs, tables ───────────────────── */

/** A stored kind id — "screen", "service", "requestModel", "table"…
 *
 *  **Open, not a union.** "UI, logic and models" is not cut and dry: a front
 *  end has services and view models, an API has incoming models, outgoing
 *  models and the data models behind them, a database has views and stored
 *  procedures. The vocabulary lives in Rust (`db::work_item_change::KINDS`) and
 *  is fetched, because a union spelled out here would be a second copy of it
 *  and the drift would only show as a rejected save. */
export type ChangeKind = string;
export type ChangeAction = "add" | "change";

/** One kind, as the form needs it: what to store, what to call it, which of
 *  the three families it sits under, and an example of a name's shape. */
export interface ChangeKindInfo {
  id: ChangeKind;
  /** Singular, against one entry. */
  label: string;
  /** Plural, as the heading over a list of them. */
  heading: string;
  /** "ui" | "logic" | "models". */
  group: string;
  groupLabel: string;
  /** A worked example — "POST /checkout", not "an endpoint". Somebody typing
   *  "checkout" where the first was meant produces a plan that reads as two
   *  different endpoints. */
  example: string;
}

/** The whole vocabulary, in family order.
 *
 *  Whole rather than the allowed subset, because rows already recorded have to
 *  be labelled too — including ones against a Solution nobody has selected. */
export const changeKinds = (): Promise<ChangeKindInfo[]> => invoke("change_kinds");

export interface WorkItemChange {
  id: number;
  workItemId: number;
  /** Null while it is still Product's ask, unassigned to any Solution. */
  solutionId: number | null;
  kind: ChangeKind;
  action: ChangeAction;
  name: string;
  detail: string;
  /** The mockup this screen is a picture of, when one was linked. */
  mockupPath: string | null;
}

/** The readable name for a stored kind, from a vocabulary already fetched.
 *
 *  Falls back to the id rather than to nothing: a row written by a version
 *  that knew a kind this one does not should still show what it is. */
export const kindLabel = (vocabulary: ChangeKindInfo[], id: ChangeKind): string =>
  vocabulary.find((k) => k.id === id)?.label ?? id;

export const listWorkItemChanges = (workItemId: number): Promise<WorkItemChange[]> =>
  invoke("list_work_item_changes", { workItemId });
export const addWorkItemChange = (args: {
  workItemId: number;
  solutionId: number | null;
  kind: ChangeKind;
  action: ChangeAction;
  name: string;
  detail: string;
}): Promise<number> => invoke("add_work_item_change", args);

/** What one entry of a batch became. */
export interface AddOutcome {
  kind: ChangeKind;
  name: string;
  /** The new row, or null when nothing was written. */
  id: number | null;
  /** Why not, in the backend's words. Null when it went in. */
  refused: string | null;
}

/** Records several things at once — the five screens somebody just ticked.
 *
 *  Every entry comes back named with what happened to it. A duplicate among
 *  eight is the ordinary case and must not fail the other seven, but it must
 *  not be swallowed either. */
export const addWorkItemChanges = (
  workItemId: number,
  entries: {
    solutionId: number | null;
    kind: ChangeKind;
    action: ChangeAction;
    name: string;
    detail: string;
  }[],
): Promise<AddOutcome[]> => invoke("add_work_item_changes", { workItemId, entries });

/** Writes the one "what needs to change" across everything just ticked. */
export const setWorkItemChangeDetail = (
  ids: number[],
  detail: string,
): Promise<void> => invoke("set_work_item_change_detail", { ids, detail });

/** Points Product's ask at the Solution that will build it, or back at nobody. */
export const assignWorkItemChange = (
  id: number,
  solutionId: number | null,
): Promise<void> => invoke("assign_work_item_change", { id, solutionId });
export const updateWorkItemChange = (
  id: number,
  action: ChangeAction,
  name: string,
  detail: string,
): Promise<void> => invoke("update_work_item_change", { id, action, name, detail });
export const deleteWorkItemChange = (id: number): Promise<void> =>
  invoke("delete_work_item_change", { id });
/** Which kinds this Solution's type can carry. Asked of the backend rather
 *  than duplicated here — two copies of the rule would drift, and the drift
 *  would only show as a rejected save. */
export const changeKindsForSolution = (solutionId: number): Promise<ChangeKind[]> =>
  invoke("change_kinds_for_solution", { solutionId });

/* ── Starting a Solution from its language's own generator ─────────────── */

export interface Starter {
  id: string;
  label: string;
  /** The command, with {name} where the Solution's name goes. Editable in the
   *  form before anything runs — the button press is the confirmation. */
  command: string;
  needs: string;
}

export interface StarterRun {
  command: string;
  directory: string;
  succeeded: boolean;
  /** The toolchain's own words, whole. When one is missing this is the only
   *  thing that says which. */
  output: string;
}

export interface CreatedSolution {
  solutionId: number;
  started: StarterRun | null;
}

export const listStarters = (): Promise<Starter[]> => invoke("list_starters");
/** Creates the Solution and, when a starter was chosen, runs that language's
 *  generator in a new folder. The Solution is kept even if the generator
 *  fails — the decision is worth more than the folder. */
export const createSolutionWithStarter = (args: {
  name: string;
  productId: number;
  solutionType: string;
  answers: string;
  starterId: string | null;
  command: string | null;
  parentDir: string | null;
  /** The typed name when the starter is "custom" — "Elixir", not "custom". */
  languageName: string | null;
}): Promise<CreatedSolution> => invoke("create_solution_with_starter", args);

/** Links a screen to the mockup that shows it, or clears the link. Without it
 *  the model gets a pile of images and a list of names, left to guess which
 *  picture is which screen. */
export const setChangeMockup = (
  id: number,
  mockupPath: string | null,
): Promise<void> => invoke("set_change_mockup", { id, mockupPath });

/** Runs a starter against a Solution that already exists. Without this a failed
 *  starter was a dead end — the only ways out were pointing at a folder by hand
 *  or deleting and recreating the Solution. */
export const startExistingSolution = (args: {
  solutionId: number;
  starterId: string;
  command: string | null;
  parentDir: string;
}): Promise<StarterRun> => invoke("start_existing_solution", args);

/* ── Commits, branches, SSH and draw.io ────────────────────────────────── */

export interface Commit {
  id: string;
  shortId: string;
  /** Two or more parents is a merge — the reason the graph is worth drawing. */
  parents: string[];
  refs: string[];
  subject: string;
  author: string;
  /** Unix seconds. */
  when: number;
}

export interface CommitResult {
  /** False when there was nothing to commit — ordinary on a timer, and not a
   *  failure. */
  committed: boolean;
  message: string;
  files: string[];
  /** Null when no push was asked for. A commit that landed locally with a push
   *  that did not is a real state, reported as itself. */
  pushed: { Ok: null } | { Err: string } | null;
}

/** off — nothing automatic. onSave — on every save. interval — on a timer. */
export type CommitMode = "off" | "onSave" | "interval";

export interface CommitPolicy {
  mode: CommitMode;
  /** Whether each automatic commit is also pushed. Asked separately, because a
   *  local commit is a restore point and a pushed one is on the branch
   *  everyone pulls. */
  push: boolean;
  intervalMinutes: number;
}

export const listSolutionBranches = (
  solutionId: number,
): Promise<string[]> => invoke("list_solution_branches", { solutionId });

export const branchHistory = (
  solutionId: number,
  limit?: number,
): Promise<Commit[]> => invoke("branch_history", { solutionId, limit });
export const commitSolution = (
  solutionId: number,
  message: string,
  push: boolean,
): Promise<CommitResult> => invoke("commit_solution", { solutionId, message, push });
/** The automatic commit. Refuses unless the policy is on, so a stray timer
 *  cannot commit for someone who turned it off. */
export const autoCommitSolution = (
  solutionId: number,
  trigger: "save" | "timer",
): Promise<CommitResult> => invoke("auto_commit_solution", { solutionId, trigger });
export const pushSolution = (solutionId: number): Promise<string> =>
  invoke("push_solution", { solutionId });
export const getCommitPolicy = (solutionId: number): Promise<CommitPolicy> =>
  invoke("get_commit_policy", { solutionId });
export const setCommitPolicy = (
  solutionId: number,
  mode: CommitMode,
  push: boolean,
  intervalMinutes: number,
): Promise<void> =>
  invoke("set_commit_policy", { solutionId, mode, push, intervalMinutes });

export interface SshStatus {
  hasKey: boolean;
  keyPath: string;
  /** The public half — the only part that ever leaves the machine. */
  publicKey: string | null;
  canGenerate: boolean;
}

export const sshStatus = (): Promise<SshStatus> => invoke("ssh_status");
/** Generates a key pair. Only the public half comes back. */
export const generateSshKey = (comment: string): Promise<string> =>
  invoke("generate_ssh_key", { comment });
export const testGithubSsh = (): Promise<string> => invoke("test_github_ssh");
/** Points a Solution's origin at SSH. A repository cloned over HTTPS keeps
 *  asking for a token however well the key is set up. */
export const useSshRemote = (solutionId: number): Promise<string> =>
  invoke("use_ssh_remote", { solutionId });

export interface DiagramNode {
  id: string;
  label: string;
  kind: string; // service | database | queue | external | store
  /** Where the box sits, when it was arranged by hand. Omitted for a generated
   *  draft, which falls back to the grid; set by the saved architecture map. */
  x?: number;
  y?: number;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label: string;
}

export interface DiagramFile {
  path: string;
  name: string;
}

export const listDiagrams = (productId: number): Promise<DiagramFile[]> =>
  invoke("list_diagrams", { productId });
/** Writes a real .drawio file into the Product's folder, so it versions with
 *  the code it describes and opens in whatever draw.io you have. */
export const saveDiagram = (
  productId: number,
  name: string,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
): Promise<string> => invoke("save_diagram", { productId, name, nodes, edges });
export const openDiagram = (path: string): Promise<void> =>
  invoke("open_diagram", { path });
/** Drafts a diagram from the Solutions and links already recorded. Returned
 *  rather than written: it is a first draft to correct, and writing straight
 *  to a file would overwrite one somebody had arranged in draw.io. */
export const diagramFromSolutions = (
  productId: number,
): Promise<{ nodes: DiagramNode[]; edges: DiagramEdge[] }> =>
  invoke("diagram_from_solutions", { productId });

/** One draft, either notation. Which one a diagram is written in is a choice
 *  made after deciding what is in it, so the boxes are worked out once and the
 *  format applied at the end. */
export const draftArchitecture = (
  productId: number,
  format: string,
): Promise<{
  format: string;
  content: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}> => invoke("draft_architecture", { productId, format });

/** The grid the boxes sit on.
 *
 *  **Mirrored from `drawio.rs`.** A preview laid out differently from the file
 *  would be a picture of a diagram nobody is about to get, so both sides carry
 *  a test asserting the same coordinates for the same input. */
export const DIAGRAM_GRID = {
  perRow: 4,
  x0: 40,
  y0: 40,
  dx: 200,
  dy: 140,
  w: 160,
  h: 60,
} as const;

/** Where the nth box goes. */
export function diagramPosition(index: number): { x: number; y: number } {
  return {
    x: DIAGRAM_GRID.x0 + (index % DIAGRAM_GRID.perRow) * DIAGRAM_GRID.dx,
    y: DIAGRAM_GRID.y0 + Math.floor(index / DIAGRAM_GRID.perRow) * DIAGRAM_GRID.dy,
  };
}

/** What is already recorded against a Solution — the list you tick from.
 *  There is no separate catalogue of a Solution's endpoints; the union of every
 *  change anybody recorded is it, and it grows as the team works. */
export const solutionCatalogue = (
  solutionId: number,
): Promise<{ kind: ChangeKind; name: string }[]> =>
  invoke("solution_catalogue", { solutionId });

/** Writes the work item as .md and .json for an agent to work from. Both come
 *  from one structure — generating one from the other would mean parsing prose
 *  or rendering a form, and they would drift. */
export const writeWorkItemFiles = (workItemId: number): Promise<string[]> =>
  invoke("write_work_item_files", { workItemId });

/* ── Submitting to the AI, and running agents in parallel ──────────────── */

export interface AiJob {
  id: number;
  workItemId: number;
  workItemTitle: string;
  purpose: string;
  state: "queued" | "running" | "done" | "blocked" | "failed" | "cancelled";
  message: string;
  submittedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

/** Queues a work item for planning and returns at once — the whole point, so
 *  the next work item can be written up and submitted while this one runs. */
export const submitForPlanning = (workItemId: number): Promise<number> =>
  invoke("submit_for_planning", { workItemId });
/** Recent AI jobs across every Product — what the topbar's bell reports. A
 *  queue left running under another Product is exactly what it is for. */
/** One unanswered AI question, with the work item that raised it. */
export interface OpenQuestion {
  id: number;
  workItemId: number;
  workItemTitle: string;
  kind: string;
  message: string;
  whatIsNeeded: string;
}

/** Every unanswered question in a Product. Several agents plan at once, and a
 *  question from any of them is blocking that one. */
export const listOpenQuestions = (productId: number): Promise<OpenQuestion[]> =>
  invoke("list_open_questions", { productId });

/** Stops a queued or running job, and returns what that actually achieved.
 *
 *  The message matters and should be shown. Stopping a *queued* job costs
 *  nothing. Stopping a *running* one stops this app waiting — genuinely the end
 *  of it for Ollama and Claude Code, whose processes are killed — but a request
 *  already sent to a metered provider may still be generated and charged. No
 *  reply comes back, so that spend never reaches the ledger, and the app says so
 *  rather than inventing a figure to cover the gap. */
export const cancelAiJob = (id: number): Promise<string> =>
  invoke("cancel_ai_job", { id });

/** Forgets one work item's settled jobs, returning how many went. Anything
 *  still queued or running stays — the runner is about to write to it — and
 *  what the calls cost is in the ledger, which this does not touch. */
export const clearAiJobs = (workItemId: number): Promise<number> =>
  invoke("clear_ai_jobs", { workItemId });

export const listRecentAiJobs = (): Promise<AiJob[]> =>
  invoke("list_recent_ai_jobs");
export const listAiJobs = (productId: number): Promise<AiJob[]> =>
  invoke("list_ai_jobs", { productId });

export interface Concurrency {
  limit: number;
  /** Free slots right now. */
  available: number;
}

export const getAiConcurrency = (): Promise<Concurrency> =>
  invoke("get_ai_concurrency");
/** Takes effect next launch — resizing the limit under running work is a way
 *  to exceed the number someone just lowered. */
export const setAiConcurrency = (limit: number): Promise<void> =>
  invoke("set_ai_concurrency", { limit });

export interface Run {
  /** Zero means "not started yet" — a planned pair the panel offers Start for. */
  id: number;
  workItemId: number;
  workItemTitle: string;
  solutionId: number;
  solutionName: string;
  state: string; // notStarted | prepared | reviewed | kept | discarded
  branch: string;
  worktreePath: string;
  terminalId: string;
  briefPath: string;
  filesChanged: number;
  /** Whether this pair's plan has been approved. A run refuses to start
   *  without it, so "Start all" counts only these. */
  planApproved: boolean;
}

export interface StartedRun {
  runId: number;
  worktreePath: string;
  branch: string;
  briefPath: string;
  /** Shown, never executed by the app — the terminal runs it. */
  command: string;
  /** How to start the Solution running in the worktree. Empty when there is
   *  nothing to run, in which case no dev-server terminal is opened. */
  runStart: string;
}

export const listRuns = (productId: number): Promise<Run[]> =>
  invoke("list_runs", { productId });
/** Prepares one run: its own checkout, branch and brief. Stops short of
 *  running the agent — the command comes back to be typed into a terminal. */
export const startRun = (
  workItemId: number,
  solutionId: number,
): Promise<StartedRun> => invoke("start_run", { workItemId, solutionId });
/** Removes a finished run's checkout. Refused while it holds uncommitted work. */
export const discardRunWorktree = (runId: number): Promise<void> =>
  invoke("discard_run_worktree", { runId });
/** What merging a run's branch would do, worked out without touching anything. */
export interface MergePreview {
  clean: boolean;
  /** The files that would conflict, named before anything is attempted. */
  conflicts: string[];
  /** Commits the base does not have. Zero means the agent wrote nothing. */
  commitsAhead: number;
}

/** What a merge actually did. */
export interface MergeOutcome {
  merged: boolean;
  /** Files left conflicted — the merge is still open in the working copy. */
  conflicts: string[];
  message: string;
}

/** Whether a run's branch would merge cleanly. Touches nothing, so it is safe
 *  to ask before deciding. */
export const previewRunMerge = (runId: number): Promise<MergePreview> =>
  invoke("preview_run_merge", { runId });
/** Brings a run's branch home. Refused while the checkout has uncommitted work;
 *  a conflicted merge is left open for the Code tab's three-way view. */
export const mergeRunBranch = (runId: number): Promise<MergeOutcome> =>
  invoke("merge_run_branch", { runId });
/** Abandons a conflicted merge, restoring the checkout. */
export const abortRunMerge = (runId: number): Promise<void> =>
  invoke("abort_run_merge", { runId });

/** A run checkout still on disk that no run points at any more. */
export interface AbandonedWorktree {
  solutionId: number;
  solutionName: string;
  path: string;
}

/** Leftover checkouts across a Product — cleanup is offered, never forced, so
 *  without this the pile is invisible until the disk fills. */
export const listAbandonedWorktrees = (
  productId: number,
): Promise<AbandonedWorktree[]> => invoke("list_abandoned_worktrees", { productId });
/** Removes a leftover checkout. Refused if the path is not one of that
 *  Solution's run checkouts, or if it still holds uncommitted work. */
export const removeWorktreeAt = (solutionId: number, path: string): Promise<void> =>
  invoke("remove_worktree_at", { solutionId, path });

export const listRunWorktrees = (solutionId: number): Promise<string[]> =>
  invoke("list_run_worktrees", { solutionId });

/** An agent's own account of a round: what it built, how it proved it, what it
 *  would say back, and the debt it left behind. Every section is optional —
 *  what the agent did not write is empty rather than invented. */
export interface AgentRecord {
  whatIBuilt: string;
  tests: string;
  feedback: string;
  technicalDebt: string;
  couldNotDo: string;
  /** Anything it wrote outside the headings it was asked for. Kept: an agent
   *  that answered in its own shape still answered. */
  other: string;
}

/** Reads the round record out of a run's own checkout.
 *
 *  `null` while there is nothing there — an agent still working, or one that
 *  finished without leaving a record. That is the ordinary state for most of a
 *  run's life, not a failure. */
export const readAgentRecord = (runId: number): Promise<AgentRecord | null> =>
  invoke("read_agent_record", { runId });

/** One AI call, as the log shows it.
 *
 *  Tokens rather than money: cost lives in the budget screens, where a figure
 *  belongs when there is one. This answers what was asked, what came back, and
 *  how much of the allowance it took — a question with a real answer even for a
 *  provider whose price cannot be known. */
export interface AiCall {
  id: number;
  workItemId: number | null;
  provider: string;
  model: string;
  purpose: string;
  outcome: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
  /** Capped where it was stored. Empty for calls refused before they reached a
   *  provider, and for rows written before the exchange was kept. */
  prompt: string;
  reply: string;
  createdAt: number;
}

export interface AiCallTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Counted apart: a blocked call consumed nothing, and folding it into the
   *  total would overstate how busy the AI has been. */
  blocked: number;
}

export interface AiLog {
  totals: AiCallTotals;
  calls: AiCall[];
}

/** Every AI call for a Product, newest first, with what was said.
 *
 *  Totals cover exactly the rows returned, so the sum and the list cannot
 *  disagree. */
export const listAiCalls = (productId: number, limit = 100): Promise<AiLog> =>
  invoke("list_ai_calls", { productId, limit });

/** Makes one folder inside a Solution.
 *
 *  Its own call rather than a flag on file creation: an empty folder and an
 *  empty file are different things to ask for. Only one level — the parent must
 *  already exist, so a typo cannot build a tree nobody asked for. */
export const createSolutionFolder = (
  solutionId: number,
  path: string,
): Promise<void> => invoke("create_solution_folder", { solutionId, path });

/** What Claude does for one size of job. */
export interface ClaudeTier {
  model: string;
  /** "low" | "medium" | "high" — the API's own `output_config.effort`. */
  effort: string;
}

/** The three complexities, in order: low, medium, high.
 *
 *  **One setting for both ways of reaching Claude.** The API and a plan reach
 *  the same models, so asking twice invited them to drift — nobody wants "high
 *  complexity" to mean one thing through the API and another through the plan.
 *
 *  Saving also writes the models onto every Claude provider, because that list
 *  is what the router indexes. The setting is the answer; the provider row is a
 *  consequence of it. */
export const getClaudeTiers = (): Promise<ClaudeTier[]> =>
  invoke("get_claude_tiers");
export const setClaudeTiers = (tiers: ClaudeTier[]): Promise<void> =>
  invoke("set_claude_tiers", { tiers });

/** One work item's build plan as its own OS window — the Build view's Work
 *  item pane, pulled out. */
export const openWorkItemWindow = (
  workItemId: number,
  title: string,
): Promise<void> => invoke("open_work_item_window", { workItemId, title });

/** One file from a Solution's working copy as its own OS window. One window per
 *  file, because the reason to pull one out is to hold it beside another. */
export const openFileWindow = (solutionId: number, path: string): Promise<void> =>
  invoke("open_file_window", { solutionId, path });

// The life of a work item: three handovers, each with a checklist the team
// writes for itself.
export interface LifecycleGate {
  id: string;
  label: string;
  /** "product" | "develop" | "test" — who owns these steps. Product sees every
   *  gate; Develop and QA see the one they own. */
  owner: string;
}

export interface LifecycleStep {
  id: number;
  gate: string;
  name: string;
  position: number;
}

export const lifecycleGates = (): Promise<LifecycleGate[]> =>
  invoke("lifecycle_gates");

export const listLifecycleSteps = (productId: number): Promise<LifecycleStep[]> =>
  invoke("list_lifecycle_steps", { productId });

/** Replaces one gate's checklist. The order sent is the order it is read in;
 *  a step whose name survives keeps the ticks already against it. */
export const setLifecycleSteps = (
  productId: number,
  gate: string,
  names: string[],
): Promise<void> => invoke("set_lifecycle_steps", { productId, gate, names });

/** The ids of the steps this work item has ticked off. */
export const listWorkItemSteps = (workItemId: number): Promise<number[]> =>
  invoke("list_work_item_steps", { workItemId });

export const setWorkItemStep = (
  workItemId: number,
  stepId: number,
  done: boolean,
): Promise<void> => invoke("set_work_item_step", { workItemId, stepId, done });

/** A line from the app log — what the app did, in order. */
export interface LogEntry {
  id: number;
  at: number;
  area: string;
  message: string;
  detail: string;
}

/** Writes a line from the screen. The screen's half matters as much as the
 *  backend's: a press that never reached a command leaves nothing in any
 *  backend log, and that is the case somebody is trying to explain when they
 *  say nothing happened. */
export const logEvent = (
  area: string,
  message: string,
  detail?: string,
): Promise<void> => invoke("log_event", { area, message, detail });

export const listAppLog = (limit?: number): Promise<LogEntry[]> =>
  invoke("list_app_log", { limit });

export const clearAppLog = (): Promise<void> => invoke("clear_app_log");

/** Which build of the app is running. An installed copy and a rebuilt one are
 *  two binaries on one machine, and nothing on screen told them apart. */
export interface BuildInfo {
  version: string;
  /** Epoch milliseconds, stamped in at compile time. */
  builtAt: number;
}

export const appBuild = (): Promise<BuildInfo> => invoke("app_build");

/** How much an agent stops to ask while it works. The middle one is the
 *  default: an agent that asks before writing a file in the checkout it was
 *  made for is asking about the one thing it was sent there to do. */
export const agentRunModes = (): Promise<[string, string][]> =>
  invoke("agent_run_modes");

export const getAgentRunMode = (): Promise<string> => invoke("get_agent_run_mode");

export const setAgentRunMode = (mode: string): Promise<void> =>
  invoke("set_agent_run_mode", { mode });
