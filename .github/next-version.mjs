// Works out the version a release should carry: the highest tag, plus one.
//
// **A faithful port of the PowerShell that lived inside the Windows job.** It
// moved out here for one reason: both platforms have to stamp the same number,
// and the only way to guarantee that without making Linux wait nineteen minutes
// for Windows is to count once, in a job of its own, that both depend on.
//
// Every rule the original had is kept, because each was learned:
//
// **Compared as numbers, never as text.** Sorted as text, `v0.2.9` outranks
// `v0.2.10` and the next release goes backwards.
//
// **`major.minor.patch` or nothing.** Cargo and Tauri both refuse anything else,
// and finding that out from a failed release build is a poor way to learn it.
//
// **A version that is already tagged is a refusal.** Two commits landing
// seconds apart once both counted 0.2.4 and both published to it; the second
// silently overwrote the first's installers and both runs reported success.
// The concurrency group makes that unlikely and this makes it loud.
//
// Exported for testing; run directly it prints the version and, under Actions,
// appends it to the step output.

/** The highest release already tagged, or null when there are none. */
export function highest(tags) {
  const versions = tags
    .map((t) => t.trim().replace(/^v/, ""))
    .filter((t) => /^\d+\.\d+\.\d+$/.test(t))
    .map((t) => t.split(".").map(Number));
  if (versions.length === 0) return null;
  versions.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return versions[versions.length - 1];
}

/** The next version to build, given the tags that exist. */
export function next(tags) {
  const top = highest(tags);
  // The first release of a repository with no tags at all.
  if (top === null) return "0.1.0";
  return `${top[0]}.${top[1]}.${top[2] + 1}`;
}

export function isWellFormed(version) {
  return /^\d+\.\d+\.\d+$/.test(version ?? "");
}

// Running directly rather than being imported by the tests.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const { execFileSync } = await import("node:child_process");
  const { appendFileSync } = await import("node:fs");

  const asked = process.env.INPUT_VERSION?.trim();
  const event = process.env.GITHUB_EVENT_NAME;

  const tags = execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  // A dispatched trial build carries its own number and publishes nothing.
  const version = event === "workflow_dispatch" && asked ? asked : next(tags);

  if (!isWellFormed(version)) {
    console.error(`Version "${version}" is not major.minor.patch.`);
    process.exit(1);
  }
  if (event === "push" && tags.includes(`v${version}`)) {
    console.error(`v${version} is already tagged. Refusing to overwrite a published release.`);
    process.exit(1);
  }

  console.log(`Building ${version}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  }
}
