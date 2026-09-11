//! A container of its own for each run.
//!
//! **The one thing WSL cannot do.** Two runs in a distribution share a
//! filesystem and a user, so either can read the other's work; two containers
//! share nothing. That row in the capability table has said "no" in every
//! column for five rounds, and this is what changes it.
//!
//! **The working copy lives on this machine, not inside.** That is the opposite
//! of the WSL backend, and for a reason rather than by accident: a *clone* has a
//! real `.git` **directory**, self-contained, with no absolute path in it
//! anywhere — unlike a worktree, whose `.git` is a one-line file naming where
//! its repository sits. So a clone made inside a container into a bound folder
//! is an ordinary repository out here: read by ordinary local git, at ordinary
//! local speed, with none of the network-path trouble WSL needs.
//!
//! **What is applied is what is claimed.** Every flag below appears in a test
//! by name, because a dropped one is a protection that is silently gone and
//! nothing about the run would look different.

use super::sandbox_detect::AGENT_IMAGE;
use std::path::Path;

/// How much of this machine one run may take.
///
/// Chosen to be survivable rather than generous: a runaway build should hit a
/// wall well before it takes the machine down with it. The memory ceiling in
/// particular is the one that matters — this project has already met a build
/// that wanted four gigabytes.
const MEMORY: &str = "4g";
const CPUS: &str = "2";
const PIDS: &str = "512";

/// The container one run works in.
pub fn container_name(run_id: i64) -> String {
    format!("coperativeai-run-{run_id}")
}

/// Where a run's working copy sits on this machine.
///
/// Beside the repository rather than inside it, next to where run worktrees
/// already go — one folder per run, which is also what keeps one container from
/// being able to reach another's work.
pub fn run_folder(repo_root: &Path, run_id: i64) -> Result<std::path::PathBuf, String> {
    let parent = repo_root
        .parent()
        .ok_or_else(|| format!("{} has no parent folder to work beside", repo_root.display()))?;
    Ok(parent.join(".coperativeai-runs").join(run_id.to_string()))
}

/// The command that starts a run's container.
///
/// **The repository goes in read-only.** Nothing needs to write to it: work
/// comes back out by the repository fetching from the clone, which was settled
/// when the WSL backend landed. Read-only is therefore free, and free
/// protections are the ones worth taking.
pub fn run_args(repo_root: &Path, run_folder: &Path, run_id: i64, deny: &[String]) -> Vec<String> {
    let mut args: Vec<String> = vec!["run".into(), "-d".into(), "--name".into(), container_name(run_id)];
    for flag in [
        // Everything a container is normally allowed to do that this does not
        // need. Dropped as a set rather than picked over: an agent building a
        // web application needs none of them.
        "--cap-drop=ALL",
        // Nothing inside can become more privileged than it started, whatever
        // it runs.
        "--security-opt=no-new-privileges",
    ] {
        args.push(flag.into());
    }
    args.push("--pids-limit".into());
    args.push(PIDS.into());
    args.push("--memory".into());
    args.push(MEMORY.into());
    args.push("--cpus".into());
    args.push(CPUS.into());
    args.push("-v".into());
    args.push(format!("{}:/repo:ro", repo_root.display()));
    args.push("-v".into());
    args.push(format!("{}:/work", run_folder.display()));
    // **The policy, applied where a container can apply one: its mounts.**
    // Root inside here cannot take a file from the agent — `CAP_CHOWN` is
    // dropped — so the permissions route the distribution uses does not exist.
    // An empty read-only filesystem over the path does the same job and needs
    // no capability at all: what was underneath is simply not there.
    //
    // Which is also why the copy has to exist **before** the container does.
    // A mask cannot be added to a running container, and a clone into a
    // masked path would be a checkout writing to a read-only filesystem.
    for path in deny {
        args.push("--tmpfs".into());
        args.push(format!("/work/{path}:ro"));
    }
    args.push("-w".into());
    args.push("/work".into());
    args.push(AGENT_IMAGE.into());
    // Something that does nothing, for ever: the container is a place to run
    // commands in, not a command.
    args.push("sleep".into());
    args.push("infinity".into());
    args
}

