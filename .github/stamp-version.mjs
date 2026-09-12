// Writes one version number into the three files that have to agree.
//
// **The same job the Windows step does in PowerShell.** That one came first and
// is left alone; this exists because the Linux runner has no pwsh worth
// assuming, and because inline JavaScript inside YAML inside a shell was three
// levels of quoting for a regex — which is how a stamp step silently replaces
// nothing.
//
// **Replacing nothing is the failure this guards against.** A silent no-op here
// ships an installer carrying the previous version, so each file is checked to
// have actually changed and the run fails loudly if it did not.
//
// Run from the repository root: node .github/stamp-version.mjs 0.3.0
import { promises as fs } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error(`"${version}" is not major.minor.patch — Cargo and Tauri both refuse anything else.`);
  process.exit(1);
}

const quoted = JSON.stringify(version);

// Only the **first** match in each file: a dependency's own version must never
// be the one rewritten, which is why none of these regexes are global and the
// Cargo one is anchored to the start of a line.
const files = [
  ["app/CoperativeAI/package.json", /("version"\s*:\s*)"[^"]*"/, (m, lead) => `${lead}${quoted}`],
  ["app/CoperativeAI/src-tauri/tauri.conf.json", /("version"\s*:\s*)"[^"]*"/, (m, lead) => `${lead}${quoted}`],
  ["app/CoperativeAI/src-tauri/Cargo.toml", /^version\s*=\s*"[^"]*"/m, () => `version = ${quoted}`],
];

for (const [path, pattern, replace] of files) {
  const before = await fs.readFile(path, "utf8");
  const after = before.replace(pattern, replace);
  if (after === before) {
    console.error(`No version field replaced in ${path} — refusing to build something mislabelled.`);
    process.exit(1);
  }
  await fs.writeFile(path, after);
  console.log(`stamped ${version} into ${path}`);
}
