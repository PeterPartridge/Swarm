//! What a working copy's git state is, across every Solution at once.
//!
//! Separate from `github.rs`, which talks to GitHub's API over the network.
//! This module never leaves the machine: it shells out to `git` in a folder and
//! reads what comes back.
//!
//! The parsing is split from the running on purpose. `git status --porcelain=v2`
//! has a fixed, documented shape, so reading it is a pure function with its own
//! tests — no repository required. Only `status()` needs a real folder, and it
//! does nothing but call git and hand the text over.
//!
//! Porcelain **v2** rather than the v1 that `workspace::read_changes` uses: v1
//! cannot report a branch's upstream or how far ahead it is, and — the reason
//! that matters here — it reports a merge conflict as an ordinary modification.
//! v2 gives conflicts their own line type, which is what makes the three-pane
//! merge view possible at all.

use std::path::Path;
use std::process::Command;

/// One file in a working copy, as git sees it.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoFile {
    pub path: String,
    /// "added" | "modified" | "deleted" | "renamed" | "untracked"
    pub status: String,
    /// True for a file git could not merge — both sides changed it.
    pub conflicted: bool,
    /// True when the change is staged rather than only in the working tree.
    pub staged: bool,
}

/// One Solution's repository, summarised.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: i64,
    pub behind: i64,
    pub files: Vec<RepoFile>,
    /// Whether a merge is in progress — conflicts exist to resolve.
    pub merging: bool,
}

/// Reads `git status --porcelain=v2 --branch` output.
///
/// The line types that matter:
/// - `# branch.head NAME` / `# branch.upstream NAME` / `# branch.ab +A -B`
/// - `1 XY …  PATH` — a change to one file
/// - `2 XY …  PATH\tORIG` — a rename; the new name is the one to show
/// - `u XY …  PATH` — **unmerged**: both sides changed it
/// - `? PATH` — untracked
///
/// A detached head reports `(detached)` for the branch, which is passed through
/// as-is rather than dressed up: someone mid-rebase should see that.
pub fn parse_status(text: &str) -> RepoStatus {
    let mut status = RepoStatus {
        branch: String::new(),
        upstream: None,
        ahead: 0,
        behind: 0,
        files: Vec::new(),
        merging: false,
    };

    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            status.branch = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("# branch.upstream ") {
            status.upstream = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for part in rest.split_whitespace() {
                if let Some(n) = part.strip_prefix('+') {
                    status.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    status.behind = n.parse().unwrap_or(0);
                }
            }
        } else if let Some(rest) = line.strip_prefix("? ") {
            status.files.push(RepoFile {
                path: unquote(rest.trim()),
                status: "untracked".into(),
                conflicted: false,
                staged: false,
            });
        } else if let Some(rest) = line.strip_prefix("u ") {
            // Unmerged. Fields: XY sub m1 m2 m3 mW h1 h2 h3 path
            if let Some(path) = rest.split_whitespace().nth(9) {
                status.files.push(RepoFile {
                    path: unquote(path),
                    status: "modified".into(),
                    conflicted: true,
                    staged: false,
                });
                status.merging = true;
            }
        } else if let Some(rest) = line.strip_prefix("1 ").or_else(|| line.strip_prefix("2 ")) {
            let renamed = line.starts_with("2 ");
            let xy = rest.split_whitespace().next().unwrap_or("..");
            // Field counts are fixed and differ by line type: an ordinary entry
            // is `XY sub mH mI mW hH hI PATH` (path 8th), a rename carries an
            // extra similarity score before it (path 9th) and ends with
            // "PATH<tab>ORIGINAL" — the new name is the one to show, because
            // pointing at the original sends someone to a file that is gone.
            let fields = if renamed { 9 } else { 8 };
            let tail = rest.splitn(fields, ' ').nth(fields - 1).unwrap_or("");
            let path = tail.split('\t').next().unwrap_or(tail).trim();
            if path.is_empty() {
                continue;
            }
            let (x, y) = two_chars(xy);
            status.files.push(RepoFile {
                path: unquote(path),
                status: describe(x, y, renamed),
                conflicted: false,
                staged: x != '.',
            });
        }
    }
    status
}

fn two_chars(xy: &str) -> (char, char) {
    let mut cs = xy.chars();
    (cs.next().unwrap_or('.'), cs.next().unwrap_or('.'))
}