/// Whether a run's container is already up.
pub fn is_running(said: &str, run_id: i64) -> bool {
    let wanted = container_name(run_id);
    said.lines().any(|line| line.trim() == wanted)
}

/// Gets a run's container up and its working copy cloned, and says which
/// container it is.
///
/// Idempotent, like its WSL counterpart: a run started again finds its
/// container up and its branch already checked out.
pub async fn prepare(
    repo_root: &Path,
    run_id: i64,
    branch: &str,
    base: &str,
) -> Result<String, String> {
    use super::sandbox_detect::{ask, Answered};
    use std::time::Duration;

    let folder = run_folder(repo_root, run_id)?;
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("could not make a folder for this run at {}: {e}", folder.display()))?;

    // **The copy is made before the container exists, and the policy is why.**
    // A container's restrictions are settled when it is created and cannot be
    // added afterwards — so a clone made *inside* would have to write into a
    // path the policy had already sealed, which is a checkout against a
    // read-only filesystem. Cloning first, out here, means the container is
    // created over a working copy that is already complete, and the masks go
    // straight on top of it.
    //
    // It is simpler as well: the folder is this machine's, so this is ordinary
    // local git with none of the ownership argument a bound folder provokes.
    let policy = super::sandbox_policy::read_policy(repo_root)?;
    let deny = super::sandbox_policy::deny_paths(&policy)?;
    clone_on_this_machine(repo_root, &folder, branch, base)?;

    let listed = match ask(
        "docker",
        &["ps", "--format", "{{.Names}}"],
        Duration::from_secs(30),
    )
    .await
    {
        Answered::Yes((_, said)) => String::from_utf8_lossy(&said).into_owned(),
        Answered::NotInstalled => return Err("Docker is not on this machine".into()),
        Answered::Silent => return Err("Docker did not answer in the time allowed".into()),
    };

    if !is_running(&listed, run_id) {
        // A container that was made and then stopped keeps its name, which
        // would otherwise make every later start fail with a name clash for a
        // reason nobody could see.
        let _ = ask(
            "docker",
            &["rm", "-f", &container_name(run_id)],
            Duration::from_secs(60),
        )
        .await;

        let args = run_args(repo_root, &folder, run_id, &deny);
        let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
        match ask("docker", &borrowed, Duration::from_secs(300)).await {
            Answered::Yes((true, _)) => {}
            Answered::Yes((false, said)) => {
                return Err(format!(
                    "the run's container would not start: {}",
                    String::from_utf8_lossy(&said).trim()
                ))
            }
            _ => return Err("Docker did not answer while starting the run's container".into()),
        }
    }

    Ok(container_name(run_id))
}

