/** Whether two paths name the same folder.
 *
 *  **Because the same folder arrives spelled three ways.** git reports
 *  `C:/repos/x`, the terminal registry reports `C:\repos\x`, and a run's
 *  worktree path can carry a trailing slash — comparing them as strings finds
 *  no match and the app starts a second agent in a checkout that already has
 *  one. Windows is relaxed about case, so this is too.
 *
 *  Shared the moment there were two readers: the terminal widget adopting a
 *  running shell, and the runs panel working out which runs already have one.
 *  Two copies of a path comparison drift, and the drift shows up as a duplicate
 *  agent rather than as an error. */
export function sameFolder(a: string, b: string): boolean {
  const tidy = (p: string) =>
    p.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
  return tidy(a) === tidy(b);
}
