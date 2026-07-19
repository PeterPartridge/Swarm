//! Reading a Solution's working copy: the file tree, a file's contents, and
//! what has changed.
//!
//! **The containment rule.** Every path this module returns or reads is
//! resolved and checked to be inside the Solution's recorded root. The frontend
//! sends relative paths, and a relative path is an untrusted string — `..\..\`
//! walks out of a repository and into the rest of the disk. Both the root and
//! the target are canonicalised (which resolves `..` and symlinks) and the
//! target must still start with the root. That check is the whole security
//! story of this module, so it lives in one function with its own tests.
//!
//! Read-only by design in this round. Nothing here writes to a working copy.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Directories never worth walking: enormous, generated, and not the work.
const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    "__pycache__",
    ".venv",
    "obj",
    "bin",
];

/// How deep the tree walk goes. A repository is a tree of unknown depth and
/// this is a panel, not a file manager.
const MAX_DEPTH: usize = 6;

/// How many entries to return before stopping. A monorepo would otherwise
/// serialise tens of thousands of paths into the UI.
const MAX_ENTRIES: usize = 2_000;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    /// Path relative to the root, with forward slashes on every platform so the
    /// frontend does not have to care which one it is on.
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub depth: usize,
}

#[derive(Debug, Clone, PartialEq, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTree {
    pub entries: Vec<TreeEntry>,
    /// True when the walk stopped early. A partial tree that does not say so
    /// reads as a complete one.
    pub truncated: bool,
}

/// Resolves a relative path against a root and refuses anything that escapes.
///
/// This is the security boundary of the module. `canonicalize` resolves `..`
/// and follows symlinks, so a path that *looks* contained but points elsewhere
/// is caught — string prefix checks alone would not catch a symlink.
pub fn resolve_within(root: &str, relative: &str) -> Result<PathBuf, String> {
    let root_path = Path::new(root)
        .canonicalize()
        .map_err(|_| format!("the folder for this Solution is not there any more: {root}"))?;
    // An absolute path in the relative slot is always a mistake or an attack.
    let candidate = Path::new(relative);
    if candidate.is_absolute() {
        return Err("that path is outside the Solution's folder".into());
    }
    let joined = root_path.join(candidate);
    let resolved = joined
        .canonicalize()
        .map_err(|_| format!("there is nothing at {relative}"))?;
    if !resolved.starts_with(&root_path) {
        return Err("that path is outside the Solution's folder".into());
    }
    Ok(resolved)
}

/// Walks the working copy, breadth-first, skipping generated directories.
pub fn read_tree(root: &str) -> Result<FileTree, String> {
    let root_path = Path::new(root)
        .canonicalize()
        .map_err(|_| format!("the folder for this Solution is not there any more: {root}"))?;
    let mut tree = FileTree::default();
    let mut queue: Vec<(PathBuf, usize)> = vec![(root_path.clone(), 0)];

    while let Some((dir, depth)) = queue.pop() {
        if depth >= MAX_DEPTH {
            tree.truncated = true;
            continue;
        }
        let Ok(read) = std::fs::read_dir(&dir) else {
            // An unreadable directory is not fatal — a permissions problem in
            // one corner should not blank the whole panel.
            continue;
        };
        let mut children: Vec<TreeEntry> = Vec::new();
        for entry in read.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = path.is_dir();
            if is_dir && SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            let Ok(relative) = path.strip_prefix(&root_path) else {
                continue;
            };
            children.push(TreeEntry {
                path: relative.to_string_lossy().replace('\\', "/"),
                name,
                is_dir,
                depth,
            });
            if is_dir {
                queue.push((path, depth + 1));
            }
        }
        // Folders first, then alphabetical — the order a person expects.
        children.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
        for child in children {
            if tree.entries.len() >= MAX_ENTRIES {
                tree.truncated = true;
                return Ok(tree);
            }
            tree.entries.push(child);
        }
    }
    tree.entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(tree)
}

/// The largest file this will return. Past this it is not source, and putting
/// it in a text panel helps nobody.
const MAX_FILE_BYTES: u64 = 512 * 1024;

/// Reads one file from the working copy, refusing anything outside it.
pub fn read_file(root: &str, relative: &str) -> Result<String, String> {
    let path = resolve_within(root, relative)?;
    if path.is_dir() {
        return Err(format!("{relative} is a folder, not a file"));
    }
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if size > MAX_FILE_BYTES {
        return Err(format!(
            "{relative} is {} KB — too big to show here",
            size / 1024
        ));
    }
    match std::fs::read(&path) {
        Ok(bytes) => String::from_utf8(bytes)
            .map_err(|_| format!("{relative} is not text, so there is nothing to show")),
        Err(e) => Err(format!("could not read {relative}: {e}")),
    }
}

/// One file's worth of change.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// "added" | "modified" | "deleted" | "renamed"
    pub status: String,
    pub added_lines: i64,
    pub removed_lines: i64,
    /// The unified diff for this file.
    pub diff: String,
}

