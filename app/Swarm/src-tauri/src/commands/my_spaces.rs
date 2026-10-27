//! Your own worktrees, alongside the agents'.
//!
//! **The lane already claimed this and did not have it.** "Your workspace" was
//! one card above a divider reading *agent worktrees*: each agent got a real
//! checkout of its own and you got a pointer at the main working copy. So the
//! one place in the app where you and an agent do the same kind of work was the
//! one place where only the agent had somewhere to do it.
//!
//! These are **real git worktrees**, made the same way an agent's is — the same
//! `vcs::add_worktree`, the same folder beside the repository. That is what
//! makes two of them useful: the same Solution can be open twice at different
//! commits, and an experiment in one cannot disturb the other. A saved view
//! pretending to be a workspace would have been the cheaper thing to build and
//! a claim the app could not keep.
//!
//! **Named so nothing else touches them.** Agent branches come from a plan and
//! are arbitrary; these all begin [`PREFIX`], which is what tells a listing —
//! and anything that ever cleans up after a finished run — that a worktree
//! belongs to a person and is not a run's leftovers.

use super::{to_message, AppDb};
use crate::db::solution;
use crate::git::vcs;
use serde::Serialize;
use tauri::State;

/// What every personal branch begins with.
///
/// A prefix rather than a separate folder: `git worktree list` reports paths,
/// and the branch is what survives into every listing git gives back.
pub const PREFIX: &str = "myspace/";

/// One of your worktrees.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MySpace {
    /// The branch, including the prefix — what identifies it to git.
    pub branch: String,
    /// What to call it on screen, without the prefix.
    pub name: String,
    /// Where it is checked out.
    pub path: String,
}

/// The Solution's working copy, or why there is not one.
async fn root_of(db: &State<'_, AppDb>, solution_id: i64) -> Result<String, String> {
    let conn = db.0.lock().await;
    let Some(row) = solution::find_by_id(&conn, solution_id)
        .await
        .map_err(to_message)?
    else {
        return Err("that Solution no longer exists".into());
    };
    row.local_path.filter(|p| !p.trim().is_empty()).ok_or_else(|| {
        format!(
            "'{}' has no folder on this machine yet — point it at a working copy before opening \
             a space in it",
            row.name
        )
    })
}

/// Opens a new worktree of your own on this Solution.
///
/// **Branched from the current checkout**, so a space starts where the work is
/// rather than at whatever `main` happens to be — which is what somebody
/// opening a second window to try something almost always means.
#[tauri::command]
pub async fn open_my_space(
    db: State<'_, AppDb>,
    solution_id: i64,
    name: String,
) -> Result<MySpace, String> {
    let wanted = name.trim();
    if wanted.is_empty() {
        return Err("give the space a name, so two of them can be told apart".into());
    }
    let root = root_of(&db, solution_id).await?;
    let branch = format!("{PREFIX}{wanted}");

    // Refused rather than silently reused: opening a space that already exists
    // would look like it worked and hand back somebody else's uncommitted work.
    let would_be = vcs::worktree_dir(&root, &branch)?.display().to_string();
    if vcs::list_worktrees(&root)?.iter().any(|path| path == &would_be) {
        return Err(format!("a space called '{wanted}' is already open on this Solution"));
    }

    let path = vcs::add_worktree(&root, &branch, "HEAD")?;
    Ok(MySpace {
        branch,
        name: wanted.to_string(),
        path,
    })
}

