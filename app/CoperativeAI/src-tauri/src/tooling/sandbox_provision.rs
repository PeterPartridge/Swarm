//! Building the boundary the app owns.
//!
//! **This is the one thing here that changes somebody's computer**, so it is a
//! press and never a consequence: nothing below runs on startup, on a setting
//! change, or on opening the panel. It registers a WSL distribution or builds a
//! container image, and it hands back everything it printed rather than
//! reducing a five-minute install to "done" — the same treatment the global npm
//! install already gets, and for the same reason. When a toolchain is missing
//! or a download fails, that output is the only thing that names it.
//!
//! **Why the app owns a distribution at all.** WSL only becomes a boundary in
//! one that does not mount this machine's drive, and the ordinary ones all do.
//! A mode whose protection depends on configuration the app did not set can
//! only report other people's accidents, so it sets it.
//!
//! **What decides is separated from what runs**, as in the detector beside
//! this: `plan_wsl` and `plan_docker` are pure, so "an existing distribution is
//! configured, never recreated" is a test rather than a hope.
//!
//! Nothing here starts a process directly — it reaches the machine through the
//! detector's `ask`, which is the file the seam test has filed as a spawner.
//! That is why this one is in neither of its lists.

use super::sandbox_detect::{
    ask, Answered, DockerFindings, WslFindings, AGENT_IMAGE, OWN_DISTRIBUTION,
};
use std::time::Duration;

/// What the app's distribution is made from.
///
/// Fixed rather than offered. This distribution is the app's own, and a picker
/// invites pointing it at something the app then cannot vouch for.
pub const BASE_DISTRIBUTION: &str = "Ubuntu";

/// Who the agent runs as inside. Anyone but root.
pub const AGENT_USER: &str = "agent";

/// One thing that has to happen for a sandbox to exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WslStep {
    /// Register the distribution. Downloads it, so it is the slow one.
    Create,
    /// The file that unmounts this machine's drive and names the user.
    WriteConfig,
    CreateUser,
    /// Somewhere for runs to live, owned by the agent rather than by root.
    /// Without it the first run fails on `mkdir: Permission denied`, which is
    /// what the live check found.
    MakeRunSpace,
    /// git, node and Claude Code — what the *agent* needs. Never a Solution's
    /// own toolchain, which belongs to that Solution.
    InstallTools,
    /// **Without this the whole thing appears to have done nothing.**
    /// `/etc/wsl.conf` is read when a distribution starts, so until it is
    /// stopped the drive stays mounted, detection keeps saying so, and somebody
    /// reasonably concludes the feature is broken.
    Terminate,
}

impl WslStep {
    pub fn name(self) -> &'static str {
        match self {
            WslStep::Create => "Create the distribution",
            WslStep::WriteConfig => "Unmount this machine's drive",
            WslStep::CreateUser => "Add a user that is not root",
            WslStep::MakeRunSpace => "Make somewhere for runs to live",
            WslStep::InstallTools => "Install what the agent needs",
            WslStep::Terminate => "Restart it so the settings apply",
        }
    }
}

/// What happened when one step ran.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub name: String,
    pub succeeded: bool,
    /// Whole, and in the tool's own words. Trimmed only at the front, because
    /// what a failing install has to say is at the end.
    pub output: String,
}

/// What a whole set-up did.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Provisioned {
    pub mode: String,
    pub steps: Vec<Step>,
    pub succeeded: bool,
    pub summary: String,
}

// ---------------------------------------------------------------------------
// Deciding: pure.
// ---------------------------------------------------------------------------