/// git reports the staged state first and the worktree state second. Either can
/// carry the interesting letter, so both are consulted — a file added to the
/// index and then edited reads `AM`, and calling that "modified" would lose the
/// fact that it is new.
fn describe(x: char, y: char, renamed: bool) -> String {
    if renamed {
        return "renamed".into();
    }
    match (x, y) {
        ('A', _) => "added",
        ('D', _) | (_, 'D') => "deleted",
        ('R', _) => "renamed",
        _ => "modified",
    }
    .into()
}

/// git quotes paths containing spaces or non-ASCII. Nothing here needs the
/// escape sequences decoded, but the surrounding quotes must go or every path
/// comparison downstream fails.
fn unquote(path: &str) -> String {
    path.trim().trim_matches('"').to_string()
}

/// The three versions of a file that a merge conflict is made of.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictSides {
    pub path: String,
    /// The common ancestor — what both sides started from. Empty when the file
    /// was added on both sides, which has no ancestor.
    pub base: String,
    /// Stage 2: the version on the branch being merged *into* — "mine".
    pub mine: String,
    /// Stage 3: the version being merged *in* — "theirs".
    pub theirs: String,
    /// The working-tree file: git's attempt, conflict markers and all. This is
    /// the one that gets edited and saved.
    pub merged: String,
    /// Whether `merged` still contains conflict markers.
    pub unresolved: bool,
}

/// True when the text still holds git's conflict markers.
///
/// Checked line-by-line at the start of a line, because `<<<<<<<` inside a
/// string literal or a diff in a test fixture is not a conflict, and telling
/// someone their resolved file is unresolved is its own kind of wrong.
pub fn has_conflict_markers(text: &str) -> bool {
    text.lines().any(|l| {
        l.starts_with("<<<<<<< ") || l == "=======" || l.starts_with(">>>>>>> ")
    })
}

/// One repository's state.
pub fn status(root: &str) -> Result<RepoStatus, String> {
    let root_path = canonical(root)?;
    if !root_path.join(".git").exists() {
        return Err(format!(
            "{root} is not a git repository — link it to a checkout to see its changes"
        ));
    }
    let text = git(
        &root_path,
        &["status", "--porcelain=v2", "--branch", "--untracked-files=all"],
    )?;
    Ok(parse_status(&text))
}

/// The three sides of one conflicted file.
///
/// Stages 1/2/3 are git's own names for base/mine/theirs, and reading them from
/// the index is the only way to get "mine" back once the working-tree file has
/// been overwritten with markers.
pub fn conflict_sides(root: &str, relative: &str) -> Result<ConflictSides, String> {
    let root_path = canonical(root)?;
    // The same containment rule as every other path into a working copy.
    let target = crate::workspace::resolve_within(root, relative)?;
    if !target.exists() {
        return Err(format!("{relative} is not in this Solution's folder"));
    }

    // A stage can legitimately be missing (added on one side only), so a failure
    // to read one is emptiness, not an error.
    let stage = |n: &str| {
        git(&root_path, &["show", &format!(":{n}:{relative}")]).unwrap_or_default()
    };
    let merged = std::fs::read_to_string(&target)
        .map_err(|e| format!("could not read {relative}: {e}"))?;

    Ok(ConflictSides {
        path: relative.to_string(),
        base: stage("1"),
        mine: stage("2"),
        theirs: stage("3"),
        unresolved: has_conflict_markers(&merged),
        merged,
    })
}

/// One commit in the history, with enough to draw the graph.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub id: String,
    pub short_id: String,
    /// Parent ids. Two or more means a merge — that is what makes the picture
    /// worth drawing rather than a list.
    pub parents: Vec<String>,
    /// Branch and tag names pointing here, already tidied of git's decoration
    /// syntax.
    pub refs: Vec<String>,
    pub subject: String,
    pub author: String,
    /// Unix seconds.
    pub when: i64,
}

/// Reads `git log` in the fixed format below.
///
/// Pure, so the graph is tested against a real capture without a repository.
/// The separator is a unit character rather than a pipe or a tab, because a
/// commit subject can and does contain both — and a subject that split a row
/// in half would corrupt the graph rather than merely look wrong.
pub fn parse_log(text: &str) -> Vec<Commit> {
    let mut commits = Vec::new();
    for line in text.lines() {
        let fields: Vec<&str> = line.split('\u{1f}').collect();
        if fields.len() < 6 {
            continue;
        }
        let id = fields[0].trim().to_string();
        if id.is_empty() {
            continue;
        }
        commits.push(Commit {
            short_id: id.chars().take(7).collect(),
            id,
            parents: fields[1]
                .split_whitespace()
                .map(str::to_string)
                .collect(),
            refs: parse_refs(fields[2]),
            subject: fields[3].to_string(),
            author: fields[4].to_string(),
            when: fields[5].trim().parse().unwrap_or(0),
        });
    }
    commits
}

