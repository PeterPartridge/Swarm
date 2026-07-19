// Thin wrapper over Tauri invoke so pages depend on one mockable module.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/** Opens the OS folder picker; returns the chosen path, or null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  const chosen = await open({ directory: true, multiple: false });
  return typeof chosen === "string" ? chosen : null;
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
}

export interface GithubStatus {
  connected: boolean;
}

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
}

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
];

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
}): Promise<void> => invoke("update_work_item", args);
export const deleteWorkItem = (id: number): Promise<void> =>
  invoke("delete_work_item", { id });
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