/// Reads the uncommitted changes in a working copy.
///
/// Deliberately git rather than a filesystem comparison: git already knows what
/// changed, and reimplementing that badly would be the worst kind of work.
pub fn read_changes(root: &str) -> Result<Vec<FileChange>, String> {
    let root_path = Path::new(root)
        .canonicalize()
        .map_err(|_| format!("the folder for this Solution is not there any more: {root}"))?;
    if !root_path.join(".git").exists() {
        return Err("this Solution's folder is not a git repository, so there is nothing to compare against".into());
    }
    // Include untracked files: work an agent just wrote is usually new files,
    // and a review that silently omitted them would be worse than no review.
    let name_status = git(&root_path, &["status", "--porcelain=v1", "--untracked-files=all"])?;

    let mut changes = Vec::new();
    for line in name_status.lines() {
        if line.len() < 4 {
            continue;
        }
        let code = line[..2].trim().to_string();
        let path = line[3..].trim().trim_matches('"').to_string();
        // Renames read as "old -> new"; the new name is the one to review.
        let path = path.split(" -> ").last().unwrap_or(&path).to_string();
        let status = match code.as_str() {
            "??" | "A" => "added",
            "D" => "deleted",
            c if c.starts_with('R') => "renamed",
            _ => "modified",
        }
        .to_string();

        let diff = if status == "added" {
            // An untracked file has nothing to diff against, so its whole
            // content is the change.
            read_file(root, &path).unwrap_or_default()
        } else {
            git(&root_path, &["diff", "--", &path]).unwrap_or_default()
        };
        let (added_lines, removed_lines) = count_changed_lines(&diff, &status);
        changes.push(FileChange { path, status, added_lines, removed_lines, diff });
    }
    Ok(changes)
}

/// Counts the +/- lines in a unified diff. For an added file the diff *is* the
/// content, so every line counts as added.
fn count_changed_lines(diff: &str, status: &str) -> (i64, i64) {
    if status == "added" {
        return (diff.lines().count() as i64, 0);
    }
    let mut added = 0;
    let mut removed = 0;
    for line in diff.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            added += 1;
        } else if line.starts_with('-') {
            removed += 1;
        }
    }
    (added, removed)
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .current_dir(root)
        .args(args)
        .output()
        .map_err(|e| format!("could not run git — is it installed? ({e})"))?;
    if !output.status.success() {
        return Err(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_repo(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "coperativeai-workspace-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src")).expect("create");
        fs::create_dir_all(dir.join("node_modules/junk")).expect("create");
        fs::write(dir.join("README.md"), "# Hi").expect("write");
        fs::write(dir.join("src/main.rs"), "fn main() {}").expect("write");
        fs::write(dir.join("node_modules/junk/x.js"), "junk").expect("write");
        dir
    }

    #[test]
    fn the_tree_skips_generated_directories_and_sorts_predictably() {
        let dir = temp_repo("tree");
        let root = dir.to_string_lossy().to_string();

        let tree = read_tree(&root).expect("tree");
        let paths: Vec<&str> = tree.entries.iter().map(|e| e.path.as_str()).collect();

        assert!(paths.contains(&"README.md"));
        assert!(paths.contains(&"src"));
        assert!(paths.contains(&"src/main.rs"));
        assert!(
            !paths.iter().any(|p| p.starts_with("node_modules")),
            "node_modules is enormous, generated, and not the work: {paths:?}"
        );
        // forward slashes on every platform, so the frontend need not care
        assert!(paths.iter().all(|p| !p.contains('\\')));
        let _ = fs::remove_dir_all(&dir);
    }

    /// The security boundary of this module. A relative path from the frontend
    /// is an untrusted string.
    #[test]
    fn a_path_cannot_escape_the_solutions_folder() {
        let dir = temp_repo("escape");
        let root = dir.to_string_lossy().to_string();

        resolve_within(&root, "src/main.rs").expect("inside is fine");

        for attempt in ["../..", "../../Windows/System32", "..\\..\\secrets.txt"] {
            assert!(
                resolve_within(&root, attempt).is_err(),
                "{attempt} must be refused"
            );
        }
        // an absolute path in the relative slot is always wrong
        assert!(resolve_within(&root, "/etc/passwd").is_err());
        assert!(resolve_within(&root, "C:\\Windows\\win.ini").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reading_a_file_returns_its_text_and_refuses_a_folder() {
        let dir = temp_repo("read");
        let root = dir.to_string_lossy().to_string();

        assert_eq!(read_file(&root, "src/main.rs").expect("read"), "fn main() {}");
        assert!(read_file(&root, "src").is_err(), "a folder is not a file");
        assert!(read_file(&root, "nope.txt").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    /// A folder that is not a repository has nothing to compare against, and
    /// saying so beats an empty review that looks like "no changes".
    #[test]
    fn changes_need_a_git_repository_and_say_so_when_there_is_none() {
        let dir = temp_repo("nogit");
        let root = dir.to_string_lossy().to_string();

        let err = read_changes(&root).expect_err("not a repo");
        assert!(err.contains("not a git repository"), "got: {err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_added_file_counts_its_whole_content_as_added() {
        let (added, removed) = count_changed_lines("line one\nline two", "added");
        assert_eq!((added, removed), (2, 0));
    }

    /// The +++/--- header lines are not changes and must not be counted.
    #[test]
    fn diff_headers_are_not_counted_as_changed_lines() {
        let diff = "--- a/src/main.rs\n+++ b/src/main.rs\n@@ -1 +1,2 @@\n fn main() {}\n+// new\n-// gone";
        assert_eq!(count_changed_lines(diff, "modified"), (1, 1));
    }
}
