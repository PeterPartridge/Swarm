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

use std::path::{Path, PathBuf};
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
    let target = crate::files::workspace::resolve_within(root, relative)?;
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

/// What a folder is, as far as git is concerned.
///
/// Three states rather than a bool, because the middle one is a real place to
/// be and it is the one that surprises people: `cargo new` inside an existing
/// repository leaves a folder with no `.git` of its own, and a fresh `git init`
/// leaves a repository a worktree cannot branch from. "Not a repository" and
/// "a repository with nothing in it" need different sentences and different
/// buttons.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct RepoState {
    pub is_repo: bool,
    /// Whether anything has been committed. A worktree needs a commit to branch
    /// from, so an empty repository still cannot start a run.
    pub has_commit: bool,
    /// The current branch, empty when there is nothing committed yet.
    pub branch: String,
}

/// Whether a folder is a git repository, and whether it has anything in it.
///
/// Never an error for "it is not a repository" — that is an answer, and the
/// caller is asking precisely because it might not be.
pub fn repo_state(root: &str) -> Result<RepoState, String> {
    let root_path = canonical(root)?;
    if !root_path.join(".git").exists() {
        return Ok(RepoState { is_repo: false, has_commit: false, branch: String::new() });
    }
    let (ok, head, _) = git_allowing_failure(&root_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(RepoState {
        is_repo: true,
        has_commit: ok,
        branch: if ok { head.trim().to_string() } else { String::new() },
    })
}

/// Makes a folder a git repository an agent can actually be sent to.
///
/// **Both halves, because half of it is not usable.** `git init` alone leaves a
/// repository with no commit, and `add_worktree` branches from a commit — so
/// initialising without committing swaps one refusal ("not a git repository")
/// for another ("invalid reference: HEAD"), which reads like the app doing
/// nothing twice. Anything already in the folder becomes the first commit.
///
/// Idempotent, and says which case it met: pressing it on a repository that
/// already works should not be an error, it should be a sentence saying so.
pub fn init_repo(root: &str, first_message: &str) -> Result<String, String> {
    let root_path = canonical(root)?;
    let before = repo_state(root)?;
    if before.is_repo && before.has_commit {
        return Ok(format!(
            "{root} is already a git repository, on {}.",
            before.branch
        ));
    }
    if !before.is_repo {
        // `-b main` rather than git's default, which varies by version and by
        // whatever the person has configured — a Solution's branch names are
        // written down elsewhere and have to match something.
        git(&root_path, &["init", "-b", "main"])?;
    }

    let (staged, _, _) = git_allowing_failure(&root_path, &["add", "--all"])?;
    if !staged {
        return Ok(format!("{root} is a git repository now, with nothing committed yet."));
    }
    let (committed, _, err) =
        git_allowing_failure(&root_path, &["commit", "-m", first_message])?;
    if !committed {
        // An empty folder is the usual reason, and it is not a failure: the
        // repository exists and the first file committed will be the first
        // commit. git's own words travel for anything else — an unset
        // `user.email` is the one people hit and cannot guess.
        return Ok(format!(
            "{root} is a git repository now, but nothing was committed: {}",
            err.trim()
        ));
    }
    Ok(format!(
        "{root} is a git repository now, with everything in it committed to main."
    ))
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

/// Points a repository's `origin` at `url`, adding it or moving it.
///
/// **Set, not add.** A folder that has been pushed somewhere before already has
/// an `origin`, and `git remote add` fails on it — which would turn "connect
/// this to the repository I just made" into an error about a remote the person
/// never mentioned. Moving it is what they asked for; the old URL is returned
/// so the caller can say what it replaced rather than changing it silently.
pub fn set_remote(root: &str, url: &str) -> Result<Option<String>, String> {
    let root_path = canonical(root)?;
    let (had, existing, _) = git_allowing_failure(&root_path, &["remote", "get-url", "origin"])?;
    let previous = had.then(|| existing.trim().to_string()).filter(|u| !u.is_empty());
    if previous.is_some() {
        git(&root_path, &["remote", "set-url", "origin", url])?;
    } else {
        git(&root_path, &["remote", "add", "origin", url])?;
    }
    Ok(previous)
}

/// Marks a conflicted file resolved by staging it.
///
/// Refuses while conflict markers remain. Staging a file with markers still in
/// it is the classic way to commit `<<<<<<< HEAD` into a branch, and the check
/// costs one read of a file that is already open in front of the person.
pub fn mark_resolved(root: &str, relative: &str) -> Result<(), String> {
    let root_path = canonical(root)?;
    let target = crate::files::workspace::resolve_within(root, relative)?;
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

/* ── Worktrees: one checkout per run, so agents do not share a folder ──── */

/// Where a run's own checkout goes.
///
/// **Beside the repository, never inside it.** A worktree under the repo would
/// be a git checkout inside a git checkout — the outer one tracks it, the
/// containment rule in `workspace.rs` would have to be relaxed to reach it, and
/// every file listing would show one repository's files inside another's.
pub fn worktree_dir(root: &str, branch: &str) -> Result<PathBuf, String> {
    let root_path = canonical(root)?;
    let parent = root_path
        .parent()
        .ok_or_else(|| format!("{root} has no parent folder to put a worktree beside"))?;
    Ok(parent.join(".coperativeai-worktrees").join(slug(branch)))
}

/// A path in the form git will accept.
///
/// `canonicalize` on Windows returns an extended-length path — `\\?\C:\…` —
/// and git rejects it outright: *"could not create leading directories …
/// Invalid argument"*. Everything else in this app hands canonicalised paths to
/// `Command::current_dir`, which is fine with the prefix; passing one as an
/// *argument* is not. So it is stripped at the boundary rather than avoiding
/// canonicalisation, which is what makes the containment checks work.
fn for_git(path: &Path) -> String {
    let text = path.to_string_lossy().to_string();
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
}

/// A branch name as a folder name. `feature/9-add-checkout` is a perfectly good
/// branch and a nested path — flattened, or the worktree lands two folders deep
/// and `worktree remove` is given a path that does not match what was created.
pub fn slug(branch: &str) -> String {
    let mut out = String::new();
    let mut last_dash = true;
    for ch in branch.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "run".into()
    } else {
        out
    }
}

/// Creates a checkout of `branch` for this run, cut from `base`.
///
/// This is what makes "run several agents at once" safe: two work items on one
/// Solution get two folders and two branches, so neither can overwrite the
/// other's edits or interleave its commits.
///
/// An existing branch is checked out rather than re-created — re-running a
/// prepared run must not fail because the branch it already made is still
/// there.
pub fn add_worktree(root: &str, branch: &str, base: &str) -> Result<String, String> {
    let root_path = canonical(root)?;
    if !root_path.join(".git").exists() {
        return Err(format!("{root} is not a git repository"));
    }
    if branch.trim().is_empty() {
        return Err("a run needs a branch name — set one on the build plan".into());
    }
    let target = worktree_dir(root, branch)?;
    // Same form either way: the caller stores this and hands it back to git
    // later, so the already-exists path must not return the `\\?\` spelling
    // that the freshly-created one strips.
    if target.exists() {
        return Ok(for_git(&target));
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }

    let path = for_git(&target);
    let base = if base.trim().is_empty() { "HEAD" } else { base.trim() };
    let exists = git(&root_path, &["rev-parse", "--verify", branch]).is_ok();
    if exists {
        git(&root_path, &["worktree", "add", &path, branch])?;
    } else {
        git(&root_path, &["worktree", "add", "-b", branch, &path, base])?;
    }
    Ok(path)
}

/// Removes a run's checkout.
///
/// **Refused while it holds uncommitted work.** Pulling a worktree out from
/// under an agent that is still writing, or one whose output nobody has kept
/// yet, destroys the thing the run was for. `--force` is only reached once the
/// caller has established there is nothing to lose.
pub fn remove_worktree(root: &str, path: &str) -> Result<(), String> {
    let root_path = canonical(root)?;
    if !Path::new(path).exists() {
        // Already gone is the outcome asked for.
        let _ = git(&root_path, &["worktree", "prune"]);
        return Ok(());
    }
    if let Ok(status) = status(path) {
        if !status.files.is_empty() {
            return Err(format!(
                "{path} still has {} uncommitted file{} in it — commit or discard them first",
                status.files.len(),
                if status.files.len() == 1 { "" } else { "s" }
            ));
        }
    }
    git(&root_path, &["worktree", "remove", path])?;
    Ok(())
}

/// What merging a run's branch would do, worked out without touching anything.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePreview {
    /// True when the merge would apply with no conflicts.
    pub clean: bool,
    /// The files that would conflict. Named before anything is attempted, so
    /// "this will be a fight" is knowable in advance.
    pub conflicts: Vec<String>,
    /// Commits on the branch the base does not have. Zero means there is
    /// nothing to merge — the agent produced no commits.
    pub commits_ahead: usize,
}

/// What a merge actually did.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeOutcome {
    pub merged: bool,
    /// Files left conflicted. When this is non-empty the merge is still in
    /// progress in the working copy, waiting for the three-way editor.
    pub conflicts: Vec<String>,
    pub message: String,
}

