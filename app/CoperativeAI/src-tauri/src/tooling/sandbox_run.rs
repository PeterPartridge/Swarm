//! Making a place for a run inside the boundary.
//!
//! **Separate from provisioning next door**, which is a press somebody makes
//! once and which changes their computer. This happens every time a run starts,
//! is idempotent, and changes only the inside of a distribution the app already
//! owns.
//!
//! **Why a clone and not the checkout that already exists.** A git worktree's
//! `.git` is a file holding an *absolute* path back to its repository. Made on
//! Windows, it says `C:\…`, which exists at no mount point inside a Linux
//! distribution — so git in there cannot find its repository at all, and an
//! agent without `git diff` is an agent doing the work blindfolded. A clone made
//! inside has a git of its own that is consistent with where it actually is.
//!
//! It is also much faster. Everything a build touches — `node_modules`,
//! `target`, a thousand small reads — happens on the Linux filesystem rather
//! than across a mount to an NTFS volume.
//!
//! **What this does not give you.** Two runs share one distribution and one
//! user, so a run can read another run's folder. That is not fixed here and is
//! not claimed anywhere: the table goes on saying one run cannot be kept from
//! another under WSL, because it cannot.

use super::sandbox::{clone_dir, mount_point};
use super::sandbox_detect::{ask, Answered, OWN_DISTRIBUTION};
use super::sandbox_provision::AGENT_USER;
use std::path::Path;
use std::time::Duration;

/// A Windows path, as a shell argument inside the distribution.
///
/// **Refused rather than escaped when it holds a quote.** Everything here
/// travels as one argument to `sh -c` wrapped in single quotes, and the lesson
/// from the config file that nearly shipped with an apostrophe in it is that a
/// broken quoting is not a loud failure — it is a half-run command that leaves
/// the boundary looking fine.
fn quotable(path: &Path) -> Result<String, String> {
    let text = path.to_string_lossy().to_string();
    if text.contains('\'') {
        return Err(format!(
            "the folder {text} has a quote in its name, and this app will not try to spell that \
             safely for a shell. Renaming it is the way through."
        ));
    }
    Ok(text)
}

/// The shell that mounts a repository in, if it is not already.
///
/// Checked against `/proc/mounts` first, because a mount does not survive the
/// distribution being restarted and a run may be the first thing after one.
pub fn mount_command(repo_root: &Path) -> Result<String, String> {
    let windows = quotable(repo_root)?;
    let at = mount_point(repo_root);
    Ok(format!(
        "grep -q ' {at} ' /proc/mounts || {{ mkdir -p '{at}' && mount -t drvfs '{windows}' '{at}'; }}"
    ))
}

/// The shell that makes a run its own clone, if it has not got one.
///
/// `--no-hardlinks` because the source is on another filesystem, and because a
/// clone that shares object files with the repository it came from is not the
/// independent copy this is for.
///
/// **`safe.directory` is set for this one command, not for the distribution.**
/// A Windows folder reached over a mount looks to git like a repository owned
/// by somebody else, and it refuses to touch one — *dubious ownership*, which
/// is git protecting you from exactly the kind of thing this is. It is granted
/// here with `-c`, scoped to the repository being cloned, rather than written
/// into a global config where it would quietly cover everything for ever.
pub fn clone_command(repo_root: &Path, run_id: i64, branch: &str, base: &str) -> String {
    let from = mount_point(repo_root);
    let at = clone_dir(run_id);
    let base = if base.trim().is_empty() { "HEAD".to_string() } else { base.trim().to_string() };
    let branch = branch.trim();
    format!(
        "test -d '{at}/.git' || {{ mkdir -p '{at}' \
         && git -c safe.directory='{from}' -c safe.directory='{from}/.git' \
         clone --no-hardlinks '{from}' '{at}'; }} \
         && cd '{at}' && (git rev-parse --verify '{branch}' >/dev/null 2>&1 \
         && git checkout '{branch}' || git checkout -b '{branch}' '{base}')"
    )
}

