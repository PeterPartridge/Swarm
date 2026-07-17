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
}

export interface Deliverable {
  id: number;
  productId: number;
  name: string;
  description: string;
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
}

export interface WorkItemPolicy {
  workItemId: number;
  allowRead: boolean;
  allowEdit: boolean;
  allowGenerateTests: boolean;
  providerId: number | null;
  effortTier: string;
}

export const EFFORT_TIERS = ["low", "medium", "high"] as const;

/** Suggested defaults for the AI Settings form (Claude first, pluggable). */
export const DEFAULT_PROVIDER = {
  name: "Claude",
  apiBaseUrl: "https://api.anthropic.com",
  models: "claude-opus-4-8, claude-sonnet-5",
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

/** The Project_brief questions a Product card asks (Part 1 + Part 3). */
export const PRODUCT_QUESTIONS: { id: string; label: string }[] = [
  { id: "purpose", label: "In one or two sentences, what is the purpose of this product?" },
  { id: "problem", label: "What problem does it solve, and for whom?" },
  { id: "users", label: "Who will use it?" },
  { id: "appsYouLike", label: "Are there any apps or websites you like?" },
  { id: "appsToAvoid", label: "Are there any apps or websites you want to avoid copying?" },
  { id: "designs", label: "Any designs, sketches, or look-and-feel notes?" },
];

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
export const generateUserStories = (featureId: number): Promise<string[]> =>
  invoke("generate_user_stories", { featureId });

// AI providers (keys live in the OS credential store — never returned)
export const listAiProviders = (): Promise<AiProvider[]> =>
  invoke("list_ai_providers");
export const addAiProvider = (args: {
  name: string;
  apiBaseUrl: string;
  models: string[];
  apiKey: string;
}): Promise<number> => invoke("add_ai_provider", args);
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
