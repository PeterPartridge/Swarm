/** The two file-reading functions the boundary test uses.
 *
 *  **Not `@types/node`.** One test reads the repository from disk — the one
 *  that compares `invoke(…)` call sites against the Rust commands they call —
 *  and installing Node's type package for it would put `process`, `Buffer` and
 *  Node's own `setTimeout` into every browser file in this project, where none
 *  of them exist at runtime. This is the whole of what that test needs.
 *
 *  A `.d.ts` rather than a `declare module` inside the test: inside a module,
 *  TypeScript reads that as *augmenting* `node:fs`, and there is nothing here
 *  to augment. */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
  export function readdirSync(path: string): string[];
}

/** Where Vitest was started from — the app root, which both sides live under. */
declare const process: { cwd(): string };
