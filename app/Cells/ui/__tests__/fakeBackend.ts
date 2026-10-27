import { vi, type Mock } from "vitest";
import type { CellsBackend } from "../types";

export type FakeBackend = { [K in keyof CellsBackend]: Mock<CellsBackend[K]> };

const ALL: (keyof CellsBackend)[] = [
  "sandboxReport",
  "setUpSandbox",
  "setAgentSandbox",
  "getAgentPolicySource",
  "setAgentPolicySource",
  "fetchAgentPolicy",
  "runAgentPolicy",
  "getInstalledPolicy",
  "listSolutions",
  "previewPolicyInstall",
  "installPolicyIntoSolution",
  "devicePolicyExport",
  "saveDevicePolicyExport",
  "pickFolder",
];

/** A host for the panels, with `stubbed` as plain mocks for a test to set.
 *
 *  **Everything else rejects**, which is what these tests got before the
 *  panels moved here: a partial mock of the host's backend let anything
 *  unlisted fall through to a real Tauri call, and outside Tauri that rejects.
 *  Keeping it that way means moving the tests changed what they set up, not
 *  what they assert. */
export function fakeBackend(stubbed: (keyof CellsBackend)[]): FakeBackend {
  const fake = {} as Record<keyof CellsBackend, Mock>;
  for (const name of ALL) {
    fake[name] = stubbed.includes(name)
      ? vi.fn()
      : vi.fn(() => Promise.reject(new Error(`${name} is not stubbed in this test`)));
  }
  return fake as FakeBackend;
}
