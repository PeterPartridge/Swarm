//! Scratch folders for tests, kept in one place and swept of old runs.
//!
//! **The problem this solves is 316 folders in `%TEMP%`.** Several suites here
//! need a real directory — a git repository with real commits, a tree of files
//! to emit into — because the thing under test shells out to `git` or touches
//! the filesystem, and a mock of either would be testing the mock. Each helper
//! made a uniquely named folder and left it behind, so a machine that had run
//! the suite a few dozen times had a `%TEMP%` full of them.
//!
//! **Why not delete on `Drop`.** That is the obvious answer and it is the wrong
//! one: the moment a test fails is the moment its scratch folder is worth
//! looking at, and a guard that tidied up would take the evidence with it
//! exactly when it mattered. It would also mean changing every call site to
//! hold the guard, which is two dozen tests' worth of churn for a tidiness fix.
//!
//! So folders survive the run that made them and are swept by a *later* one.
//! Everything lives under a single parent, and anything in it older than
//! [`KEEP`] goes on the next run — recent enough to still be looked at, old
//! enough that yesterday's are gone.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

/// How long a scratch folder outlives the run that made it.
///
/// Long enough to inspect a failure over lunch, short enough that a suite run
/// twice a day never accumulates.
const KEEP: Duration = Duration::from_secs(6 * 60 * 60);

/// The one folder every test scratch directory lives under.
pub fn root() -> PathBuf {
    std::env::temp_dir().join("coperativeai-tests")
}

/// A fresh scratch folder, with old ones swept away.
///
/// `what` names the suite and `name` the case, so a folder left behind by a
/// failure says which test made it without anybody having to guess.
///
/// The process and thread ids are in the name because the test harness runs
/// cases in parallel: two threads asking for the same `name` at the same moment
/// must not be handed the same directory.
pub fn scratch(what: &str, name: &str) -> PathBuf {
    sweep();
    let dir = root().join(format!(
        "{what}-{name}-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    // Any leftover from *this* process is this test's own from a previous run
    // in the same session, and starting from a dirty directory is how a test
    // passes for the wrong reason.
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create a scratch folder");
    dir
}

/// Removes scratch folders older than [`KEEP`].
///
/// **Deliberately forgiving.** A folder that will not delete — held open by an
/// editor, or by a process still exiting — is skipped rather than failing the
/// test that happened to run next. Sweeping is tidiness, and tidiness must
/// never be the reason a suite goes red.
fn sweep() {
    let root = root();
    if std::fs::create_dir_all(&root).is_err() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(&root) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|when| now.duration_since(when).ok())
            .is_some_and(|age| age > KEEP);
        if stale {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

/// The same, as a string — for the callers that want one.
pub fn scratch_str(what: &str, name: &str) -> String {
    scratch(what, name).to_string_lossy().into_owned()
}

/// A path inside the scratch root that deliberately does **not** exist.
///
/// For the tests that check what happens when a folder is missing, which
/// previously reached for a made-up name in `%TEMP%` directly.
pub fn missing(name: &str) -> PathBuf {
    root().join(format!("{name}-does-not-exist-{}", std::process::id()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two cases running at once must not be handed the same folder — the test
    /// harness runs them in parallel, and a shared directory is a test that
    /// fails only when the machine is busy.
    #[test]
    fn two_names_get_two_folders() {
        let a = scratch("selftest", "one");
        let b = scratch("selftest", "two");
        assert_ne!(a, b);
        assert!(a.is_dir() && b.is_dir());
    }

    /// Everything under one parent, which is the whole point.
    #[test]
    fn every_scratch_folder_lives_under_the_one_root() {
        let dir = scratch("selftest", "under-root");
        assert!(dir.starts_with(root()), "{dir:?} escaped {:?}", root());
    }

    /// A folder left over from an earlier run of the same test is cleared, or a
    /// case could pass on a file it did not write.
    #[test]
    fn a_scratch_folder_starts_empty() {
        let first = scratch("selftest", "reused");
        std::fs::write(first.join("stale.txt"), "old").expect("write");
        let second = scratch("selftest", "reused");
        assert_eq!(first, second, "the same name means the same folder");
        assert!(!second.join("stale.txt").exists(), "it should have been cleared");
    }

    /// Sweeping is tidiness, and tidiness must never turn a suite red.
    #[test]
    fn sweeping_an_unreadable_root_is_not_an_error() {
        sweep();
        sweep();
    }
}
