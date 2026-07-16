// Thin wrapper over Tauri invoke so pages depend on one mockable module.
import { invoke } from "@tauri-apps/api/core";

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
}

export interface TeamMember {
  id: number;
  name: string;
  role: string;
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
}

export interface Repository {
  id: number;
  name: string;
  localPath: string;
  isActive: boolean;
}

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

// Products
export const listProducts = (): Promise<Product[]> => invoke("list_products");
export const createProduct = (name: string, answers: string): Promise<number> =>
  invoke("create_product", { name, answers });
export const getProduct = (id: number): Promise<Product> =>
  invoke("get_product", { id });
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

// Team members
export const listTeamMembers = (): Promise<TeamMember[]> =>
  invoke("list_team_members");
export const addTeamMember = (name: string, role: string): Promise<number> =>
  invoke("add_team_member", { name, role });
export const removeTeamMember = (id: number): Promise<void> =>
  invoke("remove_team_member", { id });

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
}): Promise<void> => invoke("update_work_item", args);
export const deleteWorkItem = (id: number): Promise<void> =>
  invoke("delete_work_item", { id });
export const generateUserStories = (featureId: number): Promise<void> =>
  invoke("generate_user_stories", { featureId });

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