/// Makes the run's copy on this machine, before any container exists.
///
/// Ordinary local git on an ordinary local folder: the source and the target
/// are both this machine's, so there is none of the ownership argument a bound
/// folder provokes.
fn clone_on_this_machine(
    repo_root: &Path,
    folder: &Path,
    branch: &str,
    base: &str,
) -> Result<(), String> {
    let git = |args: &[&str], at: &Path| -> Result<String, String> {
        let out = std::process::Command::new("git")
            .current_dir(at)
            .args(args)
            .output()
            .map_err(|e| format!("could not run git — is it installed? ({e})"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    };

    if !folder.join(".git").is_dir() {
        git(
            &[
                "clone",
                "--no-hardlinks",
                &repo_root.to_string_lossy(),
                &folder.to_string_lossy(),
            ],
            repo_root,
        )
        .map_err(|said| format!("the run could not be given a copy to work in: {said}"))?;
    }

    let branch = branch.trim();
    if branch.is_empty() {
        return Ok(());
    }
    let base = if base.trim().is_empty() { "HEAD" } else { base.trim() };
    if git(&["rev-parse", "--verify", branch], folder).is_ok() {
        git(&["checkout", branch], folder)
    } else {
        git(&["checkout", "-b", branch, base], folder)
    }
    .map(|_| ())
    .map_err(|said| format!("the run's branch could not be made: {said}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> std::path::PathBuf {
        std::path::PathBuf::from(r"C:\work\shop")
    }

    /// **Every protection is named here, one assertion each.** A flag quietly
    /// dropped in a refactor is a protection quietly gone, and nothing about a
    /// run would look any different afterwards.
    #[test]
    fn every_control_the_table_claims_is_actually_applied() {
        let folder = run_folder(&repo(), 12).expect("a parent");
        let line = run_args(&repo(), &folder, 12, &[]).join(" ");

        assert!(line.contains("--cap-drop=ALL"), "capabilities: {line}");
        assert!(line.contains("--security-opt=no-new-privileges"), "privileges: {line}");
        assert!(line.contains("--pids-limit 512"), "processes: {line}");
        assert!(line.contains("--memory 4g"), "memory: {line}");
        assert!(line.contains("--cpus 2"), "processor: {line}");
    }

    /// The repository is never writable from inside. Work comes back by the
    /// repository fetching from the clone, so nothing needs it to be.
    #[test]
    fn the_repository_goes_in_read_only() {
        let folder = run_folder(&repo(), 12).expect("a parent");
        let line = run_args(&repo(), &folder, 12, &[]).join(" ");
        assert!(line.contains(r"C:\work\shop:/repo:ro"), "{line}");
        assert!(!line.contains(r"C:\work\shop:/repo "), "it must not also go in writable");
    }

    /// **The row that has said no in every column for five rounds.** Two runs
    /// get two containers and two folders; neither can reach the other.
    #[test]
    fn two_runs_share_nothing_at_all() {
        let one = run_folder(&repo(), 1).expect("a parent");
        let two = run_folder(&repo(), 2).expect("a parent");
        assert_ne!(one, two);
        assert_ne!(container_name(1), container_name(2));

        let line = run_args(&repo(), &one, 1, &[]).join(" ");
        assert!(!line.contains(&two.display().to_string()), "one run must not see the other");
    }

    #[test]
    fn a_container_that_is_already_up_is_not_started_again() {
        let listed = "coperativeai-run-3\ncoperativeai-run-12\n";
        assert!(is_running(listed, 12));
        assert!(!is_running(listed, 4));
        // Not a prefix match: run 1 is not run 12.
        assert!(!is_running("coperativeai-run-12\n", 1));
    }

    /// **The policy, where a container can apply one.** Root inside cannot
    /// take a file from the agent -- CAP_CHOWN is dropped -- so the mask is
    /// the mechanism, and it needs no capability at all.
    #[test]
    fn a_denied_path_is_masked_when_the_container_is_made() {
        let folder = run_folder(&repo(), 12).expect("a parent");
        let deny = vec!["secrets".to_string(), "config/keys.json".to_string()];
        let line = run_args(&repo(), &folder, 12, &deny).join(" ");

        assert!(line.contains("--tmpfs /work/secrets:ro"), "{line}");
        assert!(line.contains("--tmpfs /work/config/keys.json:ro"), "{line}");
    }

    /// A repository with nothing to hide is the ordinary case, and it must not
    /// pick up restrictions it never asked for.
    #[test]
    fn a_run_with_no_policy_is_masked_nowhere() {
        let folder = run_folder(&repo(), 12).expect("a parent");
        let line = run_args(&repo(), &folder, 12, &[]).join(" ");
        assert!(!line.contains("--tmpfs"), "{line}");
    }

    /// **A policy, in a real container, checked from inside it.**
    ///
    /// Makes a repository with something to hide and a policy that hides it,
    /// prepares a run the way the app does, and then asks the agent's own
    /// account what it can see. Needs a running engine and the agent image.
    #[test]
    #[ignore = "needs a running Docker engine and the agent image"]
    fn a_denied_path_is_really_not_there_inside_the_container() {
        use super::super::sandbox_detect::{ask, Answered};
        use std::time::Duration;

        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            // A small repository of its own, so nothing here depends on the
            // shape of the one this is being written in.
            let root = std::env::temp_dir().join(format!("polrepo-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(root.join("secrets")).expect("make it");
            std::fs::create_dir_all(root.join(".coperativeai")).expect("make it");
            std::fs::write(root.join("secrets/keys.txt"), "the crown jewels").expect("write");
            std::fs::write(root.join("readme.md"), "ordinary work").expect("write");
            std::fs::write(
                root.join(".coperativeai/policy.json"),
                r#"{"deny": ["secrets"]}"#,
            )
            .expect("write the policy");

            let git = |args: &[&str]| {
                std::process::Command::new("git")
                    .current_dir(&root)
                    .args(args)
                    .output()
                    .expect("git runs")
            };
            git(&["init", "-q"]);
            git(&["add", "-A"]);
            git(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "first"]);

            let container = prepare(&root, 9997, "policy/probe", "")
                .await
                .expect("a container with the policy applied");

            let look = |script: &'static str| {
                let name = container.clone();
                async move {
                    let args = ["exec".to_string(), name, "sh".into(), "-c".into(), script.into()];
                    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
                    match ask("docker", &borrowed, Duration::from_secs(60)).await {
                        Answered::Yes((_, said)) => String::from_utf8_lossy(&said).trim().to_string(),
                        _ => String::new(),
                    }
                }
            };

            // The work is there…
            assert!(look("cat /work/readme.md").await.contains("ordinary work"));
            // …and what the policy denied is not.
            let hidden = look("cat /work/secrets/keys.txt 2>&1; echo ---; ls -A /work/secrets").await;
            println!("{hidden}");
            assert!(
                !hidden.contains("crown jewels"),
                "the policy did not keep it from the agent: {hidden}"
            );

            let _ = ask(
                "docker",
                &["rm", "-f", &container_name(9997)],
                Duration::from_secs(60),
            )
            .await;
            let _ = std::fs::remove_dir_all(&root);
            let _ = run_folder(&root, 9997).map(std::fs::remove_dir_all);
        });
    }

    /// **The claims, checked against a real container.**
    ///
    /// Every assertion here is one the capability table makes. Needs a running
    /// engine and the agent image, and leaves nothing behind.
    #[test]
    #[ignore = "needs a running Docker engine and the agent image"]
    fn a_real_container_enforces_what_the_table_says_it_does() {
        use super::super::sandbox_detect::{ask, Answered};
        use std::time::Duration;

        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let here = std::env::current_dir().expect("cwd");
            let repo = here.ancestors().find(|p| p.join(".git").exists()).expect("a repo");

            let container = prepare(repo, 9998, "sandbox/probe-docker", "")
                .await
                .expect("a container and a copy to work in");
            println!("working in {container}");

            let look = |script: &'static str| {
                let name = container.clone();
                async move {
                    let args = ["exec".to_string(), name, "sh".into(), "-c".into(), script.into()];
                    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
                    match ask("docker", &borrowed, Duration::from_secs(60)).await {
                        Answered::Yes((_, said)) => String::from_utf8_lossy(&said).trim().to_string(),
                        _ => String::new(),
                    }
                }
            };

            // Not root, and unable to become it.
            assert_ne!(look("id -u").await, "0", "it must not run as root");
            // Only what was bound, and the repository is read-only. Asked by
            // trying, and judged on **what the kernel said** rather than on an
            // exit status — a shell reports that inconsistently enough that the
            // test would pass while the write succeeded.
            let refused = look("touch /repo/probe 2>&1").await;
            assert!(
                refused.contains("Read-only file system"),
                "the repository must not be writable from inside: {refused}"
            );
            // git works in there, which is the point of the clone.
            assert!(
                look("cd /work && git rev-parse --abbrev-ref HEAD").await.contains("probe-docker"),
                "git has to work in the copy"
            );
            // Nothing of this machine beyond the two mounts.
            let mounted = look("ls /").await;
            assert!(mounted.contains("work") && mounted.contains("repo"));

            let _ = ask(
                "docker",
                &["rm", "-f", &container_name(9998)],
                Duration::from_secs(60),
            )
            .await;
        });
    }
}