/// Runs git tolerating a non-zero exit, for the commands where "it failed" is
/// an answer rather than an error — `merge-tree` exits 1 to mean "conflicts",
/// and `merge` exits 1 to mean the same.
fn git_allowing_failure(root: &Path, args: &[&str]) -> Result<(bool, String, String), String> {
    let output = Command::new("git")
        .current_dir(root)
        .args(args)
        .output()
        .map_err(|e| format!("could not run git — is it installed? ({e})"))?;
    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    ))
}

/// Whether `branch` would merge into `into` cleanly — **without touching the
/// working copy at all**.
///
/// `git merge-tree --write-tree` does the whole merge in the object database
/// and reports the result, so the question "will this be a fight?" can be
/// answered before anyone commits to finding out. That matters most in exactly
/// the case this feature exists for: two agents that both edited one Solution.
pub fn merge_preview(root: &str, branch: &str, into: &str) -> Result<MergePreview, String> {
    let root_path = canonical(root)?;

    // Nothing to merge is worth saying plainly rather than reporting a clean
    // merge of nothing, which reads like success.
    let range = format!("{into}..{branch}");
    let (ok, counted, err) = git_allowing_failure(&root_path, &["rev-list", "--count", &range])?;
    if !ok {
        return Err(format!("could not compare {branch} with {into}: {}", err.trim()));
    }
    let commits_ahead: usize = counted.trim().parse().unwrap_or(0);

    let (clean, out, err) = git_allowing_failure(
        &root_path,
        &["merge-tree", "--write-tree", "--name-only", into, branch],
    )?;
    if !clean && out.trim().is_empty() {
        // No tree at all means git refused the arguments, not that it found
        // conflicts — an unknown branch, most often.
        return Err(format!("could not test the merge: {}", err.trim()));
    }

    // On a conflict the first line is the tree, then the conflicted paths, then
    // a blank line and human-readable notes we do not need.
    let conflicts: Vec<String> = if clean {
        Vec::new()
    } else {
        out.lines()
            .skip(1)
            .take_while(|l| !l.trim().is_empty())
            .map(|l| l.trim().to_string())
            .collect()
    };

    Ok(MergePreview { clean, conflicts, commits_ahead })
}