/// Drops what `wsl.exe` says about this machine's own PATH.
///
/// **Not hiding a failure — removing something that is not one.** Launching
/// anything through `wsl.exe` makes it try to translate every Windows PATH
/// entry, and on a developer's machine that is forty lines of *"Failed to
/// translate"* before the command has done anything at all. The distribution
/// ignores that PATH by design. Left in, it would fill the set-up panel and
/// bury the one line that actually matters.
fn without_path_noise(said: &str) -> String {
    said.lines()
        .filter(|line| !line.trim_start().starts_with("wsl: Failed to translate "))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

/// Runs one shell inside the distribution.
async fn inside(as_root: bool, script: &str, patience: Duration) -> Result<String, String> {
    let user = if as_root { "root" } else { AGENT_USER };
    let args = ["-d", OWN_DISTRIBUTION, "--user", user, "--", "sh", "-c", script];
    match ask("wsl.exe", &args, patience).await {
        Answered::Yes((true, said)) => Ok(without_path_noise(&super::sandbox_detect::decode_wsl(&said))),
        Answered::Yes((false, said)) => Err(without_path_noise(&super::sandbox_detect::decode_wsl(&said))),
        Answered::NotInstalled => Err("WSL is not on this machine any more".into()),
        Answered::Silent => Err("the distribution did not answer in the time allowed".into()),
    }
}

/// Makes a repository reachable from inside, and says nothing if it already is.
pub async fn mount(repo_root: &Path) -> Result<(), String> {
    inside(true, &mount_command(repo_root)?, Duration::from_secs(120))
        .await
        .map(|_| ())
        .map_err(|said| {
            format!("the repository could not be reached from inside the sandbox: {said}")
        })
}

/// Gets a run's own folder ready inside the distribution, and says where it is.
///
/// Mounts as root, because mounting is root's job; clones as the agent, because
/// the files are the agent's to own. Both are idempotent — a run that is
/// started again finds its clone and its branch already there.
pub async fn prepare(
    repo_root: &Path,
    run_id: i64,
    branch: &str,
    base: &str,
) -> Result<String, String> {
    mount(repo_root).await?;
    inside(
        false,
        &clone_command(repo_root, run_id, branch, base),
        Duration::from_secs(600),
    )
    .await
    .map_err(|said| format!("the run could not be given a copy to work in: {said}"))?;

    Ok(clone_dir(run_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> std::path::PathBuf {
        std::path::PathBuf::from(r"C:\Users\dink3\source\repo\CoperativeAICoding")
    }

    #[test]
    fn a_mount_is_only_made_when_it_is_not_already_there() {
        let script = mount_command(&repo()).expect("an ordinary path");
        assert!(script.starts_with("grep -q "), "it must look first: {script}");
        assert!(script.contains("/proc/mounts"));
        assert!(script.contains("mount -t drvfs"));
    }

    /// Two repositories of the same name must not land on the same mount, or
    /// one run would quietly be working in the other's code.
    #[test]
    fn two_repositories_of_one_name_get_different_places() {
        let one = mount_point(Path::new(r"C:\work\alpha\shop"));
        let two = mount_point(Path::new(r"C:\work\beta\shop"));
        assert_ne!(one, two);
        assert!(one.contains("shop") && two.contains("shop"), "{one} / {two}");
    }

    #[test]
    fn the_same_repository_always_gets_the_same_place() {
        assert_eq!(mount_point(&repo()), mount_point(&repo()));
        // Spelled either way, it is the same folder and must be one mount.
        assert_eq!(
            mount_point(Path::new(r"C:\Work\Shop")),
            mount_point(Path::new(r"c:\work\shop"))
        );
    }

    /// A quote in a folder name breaks the quoting everything here relies on.
    /// Refused loudly, because the quiet version is a half-run command.
    #[test]
    fn a_folder_with_a_quote_in_its_name_is_refused_rather_than_guessed_at() {
        let refused = mount_command(Path::new(r"C:\Nick's Projects\shop"))
            .expect_err("a quote cannot be spelled safely here");
        assert!(refused.contains("quote"), "{refused}");
    }

    #[test]
    fn a_clone_is_only_made_once_and_the_branch_is_reused_if_it_exists() {
        let script = clone_command(&repo(), 12, "feature/9-checkout", "main");
        assert!(script.contains("test -d '/work/runs/12/.git'"), "{script}");
        assert!(script.contains("clone --no-hardlinks"));
        // Granted for this clone only, never written into the distribution.
        assert!(script.contains("-c safe.directory="), "a mounted repo is 'dubious' to git");
        assert!(script.contains("git checkout 'feature/9-checkout'"));
        assert!(script.contains("git checkout -b 'feature/9-checkout' 'main'"));
    }

    /// A run with no base branch on its plan still has to be able to start.
    #[test]
    fn a_run_with_no_base_branches_from_where_the_clone_landed() {
        let script = clone_command(&repo(), 3, "feature/x", "   ");
        assert!(script.contains("'HEAD'"), "{script}");
    }

    /// **Runs for real, in the distribution this machine now has.**
    #[test]
    #[ignore = "runs inside the real distribution on this machine"]
    fn a_run_gets_a_place_and_cannot_see_this_machine_from_it() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let here = std::env::current_dir().expect("cwd");
            let repo_root = here.ancestors().find(|p| p.join(".git").exists()).expect("a repo");

            let at = prepare(repo_root, 9999, "sandbox/probe", "").await.expect("prepare");
            println!("the run works in {at}");

            let looked = inside(
                false,
                &format!("cd '{at}' && git rev-parse --abbrev-ref HEAD && ls /mnt/c 2>&1 | head -1"),
                Duration::from_secs(60),
            )
            .await
            .expect("look around");
            println!("{looked}");

            assert!(looked.contains("sandbox/probe"), "git works in there: {looked}");
            assert!(
                !looked.contains("Windows"),
                "this machine must not be reachable from inside: {looked}"
            );
        });
    }
}
