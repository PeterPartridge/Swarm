//! What this machine can actually offer, established rather than assumed.
//!
//! **Separate from `sandbox` on purpose.** That module is pure and never starts
//! a process — which is why the seam's own caller test skips it, since it names
//! `Command::new` in prose rather than using it. A spawn hidden there would be
//! invisible to that test. This one spawns, so it lives here and is filed in
//! the seam test's `OUTSIDE` list where anyone can see it: asking the machine
//! what it has is the app working on its own account, not running somebody's
//! command.
//!
//! **Run and read are separated everywhere below**, the way the test runner's
//! parsers already are. Running needs WSL or Docker installed; reading is a
//! pure function over what they printed. So the reading half — which is where
//! every judgement lives — is tested against real captured output on a machine
//! that has neither.
//!
//! **Nothing here is cached.** The configuration it reports can be changed
//! outside this app between one look and the next, so a remembered answer is a
//! claim about a machine that may have moved on.

use std::process::Stdio;
use std::time::Duration;

/// The name of the distribution this app creates for itself.
///
/// Fixed rather than configurable: it is the app's own, and a setting would
/// invite pointing it at somebody else's distribution while still calling it
/// the one the app configured.
pub const OWN_DISTRIBUTION: &str = "coperativeai";

/// The image the agent runs in — the app's to maintain, and only the agent's
/// needs are in it. A Solution's build toolchain is the Solution's own.
pub const AGENT_IMAGE: &str = "coperativeai-agent";

/// Distributions that exist to run Docker rather than to work in.
///
/// Offering these as somewhere to run an agent would be offering Docker's own
/// plumbing as a workspace.
const DOCKER_INTERNAL: &[&str] = &["docker-desktop", "docker-desktop-data"];

/// A tool that has to answer before anything can be said about it.
///
/// **"It did not answer" is not "it is not there."** A cold WSL virtual machine
/// takes seconds to start, and reporting that silence as absence would tell
/// somebody their perfectly good installation is missing.
#[derive(Debug, Clone, PartialEq)]
pub enum Answered<T> {
    Yes(T),
    NotInstalled,
    Silent,
}

/// What WSL says about itself.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WslFindings {
    pub installed: bool,
    /// False when it is installed but never answered.
    pub answered: bool,
    /// Distributions somebody could work in — Docker's own excluded.
    pub distributions: Vec<String>,
    /// Whether the app's own distribution is among them.
    pub own_distribution: bool,
    /// Whether this machine's drive is really mounted inside the app's own
    /// distribution. `None` when there was no distribution to look in.
    pub drive_mounted: Option<bool>,
    /// Whether the app's own distribution runs as root. `None` as above.
    pub root: Option<bool>,
    /// What went wrong, in the tool's own words where there are any.
    pub detail: String,
}

/// What Docker says about itself.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DockerFindings {
    /// Empty when no server answered — which is not the same as no Docker.
    pub server_version: String,
    pub client_installed: bool,
    pub agent_image: bool,
    pub detail: String,
}

// ---------------------------------------------------------------------------
// Reading: pure, and tested against real captures.
// ---------------------------------------------------------------------------

/// Turns `wsl.exe`'s output into text.
///
/// **WSL prints UTF-16, and reading it as UTF-8 gets nothing useful.** Every
/// other byte is a zero, so a naive read yields `U\0b\0u\0n\0t\0u\0` — which
/// matches no distribution name and reports a working install as empty. This
/// notices the zeroes and decodes accordingly rather than assuming either way.
pub fn decode_wsl(bytes: &[u8]) -> String {
    let zeroes = bytes.iter().filter(|b| **b == 0).count();
    if bytes.len() >= 4 && zeroes * 3 >= bytes.len() {
        let pairs: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        return String::from_utf16_lossy(&pairs);
    }
    String::from_utf8_lossy(bytes).into_owned()
}

/// The distributions worth offering, from `wsl -l -q`.
pub fn usable_distributions(listed: &str) -> Vec<String> {
    listed
        .lines()
        .map(|line| line.trim().trim_matches('\u{0}').trim())
        .filter(|line| !line.is_empty())
        .filter(|line| !DOCKER_INTERNAL.contains(&line.to_lowercase().as_str()))
        .map(str::to_string)
        .collect()
}

/// Whether this machine's own drive is reachable from inside, read from
/// `/proc/mounts`.
///
/// **The mounts are asked, not the configuration.** `wsl.conf` states an
/// intention; a running distribution states a fact, and the two disagree
/// whenever the file was edited without a restart. The fact is what an agent
/// would actually be able to write to.
///
/// Three spellings, because WSL has used all of them: `drvfs` originally, `9p`
/// for years, and `virtiofs` on recent builds. Matching only the first would
/// report today's ordinary Ubuntu as bounded, which is the most dangerous
/// wrong answer this file could give.
pub fn drive_is_mounted(proc_mounts: &str) -> bool {
    proc_mounts.lines().any(|line| {
        let mut fields = line.split_whitespace();
        let _source = fields.next();
        let target = fields.next().unwrap_or("");
        let rest = line.to_lowercase();
        target.starts_with("/mnt/")
            && (rest.contains("drvfs") || rest.contains(" 9p ") || rest.contains("virtiofs"))
    })
}

