// What the sandbox panels from Cells (`app/Cells/ui`) are given to talk to:
// this app's own Tauri wrappers, so the panels never reach a transport of
// their own.
import type { CellsBackend } from "@cells/types";
import {
  devicePolicyExport,
  fetchAgentPolicy,
  getAgentPolicySource,
  getInstalledPolicy,
  installPolicyIntoSolution,
  listSolutions,
  pickFolder,
  previewPolicyInstall,
  runAgentPolicy,
  sandboxReport,
  saveDevicePolicyExport,
  setAgentPolicySource,
  setAgentSandbox,
  setUpSandbox,
} from "./backend";

export const cellsBackend: CellsBackend = {
  sandboxReport,
  setUpSandbox,
  setAgentSandbox,
  getAgentPolicySource,
  setAgentPolicySource,
  fetchAgentPolicy,
  runAgentPolicy,
  getInstalledPolicy,
  listSolutions,
  previewPolicyInstall,
  installPolicyIntoSolution,
  devicePolicyExport,
  saveDevicePolicyExport,
  pickFolder,
};