/// Merges a run's branch into its base, in the main checkout.
///
/// **Refused unless the working copy is clean.** Merging on top of someone's
/// uncommitted edits is how work gets lost, and a merge is the one operation
/// here that rewrites shared history rather than a scratch folder.
///
/// A conflicted merge is left **in progress** rather than rolled back, because
/// the three-way editor in the Code tab is what resolves it — aborting would
/// throw away the very state that view exists to work on. `abort_merge` is the
/// way out when the answer is "not now".
pub fn merge_branch(root: &str, branch: &str, into: &str) -> Result<MergeOutcome, String> {
    let root_path = canonical(root)?;

    let dirty = status(root)?;
    if !dirty.files.is_empty() {
        return Err(format!(
            "there {} {} uncommitted file{} here — commit or stash before merging, so nothing \
             of yours is caught up in it",
            if dirty.files.len() == 1 { "is" } else { "are" },
            dirty.files.len(),
            if dirty.files.len() == 1 { "" } else { "s" }
        ));
    }

    // Checking out the base is safe precisely because the tree is clean: there
    // is nothing to carry across or lose.
    git(&root_path, &["checkout", into])?;

    let (ok, out, err) = git_allowing_failure(&root_path, &["merge", "--no-ff", branch])?;
    if ok {
        return Ok(MergeOutcome {
            merged: true,
            conflicts: Vec::new(),
            message: format!("{branch} merged into {into}."),
        });
    }

    // Conflicted: report which files, and leave the merge standing.
    let conflicts = match git_allowing_failure(&root_path, &["diff", "--name-only", "--diff-filter=U"])
    {
        Ok((_, files, _)) => files
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| l.trim().to_string())
            .collect::<Vec<_>>(),
        Err(_) => Vec::new(),
    };
    if conflicts.is_empty() {
        // Failed for a reason that is not a conflict — do not leave the repo
        // half-merged on a mystery.
        let _ = git_allowing_failure(&root_path, &["merge", "--abort"]);
        return Err(format!(
            "the merge failed: {}",
            if err.trim().is_empty() { out.trim() } else { err.trim() }
        ));
    }
    Ok(MergeOutcome {
        merged: false,
        conflicts,
        message: format!(
            "{branch} conflicts with {into}. The merge is open in the working copy — resolve it \
             in the Code tab's merge view, or abandon it."
        ),
    })
}