/// What still needs doing for WSL, or why nothing can be.
pub fn plan_wsl(found: &WslFindings) -> Result<Vec<WslStep>, String> {
    if !found.installed {
        return Err("WSL is not installed on this machine, so there is nothing to set up.".into());
    }
    if !found.answered {
        return Err("WSL did not answer, so what it would need is not known yet.".into());
    }
    if !found.can_own_distribution {
        return Err(format!(
            "This WSL ({}) is too old to be given a distribution of its own — that needs 2.4.4 \
             or newer. Updating WSL is the only way through; this app will not take over a \
             distribution somebody else installed.",
            if found.version.is_empty() { "version unknown" } else { &found.version }
        ));
    }

    // An existing one is configured, never recreated. Somebody may have work in
    // it, and destroying that to reach a tidy state is not this app's call.
    let mut steps = Vec::with_capacity(5);
    if !found.own_distribution {
        steps.push(WslStep::Create);
    }
    steps.push(WslStep::WriteConfig);
    steps.push(WslStep::CreateUser);
    steps.push(WslStep::MakeRunSpace);
    steps.push(WslStep::InstallTools);
    steps.push(WslStep::Terminate);
    Ok(steps)
}

/// Whether the agent's image can be built here, or why not.
pub fn plan_docker(found: &DockerFindings) -> Result<(), String> {
    if !found.client_installed {
        return Err("Docker is not installed on this machine, so there is nothing to build.".into());
    }
    if found.server_version.is_empty() {
        return Err(
            "Docker's engine is not running, and an image cannot be built without it. Start \
             Docker Desktop and look again."
                .into(),
        );
    }
    Ok(())
}

/// The file that makes a distribution a boundary.
///
/// **`automount` off is the whole point.** With it on — which is every
/// distribution's default — an agent inside can write to the entire Windows
/// drive, and "running in WSL" reassures without protecting.
///
/// The repository still reaches in later, as one named mount rather than a
/// whole drive. That is the same boundary a container gets, said the same way.
pub fn wsl_conf() -> String {
    format!(
        // No apostrophes anywhere in here: this whole file travels to `sh -c`
        // inside single quotes, and one of its own would end the string early
        // and leave a half-written config. `no_single_quotes` holds it.
        "# Written by CoperativeAI. This distribution belongs to the app.\n\
         [automount]\n\
         enabled = false\n\
         \n\
         [user]\n\
         default = {AGENT_USER}\n"
    )
}

/// What the agent runs in under Docker.
///
/// **Only the agent's own needs.** A Solution's build toolchain is that
/// Solution's, taken from its own container definition — an image with every
/// toolchain in it would be stale within a month and wrong in a way nobody
/// could see until a build failed wearing the wrong version number.
pub fn dockerfile() -> String {
    format!(
        "# Written by CoperativeAI. The agent's needs only — a Solution's own\n\
         # toolchain comes from that Solution's container definition.\n\
         FROM debian:stable-slim\n\
         RUN apt-get update \\\n\
         \x20   && apt-get install -y --no-install-recommends git ca-certificates nodejs npm \\\n\
         \x20   && rm -rf /var/lib/apt/lists/*\n\
         RUN npm install -g @anthropic-ai/claude-code\n\
         RUN useradd -m -s /bin/bash {AGENT_USER}\n\
         USER {AGENT_USER}\n\
         WORKDIR /work\n"
    )
}

/// The shell each step runs inside the distribution.
///
/// Passed as one argument to `sh -c` and wrapped in single quotes on the way,
/// so nothing in here may contain one. `no_single_quotes` holds that.
fn wsl_command(step: WslStep) -> String {
    match step {
        WslStep::WriteConfig => {
            format!("printf %s '{}' > /etc/wsl.conf", wsl_conf())
        }
        // Idempotent on purpose: setting up twice is an ordinary thing to do
        // after a failed download, and the second run must not fail on a user
        // the first one already made.
        WslStep::CreateUser => format!(
            "id -u {AGENT_USER} >/dev/null 2>&1 || useradd -m -s /bin/bash {AGENT_USER}"
        ),
        // **From the distribution's own packages, not a script piped from the
        // internet.** Node may lag a release behind that way; fetching a shell
        // script over the network and running it as root inside the boundary
        // this exists to build would be a worse trade than an older Node.
        WslStep::MakeRunSpace => format!(
            "mkdir -p /work/runs /mnt/repos && chown -R {AGENT_USER}:{AGENT_USER} /work"
        ),
        WslStep::InstallTools => "apt-get update && apt-get install -y --no-install-recommends \
             git ca-certificates nodejs npm && npm install -g @anthropic-ai/claude-code"
            .to_string(),
        WslStep::Create | WslStep::Terminate => String::new(),
    }
}

