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
export const reviewSolutionChanges = (
  solutionId: number,
): Promise<ChangeReview> => invoke("review_solution_changes", { solutionId });

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
  /** "anthropic" (metered API) | "ollama" (local, free) */
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
  inputPencePerMTok: number;
  outputPencePerMTok: number;
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
  providerId: number | null;
  effortTier: string;
}

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
export const DEVELOP_STRATEGY_FIELDS: { id: string; label: string }[] = [
  { id: "infrastructure", label: "Required infrastructure" },
  { id: "architecture", label: "Architecture requirements" },
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
}

export const listWorkItemPlans = (workItemId: number): Promise<WorkItemPlan[]> =>
  invoke("list_work_item_plans", { workItemId });
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
/** Turns what the team wrote into API and page schemas per Solution. */
export const generateChangePlan = (
  workItemId: number,
): Promise<GenerationResult> => invoke("generate_change_plan", { workItemId });

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

export type DiagramFormat = "mermaid" | "plantuml" | "jsonGraph";

export const ARCHITECTURE_KIND_LABELS: Record<ArchitectureDocKind, string> = {
  systemInteraction: "System interaction",
  componentMap: "Component map",
  apiContract: "API contract",
  eventFlow: "Event flow",
  infrastructure: "Infrastructure",
};

export const DIAGRAM_FORMATS: DiagramFormat[] = ["mermaid", "plantuml", "jsonGraph"];

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
export const createWorkItem = (args: {
  title: string;
  itemType: string;
  productId: number;
  parentItemId?: number | null;
  description?: string;
}): Promise<number> => invoke("create_work_item", args);
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

/** The editable rule fields — every key except the product it belongs to. */
export type DeveloperRuleField = Exclude<keyof DeveloperRules, "productId">;

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
export const addAiProvider = (args: {
  name: string;
  apiBaseUrl: string;
  models: string[];
  apiKey: string;
}): Promise<number> => invoke("add_ai_provider", args);
/** Adds a local Ollama provider — no key, not metered; models are read from
 *  the running server so you pick from what is actually installed. */
export const addOllamaProvider = (
  name: string,
  apiBaseUrl: string,
): Promise<number> => invoke("add_ollama_provider", { name, apiBaseUrl });
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
  inputPencePerMTok: number;
  outputPencePerMTok: number;
  tokensPerSecond: number;
}): Promise<number> => invoke("set_model_price", price);
export const deleteModelPrice = (id: number): Promise<void> =>
  invoke("delete_model_price", { id });

// Product AI policy (gates Deliverable planning — deny-by-default)
export const getProductPolicy = (
  productId: number,
): Promise<ProductPolicy | null> => invoke("get_product_policy", { productId });
export const setProductPolicy = (policy: {
  productId: number;
  allowRead: boolean;
  allowGenerate: boolean;
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

export type ChangeKind = "screen" | "api" | "table";
export type ChangeAction = "add" | "change";

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

export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  screen: "Screen",
  api: "API",
  table: "Database table",
};

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