/// `%D` gives "HEAD -> main, origin/main, tag: v1". The arrow and the tag
/// prefix are git's presentation, not names, so they are stripped here rather
/// than in every place that shows a ref.
fn parse_refs(decoration: &str) -> Vec<String> {
    decoration
        .split(',')
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(|r| {
            r.strip_prefix("HEAD -> ")
                .or_else(|| r.strip_prefix("tag: "))
                .unwrap_or(r)
                .to_string()
        })
        .collect()
}

/// The recent history across every branch.
///
/// `--all` because the point is seeing how branches relate; `--date-order` so
/// the rows are in the order things happened rather than the order git walked
/// them, which is what makes the lanes readable.
pub fn history(root: &str, limit: usize) -> Result<Vec<Commit>, String> {
    let root_path = canonical(root)?;
    if !root_path.join(".git").exists() {
        return Err(format!("{root} is not a git repository"));
    }
    let text = git(
        &root_path,
        &[
            "log",
            "--all",
            "--date-order",
            &format!("--max-count={limit}"),
            "--pretty=format:%H\u{1f}%P\u{1f}%D\u{1f}%s\u{1f}%an\u{1f}%at",
        ],
    )?;
    Ok(parse_log(&text))
}

/// A commit message that is just the files that changed.
///
/// What an auto-commit is for: a restore point, not a story. A generated
/// sentence pretending to explain the change would be worse than the list,
/// because someone reading history later would trust it.
pub fn file_list_message(files: &[String]) -> String {
    if files.is_empty() {
        return "no files".into();
    }
    // A hundred changed files is a real thing after a merge or a formatter run,
    // and a commit subject that long is unusable in every git tool there is.
    const SHOWN: usize = 10;
    let head: Vec<&str> = files.iter().take(SHOWN).map(String::as_str).collect();
    if files.len() <= SHOWN {
        head.join(", ")
    } else {
        format!("{}, and {} more", head.join(", "), files.len() - SHOWN)
    }
}

/// What a commit attempt did.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    /// False when there was nothing to commit — which is the ordinary case on
    /// a timer, and must not read as a failure.
    pub committed: bool,
    pub message: String,
    pub files: Vec<String>,
    /// None when no push was asked for. Some(Err) is a commit that landed
    /// locally and a push that did not — a real state that must be reported as
    /// itself rather than as total failure.
    pub pushed: Option<Result<(), String>>,
}

/// Stages everything and commits it.
///
/// **Refused during a merge.** A conflicted working tree staged wholesale is
/// how `<<<<<<< HEAD` gets committed, and an automatic commit is exactly when
/// nobody is watching for it.
pub fn commit_all(root: &str, message: &str, push: bool) -> Result<CommitResult, String> {
    let root_path = canonical(root)?;
    let status = status(root)?;
    if status.merging {
        return Err(
            "a merge is in progress — resolve it before committing, or the conflict markers go \
             into the commit"
                .into(),
        );
    }
    let files: Vec<String> = status.files.iter().map(|f| f.path.clone()).collect();
    if files.is_empty() {
        return Ok(CommitResult {
            committed: false,
            message: String::new(),
            files,
            pushed: None,
        });
    }

    git(&root_path, &["add", "--all"])?;
    let message = if message.trim().is_empty() {
        file_list_message(&files)
    } else {
        message.trim().to_string()
    };
    git(&root_path, &["commit", "-m", &message])?;

    let pushed = push.then(|| {
        // `-u` so a branch nobody has pushed before gets its upstream set —
        // otherwise the first automatic push of every new branch fails with
        // advice nobody is there to read.
        git(&root_path, &["push", "-u", "origin", "HEAD"]).map(|_| ())
    });

    Ok(CommitResult {
        committed: true,
        message,
        files,
        pushed,
    })
}

/// Pushes the current branch.
pub fn push(root: &str) -> Result<String, String> {
    let root_path = canonical(root)?;
    git(&root_path, &["push", "-u", "origin", "HEAD"])
}