// ---------------------------------------------------------------------------
// Running: the half that changes the machine.
// ---------------------------------------------------------------------------

/// How long each step is given. The install really does take minutes on a thin
/// connection, and a timeout that fires mid-download leaves a worse mess than
/// waiting does.
fn patience(step: WslStep) -> Duration {
    match step {
        WslStep::Create => Duration::from_secs(900),
        WslStep::InstallTools => Duration::from_secs(900),
        _ => Duration::from_secs(120),
    }
}

fn ran(name: &str, answered: Answered<(bool, Vec<u8>)>) -> Step {
    match answered {
        Answered::Yes((succeeded, said)) => Step {
            name: name.to_string(),
            succeeded,
            output: super::sandbox_detect::decode_wsl(&said).trim().to_string(),
        },
        Answered::NotInstalled => Step {
            name: name.to_string(),
            succeeded: false,
            output: "the tool this needs is not on this machine".into(),
        },
        Answered::Silent => Step {
            name: name.to_string(),
            succeeded: false,
            output: "it did not finish in the time allowed and was given up on".into(),
        },
    }
}

/// Creates and configures the app's own distribution.
///
/// **Stops at the first failure.** Every step after a failed one would be
/// working on a distribution that is not in the state it assumed, and reporting
/// four more failures caused by the first buries the one that matters.
pub async fn provision_wsl(found: &WslFindings) -> Provisioned {
    let planned = match plan_wsl(found) {
        Ok(steps) => steps,
        Err(why) => {
            return Provisioned {
                mode: "wsl".into(),
                steps: Vec::new(),
                succeeded: false,
                summary: why,
            }
        }
    };

    let mut steps = Vec::with_capacity(planned.len());
    for step in planned {
        let args: Vec<String> = match step {
            WslStep::Create => vec![
                "--install".into(),
                BASE_DISTRIBUTION.into(),
                "--name".into(),
                OWN_DISTRIBUTION.into(),
                "--no-launch".into(),
            ],
            WslStep::Terminate => vec!["--terminate".into(), OWN_DISTRIBUTION.into()],
            // As root, because there is nothing else yet — the user this
            // creates is who the agent will be.
            other => vec![
                "-d".into(),
                OWN_DISTRIBUTION.into(),
                "--user".into(),
                "root".into(),
                "--".into(),
                "sh".into(),
                "-c".into(),
                wsl_command(other),
            ],
        };
        let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
        let outcome = ran(
            step.name(),
            ask("wsl.exe", &borrowed, patience(step)).await,
        );
        let failed = !outcome.succeeded;
        steps.push(outcome);
        if failed {
            return failed_at("wsl", steps);
        }
    }

    Provisioned {
        mode: "wsl".into(),
        succeeded: true,
        summary: format!(
            "'{OWN_DISTRIBUTION}' is set up: this machine's drive is not mounted in it, and it \
             runs as '{AGENT_USER}'. Signing Claude Code in inside it is still to come."
        ),
        steps,
    }
}

/// Builds the agent's image.
pub async fn provision_docker(found: &DockerFindings) -> Provisioned {
    if let Err(why) = plan_docker(found) {
        return Provisioned { mode: "docker".into(), steps: Vec::new(), succeeded: false, summary: why };
    }

    let folder = std::env::temp_dir().join(format!("coperativeai-agent-image-{}", std::process::id()));
    let mut steps = Vec::with_capacity(2);
    if let Err(e) = std::fs::create_dir_all(&folder)
        .and_then(|()| std::fs::write(folder.join("Dockerfile"), dockerfile()))
    {
        steps.push(Step {
            name: "Write the image's definition".into(),
            succeeded: false,
            output: format!("could not write it to {}: {e}", folder.display()),
        });
        return failed_at("docker", steps);
    }

    let built = ran(
        "Build the agent's image",
        ask(
            "docker",
            &["build", "-t", AGENT_IMAGE, folder.to_string_lossy().as_ref()],
            Duration::from_secs(900),
        )
        .await,
    );
    let succeeded = built.succeeded;
    steps.push(built);
    let _ = std::fs::remove_dir_all(&folder);

    if !succeeded {
        return failed_at("docker", steps);
    }
    Provisioned {
        mode: "docker".into(),
        succeeded: true,
        summary: format!(
            "'{AGENT_IMAGE}' is built — git, Node and Claude Code, running as '{AGENT_USER}'. \
             What a Solution needs to build itself still comes from that Solution."
        ),
        steps,
    }
}