/// The uid `id -u` printed, as "is this root".
pub fn is_root(said: &str) -> Option<bool> {
    said.trim().lines().next()?.trim().parse::<u32>().ok().map(|uid| uid == 0)
}

/// The server version from `docker version --format {{.Server.Version}}`.
///
/// **The server, never the client.** A Docker client with no engine running is
/// the commonest state of all on a machine that has Docker installed, and it
/// answers questions about itself perfectly happily — so asking anything but
/// the server reports a sandbox that cannot run a thing.
pub fn server_version(said: &str) -> Option<String> {
    let line = said.trim().lines().next()?.trim();
    if line.is_empty() || line.contains("error") || line.contains("Cannot connect") {
        return None;
    }
    Some(line.to_string())
}

// ---------------------------------------------------------------------------
// Running: the half that needs the tools installed.
// ---------------------------------------------------------------------------

/// Runs a tool and hands back what it printed, or why it could not be asked.
async fn ask(program: &str, args: &[&str], patience: Duration) -> Answered<(bool, Vec<u8>)> {
    let Some(exe) = crate::tooling::dev_runner::which(program) else {
        return Answered::NotInstalled;
    };
    let attempt = tokio::time::timeout(
        patience,
        tokio::process::Command::new(exe)
            .args(args)
            .stdin(Stdio::null())
            .output(),
    )
    .await;
    match attempt {
        Ok(Ok(output)) => {
            let mut said = output.stdout;
            said.extend_from_slice(&output.stderr);
            Answered::Yes((output.status.success(), said))
        }
        // A tool that is there and will not run is not the same as one that is
        // absent, and both differ from one that never came back.
        Ok(Err(_)) => Answered::NotInstalled,
        Err(_) => Answered::Silent,
    }
}

/// What WSL offers on this machine.
pub async fn wsl() -> WslFindings {
    // Generous, because a cold WSL virtual machine really does take this long
    // to answer the first question after a reboot.
    let listed = ask("wsl.exe", &["-l", "-q"], Duration::from_secs(30)).await;
    let mut findings = WslFindings::default();
    let said = match listed {
        Answered::NotInstalled => {
            findings.detail = "WSL is not installed on this machine.".into();
            return findings;
        }
        Answered::Silent => {
            findings.installed = true;
            findings.detail =
                "WSL is installed but did not answer within 30 seconds, so nothing can be \
                 said about it yet. Trying again usually works — a cold virtual machine \
                 takes a while to start."
                    .into();
            return findings;
        }
        Answered::Yes((_, bytes)) => decode_wsl(&bytes),
    };

    findings.installed = true;
    findings.answered = true;
    findings.distributions = usable_distributions(&said);
    findings.own_distribution = findings
        .distributions
        .iter()
        .any(|d| d.eq_ignore_ascii_case(OWN_DISTRIBUTION));

    if !findings.own_distribution {
        findings.detail = format!(
            "This app has not created its own distribution yet, so there is nothing here it \
             configured. {}",
            if findings.distributions.is_empty() {
                "There are no distributions on this machine at all.".to_string()
            } else {
                format!("Found: {}.", findings.distributions.join(", "))
            }
        );
        return findings;
    }

    // Only the app's own distribution is inspected. What somebody else's does
    // is their business, and reporting on it would suggest the app had a say.
    if let Answered::Yes((_, bytes)) = ask(
        "wsl.exe",
        &["-d", OWN_DISTRIBUTION, "--", "cat", "/proc/mounts"],
        Duration::from_secs(30),
    )
    .await
    {
        findings.drive_mounted = Some(drive_is_mounted(&decode_wsl(&bytes)));
    }
    if let Answered::Yes((_, bytes)) = ask(
        "wsl.exe",
        &["-d", OWN_DISTRIBUTION, "--", "id", "-u"],
        Duration::from_secs(30),
    )
    .await
    {
        findings.root = is_root(&decode_wsl(&bytes));
    }
    findings
}