/// Every space of yours on this Solution.
///
/// Read from git rather than remembered, for the same reason the debugger reads
/// its threads at every stop: a worktree somebody removed by hand is gone, and
/// a list that still offered it would be offering a folder that is not there.
#[tauri::command]
pub async fn list_my_spaces(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<Vec<MySpace>, String> {
    let root = root_of(&db, solution_id).await?;
    let mut mine = Vec::new();
    for path in vcs::list_worktrees(&root)? {
        // The folder is named after the branch's slug, which is what ties a
        // path back to the branch that made it.
        let Some(folder) = std::path::Path::new(&path).file_name().and_then(|f| f.to_str()) else {
            continue;
        };
        let Some(name) = folder.strip_prefix(&slug_prefix()) else {
            continue;
        };
        mine.push(MySpace {
            branch: format!("{PREFIX}{name}"),
            name: name.to_string(),
            path,
        });
    }
    mine.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(mine)
}

/// Closes one, removing the checkout.
///
/// **The branch is left behind.** Removing a worktree throws away a folder;
/// removing the branch would throw away commits, and a button labelled "close"
/// must not do the second.
#[tauri::command]
pub async fn close_my_space(
    db: State<'_, AppDb>,
    solution_id: i64,
    path: String,
) -> Result<(), String> {
    let root = root_of(&db, solution_id).await?;
    // Checked against what git reports rather than trusted from the frontend: a
    // path from outside is an untrusted string, and this one reaches a command
    // that deletes a directory.
    if !vcs::list_worktrees(&root)?.iter().any(|p| p == &path) {
        return Err("that space is not open on this Solution".into());
    }
    vcs::remove_worktree(&root, &path)
}

/// How the prefix appears in a folder name, once git has slugged the branch.
fn slug_prefix() -> String {
    // `worktree_dir` slugs the whole branch, so `myspace/desk` becomes
    // `myspace-desk`. Derived rather than written twice, so changing PREFIX
    // cannot leave the listing looking for the old one.
    PREFIX.replace('/', "-")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **Against a real repository.** Two spaces on one Solution is the whole
    /// point — the same code checked out twice, so an experiment in one cannot
    /// disturb the other — and that is a claim about git rather than about
    /// string handling, so it is made against git.
    #[test]
    fn two_spaces_are_two_real_checkouts_of_the_same_repository() {
        // Nested a level down, because worktrees land beside the repository
        // and two tests sharing a parent would fight over the same folder.
        let enclosing = crate::testing::scratch("my-spaces", "two");
        let dir = enclosing.join("repo");
        std::fs::create_dir_all(&dir).expect("repo dir");
        let git = |args: &[&str]| {
            std::process::Command::new("git")
                .current_dir(&dir)
                .args(args)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        };
        if !git(&["init", "-q"]) {
            eprintln!("skipping: no git on this machine");
            return;
        }
        let _ = git(&["config", "user.email", "t@example.com"]);
        let _ = git(&["config", "user.name", "Test"]);
        std::fs::write(dir.join("README.md"), "hello").expect("a file to commit");
        let _ = git(&["add", "-A"]);
        // A worktree needs a commit to branch from.
        assert!(git(&["commit", "-qm", "first"]), "the repository needs one commit");

        let root = dir.display().to_string();

        let first = vcs::add_worktree(&root, &format!("{PREFIX}desk"), "HEAD").expect("first");
        let second = vcs::add_worktree(&root, &format!("{PREFIX}bench"), "HEAD").expect("second");
        assert_ne!(first, second, "two spaces are two folders");
        assert!(std::path::Path::new(&first).is_dir(), "a real checkout: {first}");
        assert!(std::path::Path::new(&second).is_dir(), "a real checkout: {second}");

        // Both are listed, and both are recognisable as mine rather than as a
        // run’s leftovers.
        let listed = vcs::list_worktrees(&root).expect("list");
        let mine: Vec<&String> = listed
            .iter()
            .filter(|p| {
                std::path::Path::new(p)
                    .file_name()
                    .and_then(|f| f.to_str())
                    .is_some_and(|f| f.starts_with(&slug_prefix()))
            })
            .collect();
        assert_eq!(mine.len(), 2, "both mine. Saw: {listed:?}");

        // Closing one leaves the other alone — the failure that would make
        // two spaces useless.
        vcs::remove_worktree(&root, &first).expect("close the first");
        assert!(!std::path::Path::new(&first).is_dir(), "the closed one is gone");
        assert!(std::path::Path::new(&second).is_dir(), "the other is untouched");
    }

    /// The prefix is what tells a person's worktree from a run's, and the
    /// listing derives its folder form rather than repeating it.
    #[test]
    fn the_folder_prefix_follows_the_branch_prefix() {
        assert_eq!(slug_prefix(), "myspace-");
        assert!(PREFIX.ends_with('/'), "a prefix without the slash would match a branch called myspacefoo");
    }

    /// A name has to survive the round trip from branch to folder and back, or
    /// a space would be created and then not listed.
    #[test]
    fn a_name_survives_becoming_a_branch_and_a_folder() {
        let branch = format!("{PREFIX}desk-two");
        let folder = crate::git::vcs::slug(&branch);
        assert_eq!(folder, "myspace-desk-two");
        assert_eq!(folder.strip_prefix(&slug_prefix()), Some("desk-two"));
    }
}
