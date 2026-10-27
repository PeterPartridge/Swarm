// Pure rules about a policy's address, shared by the panel and its tests.

/** The moving part of a GitHub address, when it has one — `main`, a branch
 *  name, a tag — or null when it names a commit or is not GitHub at all.
 *
 *  **A hint as it is typed, never the enforcement.** `sandbox_policy.rs` has
 *  the same rule and is what actually refuses to store a branch; this copy
 *  exists so the refusal is not a surprise on Save. If the two ever disagree,
 *  the backend's answer is the one that decides, and the worst this one can do
 *  is fail to warn early. */
export function movingGithubRef(from: string): string | null {
  const rest = from.trim().split("://")[1];
  if (!rest) return null;
  const cut = rest.indexOf("/");
  if (cut < 0) return null;
  const host = rest.slice(0, cut).toLowerCase();
  const hosts = ["github.com", "www.github.com", "raw.githubusercontent.com", "raw.github.com"];
  if (!hosts.includes(host)) return null;
  const parts = rest.slice(cut + 1).split("/").filter((p) => p !== "");
  const at =
    parts[2] === "blob" || parts[2] === "raw" ? 3 : host.startsWith("raw.") ? 2 : -1;
  if (at < 0) return null;
  // `refs/heads/main` names a branch just as plainly as `main` does.
  const named = parts[at] === "refs" ? parts[at + 2] : parts[at];
  if (!named) return null;
  return /^[0-9a-f]{40}$/i.test(named) ? null : named;
}
