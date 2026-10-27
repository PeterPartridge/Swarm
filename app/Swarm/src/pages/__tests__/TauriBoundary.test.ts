/** The one seam nothing else checks.
 *
 *  `invoke("set_product_policy", policy)` is a string and a bag of keys. Rust
 *  does not see the call site, TypeScript does not see the command, and
 *  `tsc`, `clippy`, `cargo test` and Vitest all pass while the two disagree.
 *  Three regressions have reached the user through this gap and every one of
 *  them looked, on screen, like a feature that "doesn't work": a policy panel
 *  whose switches would not turn on, a Plan button greyed out for no stated
 *  reason.
 *
 *  So this reads both sides as text and compares them. It is not a type
 *  system, and it is not trying to be — it catches the two mistakes that have
 *  actually happened:
 *
 *  1. calling a command that is not registered (or is misspelled), and
 *  2. sending a different set of argument names than the command takes,
 *     which is what happens when a parameter is added to Rust and the wrapper
 *     is left behind.
 *
 *  It reads the real files rather than a copy of the list, because a copy is
 *  another thing to forget to update. */
import { readFileSync, readdirSync } from "node:fs";

// Vitest runs from the app root, which is where both sides live.
const root = process.cwd();

/** Rust `work_item_id` is the wire's `workItemId` — serde and Tauri agree on
 *  camelCase for command arguments, so the comparison has to. */
export function camel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Command names in `generate_handler![…]`, without their module path. */
export function registeredCommands(mainRs: string): Set<string> {
  const block = mainRs.match(/generate_handler!\[([\s\S]*?)\]/);
  if (block === null) throw new Error("no generate_handler! in main.rs");
  const names = new Set<string>();
  for (const entry of block[1].split(",")) {
    const path = entry.trim();
    if (path === "") continue;
    names.add(path.split("::").pop() as string);
  }
  return names;
}

/** Arguments Tauri will hand to the app, per `#[tauri::command]`.
 *
 *  Injected parameters are dropped: the caller does not send an `AppHandle` or
 *  a `State`, Tauri supplies them, so they are not part of the payload. */
export function commandArgs(rust: string): Map<string, Set<string>> {
  const commands = new Map<string, Set<string>>();
  const re = /#\[tauri::command\][\s\S]*?fn\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:->|\{)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rust)) !== null) {
    const [, name, params] = match;
    const args = new Set<string>();
    // A parameter list can be commented — `// none where there is not one` —
    // and a comment is not a parameter.
    for (const param of splitParams(params.replace(/\/\/[^\n]*/g, ""))) {
      const colon = param.indexOf(":");
      if (colon === -1) continue;
      const argName = param.slice(0, colon).trim().replace(/^mut\s+/, "");
      const type = param.slice(colon + 1).trim();
      if (/^(State|AppHandle|Window|WebviewWindow|tauri::)/.test(type)) continue;
      args.add(camel(argName));
    }
    commands.set(name, args);
  }
  return commands;
}

/** Splits a parameter list on the commas that separate parameters, not the
 *  ones inside `State<'_, AppDb>` or `Option<Vec<String>>`. */
function splitParams(params: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of params) {
    if (ch === "<" || ch === "(" || ch === "[") depth += 1;
    if (ch === ">" || ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((p) => p.trim()).filter((p) => p !== "");
}

export interface Call {
  command: string;
  /** The keys sent, or `null` when the payload is not a shape this can read. */
  args: Set<string> | null;
  /** Where to look when it disagrees. */
  where: string;
}

/** Every `invoke(…)` in the wrapper module, with the keys it sends.
 *
 *  Two payload shapes are in use and both are read: an object literal at the
 *  call site, and a named parameter whose type literal is declared just above
 *  it — `(policy: { … }) => invoke("set_product_policy", policy)`, which is
 *  exactly where a missing argument hid the last time. */
export function invocations(ts: string): Call[] {
  const calls: Call[] = [];
  // Each `export const` starts a declaration; a payload identifier is always
  // declared inside the same one.
  const declarations = ts.split(/\nexport (?=const |function )/);
  for (const declaration of declarations) {
    const re = /invoke(?:<[^>]*>)?\(\s*"(\w+)"\s*(?:,\s*([\s\S]*?))?\)\s*;/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(declaration)) !== null) {
      const [, command, payload] = match;
      const name = declaration.match(/^(?:const |function )?(\w+)/)?.[1] ?? command;
      calls.push({
        command,
        args: payloadKeys(payload, declaration, ts),
        where: name,
      });
    }
  }
  return calls;
}

function payloadKeys(
  payload: string | undefined,
  declaration: string,
  ts: string,
): Set<string> | null {
  if (payload === undefined || payload.trim() === "") return new Set();
  const text = payload.trim();
  if (text.startsWith("{")) return resolve(objectKeys(text), declaration, ts);
  // A named payload: whatever `(policy: …)` was annotated as.
  if (/^\w+$/.test(text)) return typeKeys(text, declaration, ts);
  return null;
}

/** The keys of whatever `name` was annotated as in this declaration — an
 *  inline type literal, or a named interface declared elsewhere in the file. */
