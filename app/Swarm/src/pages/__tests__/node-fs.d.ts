/** The handful of file-reading functions the source-reading tests use.
 *
 *  **Not `@types/node`.** Two tests read the repository from disk — the one
 *  comparing `invoke(…)` call sites against the Rust commands they call, and
 *  the one checking that a hidden pane really hides — and installing Node's
 *  type package for them would put `process`, `Buffer` and
 *  Node's own `setTimeout` into every browser file in this project, where none
 *  of them exist at runtime. This is the whole of what that test needs.
 *
 *  A `.d.ts` rather than a `declare module` inside the test: inside a module,
 *  TypeScript reads that as *augmenting* `node:fs`, and there is nothing here
 *  to augment. */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

/** Where Vitest was started from — the app root, which both sides live under. */
declare const process: { cwd(): string };