/// Abandons a merge left in progress, putting the checkout back as it was.
pub fn abort_merge(root: &str) -> Result<(), String> {
    let root_path = canonical(root)?;
    let (ok, _, err) = git_allowing_failure(&root_path, &["merge", "--abort"])?;
    if !ok {
        return Err(format!("there was no merge to abandon ({})", err.trim()));
    }
    Ok(())
}

/// The checkouts this repository has, main one included.
/// The branches this repository has, local and remote, for choosing one to
/// branch from.
///
/// **Remotes included, deduplicated to their short name.** The branch somebody
/// cuts from is usually `main` or a release branch that exists on the remote
/// and may never have been checked out here — offering only local branches
/// would leave the commonest answer missing from a list that claims to be the
/// branches.
///
/// `HEAD` is dropped: `origin/HEAD` is a pointer at another entry in the same
/// list, and offering it would let somebody pick a name that means "whatever
/// the default is today".
pub fn list_branches(root: &str) -> Result<Vec<String>, String> {
    let root_path = canonical(root)?;
    let text = git(
        &root_path,
        &["branch", "--all", "--format=%(refname:short)"],
    )?;
    Ok(parse_branch_list(&text))
}

/// Reads `git branch --all --format=%(refname:short)` (pure — unit tested).
pub fn parse_branch_list(text: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for line in text.lines() {
        let name = line.trim();
        if name.is_empty() || name.ends_with("HEAD") {
            continue;
        }
        // `origin/main` and `main` are the same branch to whoever is choosing,
        // so the remote's name is dropped — but **only** from entries that
        // came from a remote. Splitting on the last `/` regardless would turn
        // the local branch `feature/checkout` into `checkout`, which is a
        // branch that does not exist.
        let short = match name.strip_prefix("remotes/") {
            Some(remote_ref) => remote_ref
                .split_once('/')
                .map(|(_remote, branch)| branch)
                .unwrap_or(remote_ref),
            None => name,
        };
        let short = short.to_string();
        if !names.contains(&short) {
            names.push(short);
        }
    }
    names.sort();
    names
}

pub fn list_worktrees(root: &str) -> Result<Vec<String>, String> {
    let root_path = canonical(root)?;
    let text = git(&root_path, &["worktree", "list", "--porcelain"])?;
    Ok(parse_worktree_list(&text))
}