function typeKeys(
  name: string,
  declaration: string,
  ts: string,
): Set<string> | null {
  const inline = declaration.match(
    new RegExp(`\\b${name}\\s*:\\s*(\\{[\\s\\S]*?\\n\\s*\\})`),
  );
  if (inline !== null) return resolve(objectKeys(inline[1]), declaration, ts);
  const named = declaration.match(new RegExp(`\\b${name}\\s*:\\s*(\\w+)`));
  if (named === null) return null;
  const iface = ts.match(
    new RegExp(`\\binterface ${named[1]} (\\{[\\s\\S]*?\\n\\})`),
  );
  return iface === null ? null : resolve(objectKeys(iface[1]), declaration, ts);
}

/** Follows `{ ...rules }` to the keys of `rules`.
 *
 *  Worth following rather than skipping: spreading a typed object is how the
 *  longest argument lists are sent, and a long argument list is where a newly
 *  added parameter goes unnoticed. Unresolvable spreads make the whole payload
 *  unreadable — an incomplete key set would read as a mismatch that isn't one. */
function resolve(
  found: { keys: Set<string>; spreads: string[] },
  declaration: string,
  ts: string,
): Set<string> | null {
  const keys = new Set(found.keys);
  for (const spread of found.spreads) {
    const from = typeKeys(spread, declaration, ts);
    if (from === null) return null;
    for (const key of from) keys.add(key);
  }
  return keys;
}

/** Top-level keys of an object or type literal, ignoring nested ones, with
 *  any `...spread` kept apart from them. */
function objectKeys(source: string): { keys: Set<string>; spreads: string[] } {
  // Doc comments sit between the keys of an interface and are prose, not
  // keys; newlines are kept so the entries stay separated.
  const literal = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const keys = new Set<string>();
  const spreads: string[] = [];
  let depth = 0;
  let atKey = false;
  let current = "";
  const take = () => {
    const raw = current.trim();
    // Shorthand `{ id }`, `{ id: value }` and `{ id?: T }` all land here.
    if (raw.startsWith("...")) {
      const name = raw.slice(3).trim();
      if (/^\w+$/.test(name)) spreads.push(name);
    } else {
      const key = raw.replace(/\?$/, "");
      if (/^\w+$/.test(key)) keys.add(key);
    }
    current = "";
  };
  for (const ch of literal) {
    if (ch === "{") {
      depth += 1;
      atKey = depth === 1;
      continue;
    }
    if (ch === "}") {
      if (depth === 1) take();
      depth -= 1;
      current = "";
      atKey = depth === 1;
      continue;
    }
    if (depth !== 1) continue;
    if (ch === "," || ch === ";" || ch === "\n") {
      if (atKey) take();
      current = "";
      atKey = true;
      continue;
    }
    if (ch === ":") {
      take();
      atKey = false;
      continue;
    }
    if (atKey) current += ch;
  }
  return { keys, spreads };
}

const mainRs = readFileSync(`${root}/src-tauri/src/main.rs`, "utf8");
const commandsDir = `${root}/src-tauri/src/commands`;
const rust = readdirSync(commandsDir)
  .filter((f) => f.endsWith(".rs"))
  .map((f) => readFileSync(`${commandsDir}/${f}`, "utf8"))
  .join("\n");
const backend = readFileSync(`${root}/src/lib/backend.ts`, "utf8");

describe("the Tauri boundary", () => {
  const registered = registeredCommands(mainRs);
  const args = commandArgs(rust);
  const calls = invocations(backend);

  it("finds the two sides to compare", () => {
    // A parser that quietly reads nothing would make every check below pass.
    expect(registered.size).toBeGreaterThan(100);
    expect(args.size).toBeGreaterThan(100);
    expect(calls.length).toBeGreaterThan(100);
  });

  it("only calls commands the app has registered", () => {
    const unknown = calls
      .filter((c) => !registered.has(c.command))
      .map((c) => `${c.where} → ${c.command}`);
    expect(unknown).toEqual([]);
  });

  it("sends every argument the command takes, and no others", () => {
    const wrong: string[] = [];
    for (const call of calls) {
      const expected = args.get(call.command);
      if (expected === undefined || call.args === null) continue;
      const sent = call.args;
      const missing = [...expected].filter((a) => !sent.has(a));
      const extra = [...sent].filter((a) => !expected.has(a));
      if (missing.length > 0 || extra.length > 0) {
        wrong.push(
          `${call.where} → ${call.command}: missing [${missing.join(", ")}] extra [${extra.join(", ")}]`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("the boundary reader itself", () => {
  it("drops the arguments Tauri supplies", () => {
    const parsed = commandArgs(`
#[tauri::command]
pub async fn set_thing(
    db: State<'_, AppDb>,
    app: AppHandle,
    work_item_id: i64,
    names: Option<Vec<String>>,
) -> Result<(), String> {
`);
    expect(parsed.get("set_thing")).toEqual(new Set(["workItemId", "names"]));
  });

  it("reads a payload declared as a named parameter", () => {
    const [call] = invocations(`
export const setPolicy = (policy: {
  productId: number;
  allowEdit: boolean;
}): Promise<void> => invoke("set_product_policy", policy);
`);
    expect(call.args).toEqual(new Set(["productId", "allowEdit"]));
  });

  it("reads shorthand keys at the call site", () => {
    const [call] = invocations(`
export const rename = (id: number, name: string): Promise<void> =>
  invoke("rename_thing", { id, name });
`);
    expect(call.args).toEqual(new Set(["id", "name"]));
  });

  it("says nothing rather than guessing at a payload it cannot read", () => {
    const [call] = invocations(`
export const odd = (args: Args): Promise<void> => invoke("odd_thing", args);
`);
    expect(call.args).toBeNull();
  });
});