/// What Docker offers on this machine.
pub async fn docker() -> DockerFindings {
    let mut findings = DockerFindings::default();
    let asked = ask(
        "docker",
        &["version", "--format", "{{.Server.Version}}"],
        Duration::from_secs(20),
    )
    .await;
    match asked {
        Answered::NotInstalled => {
            findings.detail = "Docker is not installed on this machine.".into();
            return findings;
        }
        Answered::Silent => {
            findings.client_installed = true;
            findings.detail = "Docker did not answer within 20 seconds.".into();
            return findings;
        }
        Answered::Yes((_, bytes)) => {
            findings.client_installed = true;
            let said = String::from_utf8_lossy(&bytes);
            match server_version(&said) {
                Some(version) => findings.server_version = version,
                None => {
                    findings.detail =
                        "Docker is installed, but its engine is not running — so nothing can \
                         be run in a container yet. Start Docker Desktop and look again."
                            .into();
                    return findings;
                }
            }
        }
    }

    if let Answered::Yes((ok, _)) = ask(
        "docker",
        &["image", "inspect", AGENT_IMAGE],
        Duration::from_secs(20),
    )
    .await
    {
        findings.agent_image = ok;
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **This machine's own mount line**, captured from a stock Ubuntu under
    /// WSL. It is the whole reason the honesty rule needed a page: an agent in
    /// this distribution can rewrite the entire Windows drive, and nothing
    /// about the words "running in WSL" suggests it.
    const REAL_UBUNTU_MOUNTS: &str = "\
none / overlay rw,relatime 0 0
none /mnt/wsl tmpfs rw,relatime 0 0
C:\\134 /mnt/c 9p rw,noatime,aname=drvfs;path=C:\\;uid=1000;gid=1000;symlinkroot=/mnt/,cache=0x5,access=client,msize=65536,trans=fd,rfd=6,wfd=6 0 0
";

    #[test]
    fn a_stock_distribution_is_reported_as_no_boundary_at_all() {
        assert!(
            drive_is_mounted(REAL_UBUNTU_MOUNTS),
            "an agent here can write to the whole machine, and the table must say so"
        );
    }

    /// The three spellings WSL has used. Matching only `drvfs` would report
    /// today's ordinary distribution as bounded — the most dangerous wrong
    /// answer this file could give.
    #[test]
    fn every_spelling_of_the_windows_drive_is_recognised() {
        for line in [
            "C:\\134 /mnt/c 9p rw,aname=drvfs;path=C:\\ 0 0",
            "drvfs /mnt/d drvfs rw,noatime 0 0",
            "drivefs /mnt/c virtiofs rw,relatime 0 0",
        ] {
            assert!(drive_is_mounted(line), "not recognised: {line}");
        }
    }

    #[test]
    fn a_distribution_with_nothing_of_this_machine_in_it_is_bounded() {
        let mounts = "\
none / overlay rw,relatime 0 0
none /mnt/wsl tmpfs rw,relatime 0 0
proc /proc proc rw,nosuid 0 0
";
        assert!(!drive_is_mounted(mounts));
    }

    #[test]
    fn dockers_own_distributions_are_never_offered_as_somewhere_to_work() {
        let listed = "Ubuntu\ndocker-desktop\ndocker-desktop-data\ncoperativeai\n";
        assert_eq!(usable_distributions(listed), vec!["Ubuntu", "coperativeai"]);
    }

    /// What `wsl -l -q` really hands back: UTF-16, which read as UTF-8 is a
    /// working install that looks empty.
    #[test]
    fn the_utf16_a_distribution_list_arrives_as_is_read() {
        let utf16: Vec<u8> = "Ubuntu\r\ncoperativeai\r\n"
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect();
        let decoded = decode_wsl(&utf16);
        assert_eq!(usable_distributions(&decoded), vec!["Ubuntu", "coperativeai"]);
    }

    #[test]
    fn plain_output_is_left_alone() {
        assert_eq!(decode_wsl(b"Ubuntu\n").trim(), "Ubuntu");
    }

    /// **This machine's actual Docker error**, with the client installed and
    /// the engine stopped — the state the brief names as the one to get right.
    #[test]
    fn a_client_with_no_engine_is_not_a_working_docker() {
        let said = "error during connect: Get \"http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.51/version\": open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.";
        assert_eq!(server_version(said), None);
        assert_eq!(server_version("Cannot connect to the Docker daemon"), None);
        assert_eq!(server_version("  \n"), None);
    }

    #[test]
    fn a_running_engine_reports_its_version() {
        assert_eq!(server_version("27.3.1\n"), Some("27.3.1".into()));
    }

    /// **The running half, against the machine it is on.**
    ///
    /// Every test above reads captured output, which is what makes them run
    /// anywhere. None of them proves that the commands are spelled right, that
    /// the timeouts are survivable, or that WSL's UTF-16 arrives as expected —
    /// and those are the parts that fail silently, by reporting a working
    /// install as absent. Ignored by default because it needs the tools, and
    /// worth running by hand on any machine whose answer looks wrong.
    #[test]
    #[ignore = "asks the real WSL and Docker on this machine"]
    fn what_this_machine_really_says() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let found = wsl().await;
            println!("WSL: {found:#?}");
            let engine = docker().await;
            println!("Docker: {engine:#?}");

            // Whatever this machine has, the two things that must never be
            // confused are told apart: a tool that is absent, and one that is
            // there and unhappy.
            if engine.client_installed && engine.server_version.is_empty() {
                assert!(
                    !engine.detail.is_empty(),
                    "an installed Docker with no engine has to say so"
                );
            }
            if found.installed && found.answered {
                assert!(
                    !found.distributions.iter().any(|d| d.starts_with("docker-desktop")),
                    "Docker's own distributions are not somewhere to work"
                );
            }
        });
    }

    #[test]
    fn the_user_a_distribution_runs_as_is_read() {
        assert_eq!(is_root("0\n"), Some(true));
        assert_eq!(is_root("1000\n"), Some(false));
        assert_eq!(is_root("not a number"), None);
    }
}