/// Reads `git worktree list --porcelain` — records separated by a blank line,
/// each starting `worktree <path>`.
pub fn parse_worktree_list(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|l| l.strip_prefix("worktree "))
        .map(|p| p.trim().to_string())
        .collect()
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

    /// **The branch you cut from is usually one you have never checked out.**
    /// A list of local branches only would leave `main` missing from a repo
    /// somebody just cloned and worked on a feature branch in — which is the
    /// normal case, and the one where the answer matters most.
    #[test]
    fn branches_include_the_remote_ones_under_their_short_name() {
        let captured = "\
main
feature/checkout
remotes/origin/HEAD
remotes/origin/main
remotes/origin/release-2
";
        assert_eq!(
            parse_branch_list(captured),
            vec!["feature/checkout", "main", "release-2"],
        );
    }

    /// `origin/HEAD` points at another entry in the same list. Offering it
    /// would let somebody choose a name meaning "whatever the default is
    /// today", which is not a branch anybody decided to cut from.
    #[test]
    fn the_head_pointer_is_not_a_branch_to_choose() {
        assert!(parse_branch_list("remotes/origin/HEAD\n").is_empty());
        assert!(parse_branch_list("   \n\n").is_empty());
    }

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

    /// A real repository with one commit, for the worktree tests.
    ///
    /// Nested one level deeper than the usual scratch dir on purpose:
    /// worktrees are created in the repository's **parent**, so two tests whose
    /// repos share a parent would fight over `.coperativeai-worktrees`. Each
    /// gets its own enclosing folder, which is also what the real layout looks
    /// like — a repo in a projects folder, not loose in temp.
    fn temp_repo_with_commit(name: &str) -> Option<std::path::PathBuf> {
        let enclosing = crate::testing::scratch("worktree", name);
        let dir = enclosing.join("repo");
        std::fs::create_dir_all(&dir).ok()?;
        let run = |args: &[&str]| {
            std::process::Command::new("git")
                .current_dir(&dir)
                .args(args)
                .output()
                .ok()
                .map(|o| o.status.success())
                .unwrap_or(false)
        };
        if !run(&["init", "-b", "main"]) {
            return None;
        }
        run(&["config", "user.email", "t@example.invalid"]);
        run(&["config", "user.name", "Test"]);
        std::fs::write(dir.join("README.md"), "hello").ok()?;
        run(&["add", "-A"]);
        run(&["commit", "-m", "first"]);
        Some(dir)
    }

    /// The whole point of the feature: two work items on one Solution get two
    /// folders and two branches, so neither can overwrite the other's edits.
    /// Commits `text` to `file` inside a checkout, so a test can make two
    /// branches disagree.
    fn commit_file(dir: &Path, file: &str, text: &str, message: &str) {
        std::fs::write(dir.join(file), text).expect("write");
        let run = |args: &[&str]| {
            std::process::Command::new("git")
                .current_dir(dir)
                .args(args)
                .output()
                .expect("git");
        };
        run(&["add", "-A"]);
        run(&["commit", "-m", message]);
    }

    /// **The error a person actually hits.** A Solution pointed at a folder
    /// somebody made by hand — or that a starter left without a repository — is
    /// not a git repository, and everything downstream refuses: no status, no
    /// worktree, no run. Initialising has to leave it in a state a run can
    /// actually use, which means a commit as well as a `.git`.
    #[test]
    fn initialising_a_plain_folder_leaves_a_repository_a_run_can_branch_from() {
        let dir = crate::testing::scratch("git-init", "plain").join("hello-world");
        std::fs::create_dir_all(&dir).expect("folder");
        std::fs::write(dir.join("main.rs"), "fn main() {}").expect("a file");
        let root = dir.display().to_string();

        let before = repo_state(&root).expect("state");
        assert!(!before.is_repo, "the folder starts as an ordinary one");

        // No global git identity on a build machine would fail the commit, and
        // that is the machine's setup rather than this function's behaviour.
        let told = match init_repo(&root, "First commit") {
            Ok(t) => t,
            Err(e) => {
                eprintln!("skipped: git is not usable here ({e})");
                return;
            }
        };
        let after = repo_state(&root).expect("state");
        assert!(after.is_repo, "it is a repository now: {told}");
        if !after.has_commit {
            eprintln!("skipped: git has no identity configured here ({told})");
            return;
        }
        assert_eq!(after.branch, "main", "named, not left to git's default");
        // The proof that matters: a worktree can be cut from it, which is what
        // starting a run does.
        assert!(
            add_worktree(&root, "feature/1-first", "main").is_ok(),
            "a run can branch from it"
        );
    }

    /// Pressing it twice is not an error. Somebody who cannot tell whether it
    /// worked will press it again, and the second press should say so rather
    /// than produce a red box.
    #[test]
    fn initialising_a_repository_that_already_works_says_so_instead_of_failing() {
        let Some(dir) = temp_repo_with_commit("git-init-twice") else {
            eprintln!("skipped: git is not usable here");
            return;
        };
        let root = dir.display().to_string();
        let told = init_repo(&root, "First commit").expect("no error");
        assert!(told.contains("already"), "got: {told}");
    }

    /// The happy path: a run's branch comes home.
    #[test]
    fn a_branch_that_does_not_clash_merges_into_its_base() {
        let Some(dir) = temp_repo_with_commit("merge-clean") else {
            eprintln!("skipped: git is not usable here");
            return;
        };
        let root = dir.to_str().expect("utf-8");
        let wt = add_worktree(root, "feature/9-checkout", "main").expect("worktree");
        commit_file(Path::new(&wt), "checkout.rs", "fn pay() {}", "add checkout");

        // Preview first, and it must agree with what happens.
        let preview = merge_preview(root, "feature/9-checkout", "main").expect("preview");
        assert!(preview.clean, "nothing else touched this file");
        assert_eq!(preview.commits_ahead, 1);
        assert!(preview.conflicts.is_empty());

        let outcome = merge_branch(root, "feature/9-checkout", "main").expect("merge");
        assert!(outcome.merged);
        assert!(
            dir.join("checkout.rs").is_file(),
            "the work is in the main checkout now"
        );

        let _ = std::fs::remove_dir_all(dir.parent().unwrap_or(&dir));
    }

    /// The case this whole feature exists for: two agents edited one file, so
    /// the second branch home has to be resolved rather than merged.
    #[test]
    fn two_agents_on_one_file_are_reported_as_a_conflict_before_anything_is_touched() {
        let Some(dir) = temp_repo_with_commit("merge-clash") else {
            eprintln!("skipped: git is not usable here");
            return;
        };
        let root = dir.to_str().expect("utf-8");
        let a = add_worktree(root, "feature/9-checkout", "main").expect("a");
        let b = add_worktree(root, "feature/10-refunds", "main").expect("b");
        commit_file(Path::new(&a), "shared.rs", "fn a() {}", "a edits shared");
        commit_file(Path::new(&b), "shared.rs", "fn b() {}", "b edits shared");

        // The first one home is clean.
        assert!(merge_branch(root, "feature/9-checkout", "main").expect("first").merged);

        // The second is not, and the preview says so without touching anything.
        let preview = merge_preview(root, "feature/10-refunds", "main").expect("preview");
        assert!(!preview.clean, "both branches rewrote the same file");
        assert!(
            preview.conflicts.iter().any(|f| f.contains("shared.rs")),
            "the clashing file is named: {:?}",
            preview.conflicts
        );
        // …and previewing left the checkout alone.
        assert!(status(root).expect("status").files.is_empty(), "preview must not touch anything");

        // Doing it for real leaves the merge open for the three-way editor.
        let outcome = merge_branch(root, "feature/10-refunds", "main").expect("merge runs");
        assert!(!outcome.merged);
        assert!(outcome.conflicts.iter().any(|f| f.contains("shared.rs")));

        // And there is a way out.
        abort_merge(root).expect("abort");
        assert!(status(root).expect("status").files.is_empty(), "abandoning restores the checkout");

        let _ = std::fs::remove_dir_all(dir.parent().unwrap_or(&dir));
    }

    /// Merging on top of uncommitted work is how work gets lost.
    #[test]
    fn a_merge_is_refused_while_the_checkout_has_uncommitted_work() {
        let Some(dir) = temp_repo_with_commit("merge-dirty") else {
            eprintln!("skipped: git is not usable here");
            return;
        };
        let root = dir.to_str().expect("utf-8");
        let wt = add_worktree(root, "feature/9-checkout", "main").expect("worktree");
        commit_file(Path::new(&wt), "new.rs", "fn x() {}", "work");

        std::fs::write(dir.join("mine.txt"), "half-finished").expect("write");
        let refused = merge_branch(root, "feature/9-checkout", "main");
        assert!(refused.is_err(), "must not merge over uncommitted work");
        assert!(
            refused.unwrap_err().contains("uncommitted"),
            "and must say why"
        );

        let _ = std::fs::remove_dir_all(dir.parent().unwrap_or(&dir));
    }

    /// An agent that produced nothing has nothing to merge, and saying "merged
    /// cleanly" about zero commits would read as success.
    #[test]
    fn a_branch_with_no_commits_reports_nothing_to_merge() {
        let Some(dir) = temp_repo_with_commit("merge-empty") else {
            eprintln!("skipped: git is not usable here");
            return;
        };
        let root = dir.to_str().expect("utf-8");
        add_worktree(root, "feature/9-checkout", "main").expect("worktree");

        let preview = merge_preview(root, "feature/9-checkout", "main").expect("preview");
        assert_eq!(preview.commits_ahead, 0, "the agent wrote nothing");
        assert!(preview.clean);

        let _ = std::fs::remove_dir_all(dir.parent().unwrap_or(&dir));
    }

    #[test]
    fn two_runs_on_one_repository_get_their_own_checkouts() {
        let Some(dir) = temp_repo_with_commit("two") else {
            eprintln!("skipped: git is not usable here");
            return;
        };
        let root = dir.to_str().expect("utf-8");

        let a = add_worktree(root, "feature/9-checkout", "main").expect("first worktree");
        let b = add_worktree(root, "feature/10-refunds", "main").expect("second worktree");
        assert_ne!(a, b, "each run needs its own folder");
        assert!(Path::new(&a).join("README.md").is_file(), "a is a real checkout");
        assert!(Path::new(&b).join("README.md").is_file(), "b is a real checkout");

        // Beside the repository, never inside it.
        assert!(!a.starts_with(root), "a worktree inside the repo would be tracked by it");

        let listed = list_worktrees(root).expect("list");
        assert_eq!(listed.len(), 3, "the main checkout plus two: {listed:?}");

        // Each is on its own branch, so commits cannot interleave.
        let branch_of = |p: &str| status(p).expect("status").branch;
        assert_eq!(branch_of(&a), "feature/9-checkout");
        assert_eq!(branch_of(&b), "feature/10-refunds");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Pulling a worktree out from under work nobody has kept destroys the
    /// thing the run was for.
    #[test]
    fn a_worktree_with_uncommitted_work_is_not_removed() {
        let Some(dir) = temp_repo_with_commit("dirty") else {
            eprintln!("skipped: git is not usable here");
            return;
        };
        let root = dir.to_str().expect("utf-8");
        let path = add_worktree(root, "feature/dirty", "main").expect("worktree");

        std::fs::write(Path::new(&path).join("new.txt"), "unsaved work").expect("write");
        let err = remove_worktree(root, &path).expect_err("must refuse");
        assert!(err.contains("uncommitted"), "got: {err}");
        assert!(Path::new(&path).is_dir(), "it must still be there");

        // Clean, and it goes.
        std::fs::remove_file(Path::new(&path).join("new.txt")).expect("tidy");
        remove_worktree(root, &path).expect("remove when clean");
        assert!(!Path::new(&path).exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Re-preparing a run must not fail because the branch it already made is
    /// still there.
    #[test]
    fn asking_twice_returns_the_same_checkout() {
        let Some(dir) = temp_repo_with_commit("twice") else {
            eprintln!("skipped: git is not usable here");
            return;
        };
        let root = dir.to_str().expect("utf-8");
        let first = add_worktree(root, "feature/same", "main").expect("first");
        let second = add_worktree(root, "feature/same", "main").expect("again");
        assert_eq!(first, second);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_run_without_a_branch_name_is_refused() {
        let Some(dir) = temp_repo_with_commit("nobranch") else {
            eprintln!("skipped: git is not usable here");
            return;
        };
        let root = dir.to_str().expect("utf-8");
        let err = add_worktree(root, "   ", "main").expect_err("must refuse");
        assert!(err.contains("branch name"), "got: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `feature/9-add-checkout` is a good branch and a nested path. Flattened,
    /// or the folder lands two deep and `worktree remove` is handed a path that
    /// does not match what was created.
    #[test]
    fn a_branch_name_becomes_one_folder_not_a_tree() {
        assert_eq!(slug("feature/9-add-checkout"), "feature-9-add-checkout");
        assert_eq!(slug("a/b/c"), "a-b-c");
        assert_eq!(slug("///"), "run");
    }

    #[test]
    fn the_worktree_list_is_read_from_porcelain() {
        let text = "worktree /repos/shop\nHEAD aaa\nbranch refs/heads/main\n\n\
                    worktree /repos/.coperativeai-worktrees/feature-9\nHEAD bbb\n";
        assert_eq!(
            parse_worktree_list(text),
            vec!["/repos/shop", "/repos/.coperativeai-worktrees/feature-9"]
        );
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