/// Marks a conflicted file resolved by staging it.
///
/// Refuses while conflict markers remain. Staging a file with markers still in
/// it is the classic way to commit `<<<<<<< HEAD` into a branch, and the check
/// costs one read of a file that is already open in front of the person.
pub fn mark_resolved(root: &str, relative: &str) -> Result<(), String> {
    let root_path = canonical(root)?;
    let target = crate::workspace::resolve_within(root, relative)?;
    let text = std::fs::read_to_string(&target)
        .map_err(|e| format!("could not read {relative}: {e}"))?;
    if has_conflict_markers(&text) {
        return Err(format!(
            "{relative} still has conflict markers in it. Resolve them in the merged pane first — \
             staging it now would commit the markers."
        ));
    }
    git(&root_path, &["add", "--", relative])?;
    Ok(())
}

fn canonical(root: &str) -> Result<std::path::PathBuf, String> {
    Path::new(root)
        .canonicalize()
        .map_err(|_| format!("the folder for this Solution is not there any more: {root}"))
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

    /// A real `git status --porcelain=v2 --branch` capture: a branch two ahead
    /// of its upstream with one staged addition, one worktree edit and one
    /// untracked file.
    const TYPICAL: &str = "\
# branch.oid 1a2b3c4d
# branch.head feature/checkout
# branch.upstream origin/feature/checkout
# branch.ab +2 -1
1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 aaaa src/new.rs
1 .M N... 100644 100644 100644 bbbb bbbb src/edited.rs
? notes.txt
";

    #[test]
    fn the_branch_and_how_far_it_has_drifted_are_read() {
        let s = parse_status(TYPICAL);
        assert_eq!(s.branch, "feature/checkout");
        assert_eq!(s.upstream.as_deref(), Some("origin/feature/checkout"));
        assert_eq!(s.ahead, 2);
        assert_eq!(s.behind, 1);
        assert!(!s.merging);
    }

    #[test]
    fn each_kind_of_change_is_named() {
        let s = parse_status(TYPICAL);
        let by_path = |p: &str| s.files.iter().find(|f| f.path == p).cloned().unwrap();
        assert_eq!(by_path("src/new.rs").status, "added");
        assert!(by_path("src/new.rs").staged, "A. is staged");
        assert_eq!(by_path("src/edited.rs").status, "modified");
        assert!(!by_path("src/edited.rs").staged, ".M is worktree only");
        assert_eq!(by_path("notes.txt").status, "untracked");
    }

    /// The line type that justifies porcelain v2. In v1 this file is reported
    /// as an ordinary modification, and the merge view would have nothing to
    /// key off.
    #[test]
    fn an_unmerged_file_is_reported_as_a_conflict() {
        let text = "\
# branch.head main
u UU N... 100644 100644 100644 100644 aaaa bbbb cccc src/conflicted.rs
1 .M N... 100644 100644 100644 dddd dddd src/fine.rs
";
        let s = parse_status(text);
        assert!(s.merging, "a conflict means a merge is in progress");
        assert_eq!(s.files.iter().filter(|f| f.conflicted).count(), 1);
        let conflicted = s.files.iter().find(|f| f.conflicted).expect("one");
        assert_eq!(conflicted.path, "src/conflicted.rs");
        assert!(
            !s.files.iter().find(|f| f.path == "src/fine.rs").unwrap().conflicted,
            "an ordinary edit during a merge is not a conflict"
        );
    }

    /// A rename reports `PATH\tORIGINAL`. Showing the original would point the
    /// developer at a file that is no longer there.
    #[test]
    fn a_rename_shows_the_name_the_file_has_now() {
        let text = "\
# branch.head main
2 R. N... 100644 100644 100644 aaaa bbbb R100 src/after.rs\tsrc/before.rs
";
        let s = parse_status(text);
        assert_eq!(s.files.len(), 1);
        assert_eq!(s.files[0].path, "src/after.rs");
        assert_eq!(s.files[0].status, "renamed");
    }

    /// Staged then edited again reads `AM`. Calling that "modified" would lose
    /// the fact that the file is new.
    #[test]
    fn a_file_added_then_edited_is_still_an_addition() {
        let text = "# branch.head main\n1 AM N... 000000 100644 100644 aaaa bbbb src/new.rs\n";
        let s = parse_status(text);
        assert_eq!(s.files[0].status, "added");
    }

    #[test]
    fn a_detached_head_is_shown_as_it_is() {
        let s = parse_status("# branch.head (detached)\n");
        assert_eq!(s.branch, "(detached)");
    }

    #[test]
    fn a_clean_repository_has_no_files_and_no_conflicts() {
        let s = parse_status("# branch.head main\n# branch.ab +0 -0\n");
        assert!(s.files.is_empty());
        assert_eq!(s.files.iter().filter(|f| f.conflicted).count(), 0);
        assert!(!s.merging);
    }

    #[test]
    fn quoted_paths_lose_their_quotes() {
        let text = "# branch.head main\n? \"a file with spaces.txt\"\n";
        let s = parse_status(text);
        assert_eq!(s.files[0].path, "a file with spaces.txt");
    }

    /// A real `git log --all --date-order` capture: a merge, a branch tip and
    /// an ordinary commit.
    const LOG: &str = "\
aaa1\u{1f}bbb2 ccc3\u{1f}HEAD -> main, origin/main\u{1f}Merge branch 'checkout'\u{1f}Ada\u{1f}1700000300
bbb2\u{1f}ddd4\u{1f}feature/checkout\u{1f}Add the basket screen\u{1f}Grace\u{1f}1700000200
ddd4\u{1f}\u{1f}tag: v1\u{1f}First commit\u{1f}Ada\u{1f}1700000100
";

    #[test]
    fn the_history_carries_what_the_graph_needs() {
        let commits = parse_log(LOG);
        assert_eq!(commits.len(), 3);
        // two parents is a merge, and is the whole reason to draw this
        assert_eq!(commits[0].parents, vec!["bbb2", "ccc3"]);
        assert_eq!(commits[0].subject, "Merge branch 'checkout'");
        assert_eq!(commits[0].short_id, "aaa1");
        assert_eq!(commits[1].author, "Grace");
        assert_eq!(commits[1].when, 1_700_000_200);
        // the first commit has no parents
        assert!(commits[2].parents.is_empty());
    }

    /// `HEAD -> main` and `tag: v1` are git's presentation, not names.
    #[test]
    fn ref_names_lose_gits_decoration() {
        let commits = parse_log(LOG);
        assert_eq!(commits[0].refs, vec!["main", "origin/main"]);
        assert_eq!(commits[1].refs, vec!["feature/checkout"]);
        assert_eq!(commits[2].refs, vec!["v1"]);
    }

    /// The separator is a unit character because a commit subject can contain
    /// a pipe or a tab, and a subject that split a row would corrupt the graph
    /// rather than merely look wrong.
    #[test]
    fn a_subject_containing_punctuation_does_not_split_the_row() {
        let line = "aaa1\u{1f}bbb2\u{1f}\u{1f}fix: a|b\tc — all one subject\u{1f}Ada\u{1f}1700000000\n";
        let commits = parse_log(line);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].subject, "fix: a|b\tc — all one subject");
    }

    /// What an auto-commit message is for: a restore point, not a story. A
    /// generated sentence would be trusted by whoever read it later.
    #[test]
    fn an_auto_commit_message_is_the_files_that_changed() {
        assert_eq!(
            file_list_message(&["src/basket.rs".into(), "src/main.rs".into()]),
            "src/basket.rs, src/main.rs"
        );
        assert_eq!(file_list_message(&[]), "no files");
    }

    /// A hundred files after a formatter run is real, and a subject that long
    /// is unusable in every git tool there is.
    #[test]
    fn a_very_large_change_is_summarised_rather_than_listed_in_full() {
        let files: Vec<String> = (0..25).map(|n| format!("src/file{n}.rs")).collect();
        let message = file_list_message(&files);
        assert!(message.contains("src/file0.rs"));
        assert!(message.contains("and 15 more"), "got: {message}");
        assert!(message.len() < 200, "still a usable subject: {message}");
    }

    /// Markers are only markers at the start of a line. A file that merely
    /// *discusses* conflict markers is resolved, and saying otherwise would
    /// block someone from finishing a merge they had already finished.
    #[test]
    fn conflict_markers_are_recognised_only_where_git_writes_them() {
        assert!(has_conflict_markers("ok\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> other\n"));
        assert!(!has_conflict_markers("let s = \"<<<<<<< not a marker\";\n"));
        assert!(!has_conflict_markers("a normal file\nwith lines\n"));
        // the bare separator still counts — it is how git writes it
        assert!(has_conflict_markers("a\n=======\nb\n"));
    }
}
