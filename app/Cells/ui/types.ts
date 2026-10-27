// What the sandbox panels show and send, and what they need a host to do.
//
// Moved here from Swarm's `lib/backend.ts` with the panels. The shapes are the
// Rust side's (`app/Cells/src`), serialised; a host supplies the calls through
// the interfaces at the bottom, so the panels never reach a transport of their
// own.

/** Whether one protection is actually doing anything.
 *
 *  Three states, and the middle one carries the weight: a machine that *could*
 *  run containers is not a machine that is running one. Neither sandbox is
 *  built, so nothing is `enforced` — and a tick against a mode that refuses
 *  every command would be the exact claim this panel exists to prevent. */
export type ProtectionState = "enforced" | "availableNotBuilt" | "unavailable";

export interface Protection {
  name: string;
  state: ProtectionState;
  /** Why. Never empty — an unexplained verdict is one you have to guess at. */
  detail: string;
}

export interface SandboxMode {
  id: string;
  label: string;
  /** Whether this mode runs anything at all yet. */
  built: boolean;
  summary: string;
  /** Whether this mode can be chosen here, now — not the same as `built`. */
  canChoose: boolean;
  /** Why it cannot be chosen, when it cannot. Never empty. */
  chooseDetail: string;
  /** Whether the app could build this mode's boundary here, now. Separate from
   *  `built`: one is about the machine, the other about the app. */
  canSetUp: boolean;
  /** What setting it up would do, or why it cannot be — never empty, because
   *  an unexplained disabled button is worse than no button. */
  setUpDetail: string;
  protections: Protection[];
}

export interface SetUpStep {
  name: string;
  succeeded: boolean;
  /** Whole, in the tool's own words. When a toolchain is missing this is the
   *  only thing that names it. */
  output: string;
}

export interface SetUpResult {
  mode: string;
  steps: SetUpStep[];
  succeeded: boolean;
  summary: string;
}

export interface SandboxReport {
  modes: SandboxMode[];
  chosen: string;
}

/** Where an agent policy comes from, what installs it, and where it lands.
 *
 *  Three fields rather than one, because fetching and running are two
 *  different acts — and keeping them apart is what lets the thing be read
 *  before it is run, which is the only safeguard against a policy somebody
 *  else wrote. */
export interface AgentPolicySource {
  /** An https address, or a file on this machine. Empty means no policy. */
  from: string;
  /** The command that installs it, run where the agent will run. */
  command: string;
  /** The folder it is downloaded into. */
  folder: string;
  /** The SHA-256 it must have, or empty for "whatever arrives".
   *
   *  Empty is trust-on-first-use and nothing more: the digest can be shown so
   *  it can be compared against what the policy's author said, but until it is
   *  set here, every fetch is checked against nothing. */
  expectDigest: string;
}

/** A policy brought to this machine, and what it says. */
export interface FetchedPolicy {
  /** Where it landed here. */
  path: string;
  bytes: number;
  /** What it says, for reading before it is run. */
  text: string;
  /** Whether that is only the beginning of it. */
  truncated: boolean;
  /** SHA-256 of the whole file, lowercase hex — of the bytes, not of `text`. */
  digest: string;
  /** Whether it was checked against a digest set beforehand, or only shown. */
  verified: boolean;
  /** What arrived, which decides what can be done with it. */
  shape: PolicyShape;
}

/** What a fetched file turned out to be.
 *
 *  **One fetch, two honest destinations.** A deny list is written into a
 *  Solution and honoured by both backends; a script is run as root into the WSL
 *  distribution and does nothing at all under Docker. */
export type PolicyShape = "policy" | "script";

/** What installing one policy over another would change. */
export interface PolicyChange {
  added: string[];
  /** The half that matters: rules this would stop enforcing. */
  removed: string[];
  kept: string[];
  /** Whether the Solution has a policy at all today. */
  hadOne: boolean;
}

/** The policy script that was last run into the boundary.
 *
 *  **A different thing from a Solution's `policy.json`.** That file is a deny
 *  list, read on every run and enforced by whichever boundary is in force.
 *  This is an imperative script, app-wide, run as root into the WSL
 *  distribution by a press — it produces no deny list, and under Docker it
 *  never runs at all.
 *
 *  **What was run, never what is still in force.** Nothing watches the
 *  distribution afterwards; root inside it can undo anything this did. */
export interface InstalledPolicy {
  /** Where the script came from. Empty means none has ever been run. */
  from: string;
  /** The SHA-256 of what actually ran. */
  digest: string;
  /** The boundary it was run into — only ever "wsl" today. */
  mode: string;
  /** When it ran, in milliseconds since the epoch. */
  at: number;
}

/** Which form of device-policy export somebody wants. */
export type DevicePolicyExportKind = "registry" | "script";

/** Just enough of a host's project for a policy to be installed into it. */
export interface SolutionRef {
  id: number;
  name: string;
}

/** What the sandbox table needs a host to do. */
export interface SandboxBackend {
  sandboxReport: () => Promise<SandboxReport>;
  setUpSandbox: (mode: string) => Promise<SetUpResult>;
  setAgentSandbox: (mode: string) => Promise<void>;
}

/** What the policy-source panel needs a host to do. */
export interface PolicyBackend {
  getAgentPolicySource: () => Promise<AgentPolicySource>;
  setAgentPolicySource: (source: AgentPolicySource) => Promise<void>;
  fetchAgentPolicy: () => Promise<FetchedPolicy>;
  runAgentPolicy: (fetched: FetchedPolicy) => Promise<string>;
  getInstalledPolicy: () => Promise<InstalledPolicy>;
  listSolutions: () => Promise<SolutionRef[]>;
  previewPolicyInstall: (solutionId: number, fetched: FetchedPolicy) => Promise<PolicyChange>;
  installPolicyIntoSolution: (solutionId: number, fetched: FetchedPolicy) => Promise<PolicyChange>;
}

/** What the device-policy export needs a host to do. */
export interface DevicePolicyBackend {
  devicePolicyExport: (kind: DevicePolicyExportKind) => Promise<string>;
  saveDevicePolicyExport: (kind: DevicePolicyExportKind, folder: string) => Promise<string>;
  /** The host's folder picker; null when somebody cancels. */
  pickFolder: () => Promise<string | null>;
}

/** Everything the panels need, which is what `SandboxTable` takes because it
 *  renders the other two. */
export type CellsBackend = SandboxBackend & PolicyBackend & DevicePolicyBackend;
