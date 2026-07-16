// Thin wrapper over Tauri invoke so pages depend on one mockable module.
import { invoke } from "@tauri-apps/api/core";

export interface WorkItem {
  id: number;
  title: string;
  itemType: string;
  status: string;
  description: string | null;
  repositoryId: number;
  parentItemId: number | null;
}

export interface Repository {
  id: number;
  name: string;
  localPath: string;
  isActive: boolean;
}

export const ITEM_TYPES = ["feature", "bug", "test", "spec"] as const;
export const STATUSES = [
  "planned",
  "designing",
  "building",
  "testing",
  "done",
] as const;

export function listWorkItems(): Promise<WorkItem[]> {
  return invoke("list_work_items");
}

export function createWorkItem(args: {
  title: string;
  itemType: string;
  repositoryId: number;
  description?: string;
}): Promise<number> {
  return invoke("create_work_item", args);
}

export function updateWorkItemStatus(id: number, status: string): Promise<void> {
  return invoke("update_work_item_status", { id, status });
}

export function deleteWorkItem(id: number): Promise<void> {
  return invoke("delete_work_item", { id });
}

export function listRepositories(): Promise<Repository[]> {
  return invoke("list_repositories");
}

export function addRepository(name: string, localPath: string): Promise<number> {
  return invoke("add_repository", { name, localPath });
}
