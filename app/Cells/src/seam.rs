//! Finding every file that starts a process, so a host can prove its callers
//! go through `sandbox::wrap`.
//!
//! **A seam only bounds what goes through it**, and nothing about Rust stops
//! somebody adding a process spawn in a new file next month. So a host reads
//! its own source with this and files each spawning file as sandboxed or as
//! outside-with-a-reason — Swarm's `the_only_way_out_is_through_here` does
//! exactly that. Cells checks its own files the same way below.
//!
//! It lives here rather than in either test because both need the same answer,
//! and two copies of a scanner would drift into two answers.

use std::path::Path;

/// What starting a process looks like in source. Built with `concat!` so this
/// file does not itself read as one that starts a process.
const SPAWNS: [&str; 2] = [concat!("Command", "::new("), concat!("CommandBuilder", "::new(")];

/// Every `.rs` file under `src` with a line that starts a process, named
/// relative to `src` with forward slashes so the lists read the same on both
/// platforms, and sorted.
///
/// Comment lines are skipped: two modules explain the Windows `.cmd` shim
/// problem by quoting a spawn in prose, and prose starts no process.
pub fn spawners(src: &Path) -> Vec<String> {
    let mut found = Vec::new();
    collect(src, src, &mut found);
    found.sort();
    found
}

fn collect(dir: &Path, src: &Path, found: &mut Vec<String>) {
    let entries = std::fs::read_dir(dir).expect("the source tree is readable");
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, src, found);
        } else if path.extension().is_some_and(|e| e == "rs") {
            // The seam names those tokens rather than using them, and by
            // design it never spawns anything — it decides and hands back.
            if path.file_name().is_some_and(|n| n == "sandbox.rs") {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            // **Only what ships.** A check's own fixture may well start a
            // process — making a repository to test against, say — and
            // listing the whole file for that would blind this to a real
            // spawn added to it later, which is the one thing it exists to
            // catch. So the scan stops where the tests begin.
            let text = match text.find("#[cfg(test)]") {
                Some(at) => text[..at].to_string(),
                None => text,
            };
            let spawns = text.lines().any(|line| {
                let line = line.trim_start();
                !line.starts_with("//") && SPAWNS.iter().any(|s| line.contains(s))
            });
            if spawns {
                let rel = path.strip_prefix(src).unwrap_or(&path);
                found.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cells' own spawns, each filed with its reason. Neither runs anybody's
    /// command: both are the app working on its own account, which is why
    /// neither goes through `wrap`. A new one fails this and asks which it is.
    #[test]
    fn cells_names_every_process_it_starts() {
        const OUTSIDE: &[(&str, &str)] = &[
            ("sandbox_detect.rs", "asking this machine what it has"),
            ("sandbox_docker.rs", "the app's own git plumbing — making a run its copy"),
        ];
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let listed: Vec<String> = OUTSIDE.iter().map(|(f, _)| (*f).to_string()).collect();
        assert_eq!(
            spawners(&src),
            listed,
            "Cells' spawning files changed. A command run on somebody's behalf goes through \
             sandbox::wrap; the app working on its own account joins OUTSIDE with the reason."
        );
    }
}