/// The report for a set-up that stopped partway.
fn failed_at(mode: &str, steps: Vec<Step>) -> Provisioned {
    let failed = steps.last().map(|s| s.name.clone()).unwrap_or_default();
    Provisioned {
        mode: mode.to_string(),
        succeeded: false,
        summary: format!(
            "Stopped at '{failed}', and nothing after it was attempted. What it printed is below \
             — running this again picks up from where it got to."
        ),
        steps,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn modern_wsl() -> WslFindings {
        WslFindings {
            installed: true,
            answered: true,
            version: "2.7.13.0".into(),
            can_own_distribution: true,
            ..Default::default()
        }
    }

    #[test]
    fn a_machine_with_no_distribution_of_ours_is_given_one() {
        let steps = plan_wsl(&modern_wsl()).expect("a modern WSL can be set up");
        assert_eq!(steps[0], WslStep::Create);
        assert!(steps.contains(&WslStep::WriteConfig));
    }

    /// Somebody may have work in it. Reaching a tidy state by destroying that
    /// is not this app's call to make.
    #[test]
    fn an_existing_distribution_is_configured_and_never_recreated() {
        let mut found = modern_wsl();
        found.own_distribution = true;
        let steps = plan_wsl(&found).expect("configuring is still possible");
        assert!(!steps.contains(&WslStep::Create), "it must not be made again: {steps:?}");
        assert!(steps.contains(&WslStep::WriteConfig));
    }

    /// **The step whose absence makes everything else look like a no-op.**
    /// `/etc/wsl.conf` is read at start-up, so without a restart the drive
    /// stays mounted and detection goes on saying so.
    #[test]
    fn a_mounted_drive_is_unmounted_and_the_distribution_restarted() {
        let mut found = modern_wsl();
        found.own_distribution = true;
        found.drive_mounted = Some(true);
        let steps = plan_wsl(&found).expect("plan");
        assert!(steps.contains(&WslStep::WriteConfig));
        assert_eq!(steps.last(), Some(&WslStep::Terminate), "the restart comes last: {steps:?}");
    }

    #[test]
    fn an_old_wsl_is_told_the_truth_rather_than_worked_around() {
        let mut found = modern_wsl();
        found.can_own_distribution = false;
        found.version = "2.3.26.0".into();
        let refused = plan_wsl(&found).expect_err("2.3 cannot name a distribution");
        assert!(refused.contains("2.3.26.0"), "it should say which version: {refused}");
        assert!(refused.contains("2.4.4"));
    }

    #[test]
    fn a_machine_without_wsl_is_not_offered_a_set_up() {
        assert!(plan_wsl(&WslFindings::default()).is_err());
        let silent = WslFindings { installed: true, ..Default::default() };
        assert!(plan_wsl(&silent).is_err());
    }

    #[test]
    fn the_config_written_really_does_unmount_the_drive_and_drop_root() {
        let written = wsl_conf();
        assert!(written.contains("[automount]"));
        assert!(written.contains("enabled = false"));
        assert!(written.contains(&format!("default = {AGENT_USER}")));
        assert!(!written.contains("default = root"));
    }

    /// **The config travels inside single quotes on its way to `sh -c`.** One
    /// of its own would end the string early and leave a half-written file — and
    /// the first draft of this really did contain one, in the word "app's".
    /// Cheap to write, and it catches a break that would only show up as a
    /// distribution that silently stayed unbounded.
    #[test]
    fn no_single_quotes_survive_into_a_shell_argument() {
        assert!(
            !wsl_conf().contains('\''),
            "the config is embedded in a quoted argument and must carry no quote of its own"
        );
        for step in [WslStep::CreateUser, WslStep::InstallTools] {
            assert!(
                !wsl_command(step).contains('\''),
                "{step:?} would break out of its quoting"
            );
        }
    }

    /// The agent's needs, and nothing of anybody's project.
    #[test]
    fn the_image_carries_the_agent_and_no_solutions_toolchain() {
        let written = dockerfile();
        for needed in ["git", "nodejs", "@anthropic-ai/claude-code"] {
            assert!(written.contains(needed), "the agent needs {needed}");
        }
        for theirs in ["cargo", "dotnet", "python", "go install"] {
            assert!(!written.contains(theirs), "{theirs} belongs to a Solution, not to this");
        }
        assert!(written.contains(&format!("USER {AGENT_USER}")), "it must not run as root");
    }

    #[test]
    fn nothing_is_built_without_an_engine_to_build_it() {
        assert!(plan_docker(&DockerFindings::default()).is_err());
        let stopped = DockerFindings { client_installed: true, ..Default::default() };
        let refused = plan_docker(&stopped).expect_err("no engine, no image");
        assert!(refused.contains("engine is not running"));

        let running = DockerFindings {
            client_installed: true,
            server_version: "27.3.1".into(),
            ..Default::default()
        };
        assert!(plan_docker(&running).is_ok());
    }

    /// A failure names the step it stopped at, and keeps what that step said.
    #[test]
    fn a_set_up_that_stops_says_where_and_keeps_the_words() {
        let steps = vec![
            Step { name: "Create the distribution".into(), succeeded: true, output: String::new() },
            Step {
                name: "Install what the agent needs".into(),
                succeeded: false,
                output: "E: Unable to locate package nodejs".into(),
            },
        ];
        let stopped = failed_at("wsl", steps);
        assert!(!stopped.succeeded);
        assert!(stopped.summary.contains("Install what the agent needs"));
        assert!(stopped.steps.last().expect("a step").output.contains("Unable to locate"));
    }

    /// **Builds the agent's image for real.**
    ///
    /// Ignored by default because it needs a running engine and pulls a base
    /// image over the network. It is the only thing that proves the Dockerfile
    /// this app writes is one Docker will actually accept.
    #[test]
    #[ignore = "needs a running Docker engine; pulls a base image"]
    fn building_the_agent_image_for_real() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let found = super::super::sandbox_detect::docker().await;
            let done = provision_docker(&found).await;
            for step in &done.steps {
                println!("{} — {}", step.name, if step.succeeded { "done" } else { "failed" });
                println!("{}", step.output);
            }
            assert!(done.succeeded, "the image did not build: {}", done.summary);

            let after = super::super::sandbox_detect::docker().await;
            assert!(after.agent_image, "the image should be there now");
        });
    }

    /// **Runs for real. Registers a distribution and downloads it.**
    ///
    /// Ignored by default for the obvious reason: it changes the machine it is
    /// run on. It exists because nothing above proves the commands are spelled
    /// the way WSL expects, and that is the half that fails.
    #[test]
    #[ignore = "changes this machine: registers a WSL distribution and downloads it"]
    fn setting_up_for_real() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let before = super::super::sandbox_detect::wsl().await;
            let done = provision_wsl(&before).await;
            println!("{done:#?}");
            assert!(done.succeeded, "set-up failed: {}", done.summary);

            let after = super::super::sandbox_detect::wsl().await;
            println!("after: {after:#?}");
            assert!(after.own_distribution, "the distribution should exist now");
            assert_eq!(
                after.drive_mounted,
                Some(false),
                "the whole point: this machine's drive must not be reachable from inside"
            );
            assert_eq!(after.root, Some(false), "it must not run as root");
        });
    }
}
