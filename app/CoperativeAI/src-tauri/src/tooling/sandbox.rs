//! Where a command the app runs on somebody's behalf actually runs.
//!
//! **The one seam.** An agent told not to ask can run anything the shell can,
//! and the shell is the developer's own machine: their keys, their
//! repositories, their whole drive. This is the single place that decides
//! where such a command runs instead — on this machine, in a Linux
//! distribution the app owns, or in a container. Everything the app starts on
//! somebody's behalf goes through here, and `the_only_way_out_is_through_here`
//! below is the test that keeps it that way.
//!
//! **It decides, it does not spawn.** `wrap` answers "what should actually be
//! run, and where" and hands that back; the caller spawns it the way it always
//! did — a PTY for the terminal, a piped child for the runners. That keeps this
//! module pure, testable without a database or a process anywhere near it, and
//! leaves each caller's own hard-won handling (ConPTY, stderr merging, the
//! shell that survives a `.cmd` shim) exactly where it was.
//!
//! **The mode is passed in, not read here.** The three callers are synchronous
//! and hold no database handle; the command layer above them does. Reading the
//! setting there and passing it down is what lets this be a pure function, and
//! what stops a boundary from depending on a global read once at startup that a
//! person would have to restart the app to change.

use std::path::{Path, PathBuf};

/// The three places a command can run, and how each is described where it is
/// chosen.
///
/// Listed in increasing order of both protection and prerequisites, because
/// that is what they are — Docker Desktop runs its containers inside WSL, so
/// these are rungs of one ladder rather than three alternatives. The wording
/// promises nothing: what any of them actually enforces on a given machine is
/// detection's job to establish and say, never this list's to imply.
pub const SANDBOXES: &[(&str, &str)] = &[
    ("off", "This machine — the same permissions you have"),
    ("wsl", "A Linux distribution this app creates and owns"),
    ("docker", "A container of its own for each run"),
];

/// Which of the three is in force.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Off,
    Wsl,
    Docker,
}

impl Mode {
    /// Reads the stored setting.
    ///
    /// **Anything unrecognised is `Off`, and that is not the timid choice — it
    /// is the honest one.** `Off` is the *least* protected of the three, so
    /// falling back to it looks backwards until you ask what the alternative
    /// would say: a fallback to `Docker` would have the app report a boundary
    /// that nobody configured and nothing checked. Landing on `Off` means the
    /// app goes on to say, correctly, that there is no boundary here.
    pub fn from_setting(name: &str) -> Self {
        match name.trim() {
            "wsl" => Mode::Wsl,
            "docker" => Mode::Docker,
            _ => Mode::Off,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Mode::Off => "off",
            Mode::Wsl => "wsl",
            Mode::Docker => "docker",
        }
    }
}

/// A command, as it will actually be spawned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spawn {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
}

/// Where a command is to run.
///
/// **A struct rather than a fifth argument**, which is what the first round's
/// debt entry said would be needed as soon as the seam had to know more than
/// the mode. It knows two things: which boundary, and — for a sandboxed one —
/// where inside it. Off carries no inside, and uses the folder it was given.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Place {
    pub mode: Mode,
    /// The working directory as the *inside* sees it, e.g. `/work/runs/12`.
    /// Empty for `Off`, and empty is refused for anything else — a sandboxed
    /// command with nowhere to be is a bug, not a default.
    pub inside: String,
}

impl Default for Mode {
    fn default() -> Self {
        Mode::Off
    }
}

impl Place {
    /// On this machine, as everything did before any of this existed.
    pub fn here() -> Self {
        Place { mode: Mode::Off, inside: String::new() }
    }
}

/// Where a repository is mounted inside the distribution.
///
/// One mount per repository, named after it so somebody looking around inside
/// can tell what they are looking at, with a short digest of the full path so
/// two repositories of the same name cannot land on top of each other.
pub fn mount_point(repo_root: &Path) -> String {
    format!("/mnt/repos/{}", place_slug(repo_root))
}

/// Where one run's own clone lives inside the distribution.
///
/// **Its own clone, not the host's checkout.** A worktree's `.git` is a file
/// holding an *absolute* path, so a checkout made on Windows cannot be used
/// from inside at any mount point — git simply cannot find its repository. A
/// clone made inside has its own consistent git, and lives on the Linux
/// filesystem, which is also far faster than reaching back across a mount for
/// every file a build touches.
pub fn clone_dir(run_id: i64) -> String {
    format!("/work/runs/{run_id}")
}

/// A short, stable name for a Windows path.
///
/// The digest is written out here rather than taken from `DefaultHasher`,
/// whose value is explicitly not stable between Rust releases — a mount that
/// moved when the toolchain was upgraded would be a hard afternoon.
fn place_slug(path: &Path) -> String {
    let full = path.to_string_lossy().to_lowercase().replace('\\', "/");
    let mut digest: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in full.as_bytes() {
        digest ^= u64::from(*byte);
        digest = digest.wrapping_mul(0x0000_0100_0000_01b3);
    }
    let name: String = path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    format!("{}-{:08x}", name.trim_matches('-'), digest as u32)
}

/// How Windows reaches back into the distribution.
///
/// **The reason a finding from a sandboxed run can still be opened.** A run's
/// files live on the Linux filesystem and have no drive letter, so a path out
/// of a test runner names a file this side cannot see — unless it is spelled
/// the way Windows can reach it, which is this.
pub fn windows_view(inside: &str) -> String {
    format!(
        "\\\\wsl.localhost\\{}{}",
        crate::tooling::sandbox_detect::OWN_DISTRIBUTION,
        inside.replace('/', "\\")
    )
}

/// Rewrites the paths in a runner's output so they can be opened here.
///
/// **Done once, at the seam.** Six parsers read this output for `file:line`,
/// and translating inside each of them would be six chances to forget — the
/// one that forgot would produce findings that silently will not open.
pub fn from_sandbox_text(text: &str, inside_root: &str) -> String {
    if inside_root.is_empty() || !text.contains(inside_root) {
        return text.to_string();
    }
    let here = windows_view(inside_root);
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(inside_root) {
        out.push_str(&rest[..at]);
        out.push_str(&here);
        rest = &rest[at + inside_root.len()..];
        // **The rest of the path has to turn round too.** Rewriting only the
        // root leaves `\\wsl.localhost\…\runs\12/src/lib.rs`, which is a path
        // half in each world and opens in neither reliably. The run of
        // non-space after the root is the file, so it converts with it.
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        out.push_str(&rest[..end].replace('/', "\\"));
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

/// What to run, and where, for the mode in force.
///
/// `Off` hands back exactly what it was given. That is worth stating as the
/// contract rather than leaving it as an implementation detail: it is what
/// makes adopting this seam a change that alters nothing until somebody
/// deliberately chooses otherwise.
///
/// The other two modes are not built yet and say so. **Saying so is the point**
/// — a mode that quietly ran the command unsandboxed would be the exact failure
/// this whole feature exists to prevent, and it would be invisible.
pub fn wrap(place: &Place, program: &str, args: &[String], cwd: &Path) -> Result<Spawn, String> {
    match place.mode {
        Mode::Off => Ok(Spawn {
            program: program.to_string(),
            args: args.to_vec(),
            cwd: cwd.to_path_buf(),
        }),
        Mode::Wsl => {
            if place.inside.trim().is_empty() {
                return Err(
                    "nothing was run: the sandbox was asked for without saying where inside it \
                     to run. That is a fault in this app rather than in the set-up."
                        .into(),
                );
            }
            let mut inner = vec![
                "-d".to_string(),
                crate::tooling::sandbox_detect::OWN_DISTRIBUTION.to_string(),
                "--user".to_string(),
                crate::tooling::sandbox_provision::AGENT_USER.to_string(),
                "--cd".to_string(),
                place.inside.clone(),
                "--".to_string(),
                program.to_string(),
            ];
            inner.extend(args.iter().cloned());
            Ok(Spawn {
                program: "wsl.exe".to_string(),
                args: inner,
                // The outer process still needs somewhere real to start from on
                // this side; what it does happens inside.
                cwd: cwd.to_path_buf(),
            })
        }
        Mode::Docker => Err(
            "the 'docker' sandbox is not built yet, so nothing was run. Set where agents run \
             back to something that is — running this outside the boundary you asked for is \
             not something this app will do quietly."
                .into(),
        ),
    }
}

/// The five things a boundary can do, named once so the three places that talk
/// about them cannot drift apart.
pub const PROTECTIONS: &[&str] = &[
    "A boundary from this machine's files",
    "One run cannot reach another",
    "Reduced privileges",
    "Limits on what a run can use",
    "Control over what it can reach",
];

/// Whether one protection is actually doing anything.
///
/// **Three states, not two, and the middle one is the honest part.** A machine
/// that could run containers is not a machine that is running one, and this app
/// does not yet run either sandbox. A green tick against a mode that refuses
/// every command would be exactly the claim this whole page exists to prevent —
/// so "the machine could, the app cannot yet" gets said in those words.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum State {
    /// In force, now, for anything run in this mode.
    ///
    /// **Nothing constructs this yet, and the compiler is right to say so.**
    /// Neither sandbox runs anything, so nothing is in force — which is the
    /// state of the world this round reports rather than a gap in it. The
    /// variant exists so the shape the panel reads is complete before the
    /// backend that earns it lands.
    #[allow(dead_code)]
    Enforced,
    /// This machine could do it; this app does not do it yet.
    AvailableNotBuilt,
    /// Not here — `detail` says what was found instead.
    Unavailable,
}

/// One protection, as it really stands for one mode.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Protection {
    pub name: String,
    pub state: State,
    /// Why, in the app's own words. Never empty: a cell with no explanation is
    /// a verdict somebody has to guess at.
    pub detail: String,
}

/// One mode's column.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeReport {
    pub id: String,
    pub label: String,
    /// Whether this mode runs anything at all yet. A column whose header does
    /// not say this cannot be read safely.
    pub built: bool,
    pub summary: String,
    /// Whether this app could build the boundary this mode needs, here, now.
    /// Separate from `built`: one is about the machine, the other about the app.
    /// Whether this mode can be chosen here, now. **Not the same as built**:
    /// a mode that runs but has nothing set up would stop the terminal working,
    /// so offering it would be offering a way to break the app.
    pub can_choose: bool,
    /// Why it cannot be chosen, when it cannot. Never empty.
    pub choose_detail: String,
    pub can_set_up: bool,
    /// What setting it up would do, or why it cannot be done. Never empty — an
    /// unexplained disabled button is worse than no button.
    pub set_up_detail: String,
    pub protections: Vec<Protection>,
}

/// What this machine can offer, mode by mode.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub modes: Vec<ModeReport>,
    /// Which mode is chosen, so the table can mark it.
    pub chosen: String,
}

fn protection(name: &str, state: State, detail: &str) -> Protection {
    Protection { name: name.into(), state, detail: detail.into() }
}

/// Builds the table from what detection found.
///
/// Pure, so the rule that matters most — *nothing is ever `Enforced` for a mode
/// that is not built* — is a test rather than a hope.
pub fn report(
    chosen: &str,
    wsl: &crate::tooling::sandbox_detect::WslFindings,
    docker: &crate::tooling::sandbox_detect::DockerFindings,
) -> Report {
    Report {
        chosen: Mode::from_setting(chosen).id().to_string(),
        modes: vec![off_column(), wsl_column(wsl), docker_column(docker)],
    }
}

/// Off is not a failure to be sandboxed — it is the machine you are on, said
/// plainly. Every row is `Unavailable`, and that is the truth rather than a
/// complaint.
fn off_column() -> ModeReport {
    let here = "Nothing is bounded — this is your machine, with your permissions.";
    ModeReport {
        id: "off".into(),
        label: SANDBOXES[0].1.into(),
        built: true,
        summary: "Runs here, exactly as it always has.".into(),
        // Nothing to build: this is the machine you are already on.
        can_choose: true,
        choose_detail: "Always available — it is where everything ran before any of this.".into(),
        can_set_up: false,
        set_up_detail: "There is nothing to set up — this is your machine.".into(),
        protections: PROTECTIONS
            .iter()
            .map(|name| protection(name, State::Unavailable, here))
            .collect(),
    }
}

fn wsl_column(found: &crate::tooling::sandbox_detect::WslFindings) -> ModeReport {
    use crate::tooling::sandbox_detect::OWN_DISTRIBUTION;

    // Everything below hangs off this: without the app's own distribution,
    // configured by the app, WSL mode has nothing it can promise.
    let ready = found.answered && found.own_distribution;
    let set_up = crate::tooling::sandbox_provision::plan_wsl(found);
    let unmounted = found.drive_mounted == Some(false);

    let boundary = if !ready {
        protection(
            PROTECTIONS[0],
            State::Unavailable,
            if found.detail.is_empty() { "WSL was not usable here." } else { &found.detail },
        )
    } else if unmounted {
        protection(
            PROTECTIONS[0],
            State::Enforced,
            &format!("'{OWN_DISTRIBUTION}' does not mount this machine's drive."),
        )
    } else {
        protection(
            PROTECTIONS[0],
            State::Unavailable,
            &format!(
                "'{OWN_DISTRIBUTION}' still has this machine's drive mounted, so an agent \
                 inside it could write anywhere on this computer."
            ),
        )
    };

    let privileges = match (ready, found.root) {
        (true, Some(false)) => protection(
            PROTECTIONS[2],
            State::Enforced,
            "It runs as an ordinary user, not root.",
        ),
        (true, Some(true)) => {
            protection(PROTECTIONS[2], State::Unavailable, "It runs as root.")
        }
        _ => protection(PROTECTIONS[2], State::Unavailable, "Nothing to look inside yet."),
    };

    ModeReport {
        id: "wsl".into(),
        label: SANDBOXES[1].1.into(),
        // **Built, as of the round that made it run.** Which is why the rows
        // below may now say a protection is in force — but only where
        // detection proved it, never because the mode exists.
        built: true,
        can_choose: ready && unmounted,
        choose_detail: if ready && unmounted {
            "Ready — runs will happen inside it.".to_string()
        } else {
            "Set it up first: choosing it before there is a boundary would stop the terminal \n             working, with nothing gained."
                .to_string()
        },
        can_set_up: set_up.is_ok(),
        set_up_detail: match &set_up {
            Ok(steps) => format!(
                "{} step{} — it downloads a distribution and installs into it, so it takes 
                 a while and prints everything it does.",
                steps.len(),
                if steps.len() == 1 { "" } else { "s" }
            ),
            Err(why) => why.clone(),
        },
        summary: match (ready, found.detail.trim()) {
            (true, _) => format!(
                "'{OWN_DISTRIBUTION}' is here, and runs happen inside it — each in a clone of \n                 its own, because a checkout made out here cannot be used in there."
            ),
            // Never left blank. A column with no summary is one whose verdict
            // has to be inferred from the rows, which is how a table stops
            // being read at all.
            (false, "") => "WSL was not usable on this machine.".to_string(),
            (false, said) => said.to_string(),
        },
        protections: vec![
            boundary,
            // Not a detection failure — a fact about WSL. One distribution is
            // shared by everything in it, so two runs are neighbours.
            protection(
                PROTECTIONS[1],
                State::Unavailable,
                "One distribution is shared, so runs in it are not kept apart.",
            ),
            privileges,
            protection(
                PROTECTIONS[3],
                State::Unavailable,
                "WSL's limits cover the whole virtual machine, never one run.",
            ),
            protection(
                PROTECTIONS[4],
                State::Unavailable,
                "A distribution reaches the network exactly as this machine does.",
            ),
        ],
    }
}

fn docker_column(found: &crate::tooling::sandbox_detect::DockerFindings) -> ModeReport {
    let running = !found.server_version.is_empty();
    let buildable = crate::tooling::sandbox_provision::plan_docker(found);
    let each = [
        "A container sees only what is mounted into it.",
        "One container per run, and containers do not share a filesystem.",
        "Capabilities dropped, and no new ones can be gained.",
        "Processor, memory and process limits apply per container.",
        "A container's network can be switched off entirely.",
    ];

    ModeReport {
        id: "docker".into(),
        label: SANDBOXES[2].1.into(),
        built: false,
        can_choose: false,
        choose_detail: "Not built yet — it would refuse every command rather than run one \n             outside the boundary you asked for."
            .to_string(),
        can_set_up: buildable.is_ok(),
        set_up_detail: match &buildable {
            Ok(()) => "Builds the agent's image — git, Node and Claude Code, and nothing of 
                 any Solution's own toolchain."
                .to_string(),
            Err(why) => why.clone(),
        },
        summary: match (running, found.detail.trim()) {
            (true, _) => format!(
                "Docker {} is running. Running work inside it is not built yet.",
                found.server_version
            ),
            (false, "") => "No Docker engine answered on this machine.".to_string(),
            (false, said) => said.to_string(),
        },
        protections: PROTECTIONS
            .iter()
            .zip(each)
            .map(|(name, detail)| {
                if running {
                    protection(name, State::AvailableNotBuilt, detail)
                } else {
                    protection(
                        name,
                        State::Unavailable,
                        if found.detail.is_empty() {
                            "No Docker engine answered."
                        } else {
                            &found.detail
                        },
                    )
                }
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tooling::sandbox_detect::{DockerFindings, WslFindings, OWN_DISTRIBUTION};

    fn ready_wsl() -> WslFindings {
        WslFindings {
            installed: true,
            answered: true,
            version: "2.7.13.0".into(),
            can_own_distribution: true,
            distributions: vec![OWN_DISTRIBUTION.to_string()],
            own_distribution: true,
            drive_mounted: Some(false),
            root: Some(false),
            detail: String::new(),
        }
    }

    /// **The rule the whole page exists for.** Neither sandbox runs anything
    /// yet, so no cell in either column may say a protection is in force —
    /// however good the machine looks.
    #[test]
    fn nothing_is_ever_claimed_as_in_force_for_a_mode_that_is_not_built() {
        let docker = DockerFindings {
            server_version: "27.3.1".into(),
            client_installed: true,
            agent_image: true,
            detail: String::new(),
        };
        let built = report("off", &ready_wsl(), &docker);
        for mode in &built.modes {
            if mode.built {
                continue;
            }
            for row in &mode.protections {
                assert_ne!(
                    row.state,
                    State::Enforced,
                    "{} claims '{}' is in force, and it runs nothing",
                    mode.id,
                    row.name
                );
            }
        }
    }

    /// A machine that is ready still says so — otherwise there is no way to
    /// tell "your machine cannot" from "this app cannot yet", which are very
    /// different problems to have.
    #[test]
    fn a_ready_machine_is_told_apart_from_an_unready_one() {
        let docker = DockerFindings {
            server_version: "27.3.1".into(),
            client_installed: true,
            ..Default::default()
        };
        let ready = report("off", &ready_wsl(), &docker);
        let docker_column = ready.modes.iter().find(|m| m.id == "docker").unwrap();
        assert!(docker_column
            .protections
            .iter()
            .all(|p| p.state == State::AvailableNotBuilt));

        let stopped = report("off", &WslFindings::default(), &DockerFindings {
            client_installed: true,
            detail: "Docker is installed, but its engine is not running".into(),
            ..Default::default()
        });
        let stopped_column = stopped.modes.iter().find(|m| m.id == "docker").unwrap();
        assert!(stopped_column
            .protections
            .iter()
            .all(|p| p.state == State::Unavailable));
        assert!(stopped_column.summary.contains("not running"));
    }

    /// The headline: a distribution that still mounts the drive gets no
    /// boundary row, however well everything else about it reads.
    #[test]
    fn a_distribution_that_still_mounts_the_drive_is_given_no_boundary() {
        let mut found = ready_wsl();
        found.drive_mounted = Some(true);
        let table = report("wsl", &found, &DockerFindings::default());
        let wsl = table.modes.iter().find(|m| m.id == "wsl").unwrap();
        assert_eq!(wsl.protections[0].state, State::Unavailable);
        assert!(
            wsl.protections[0].detail.contains("anywhere on this computer"),
            "the cell has to say what it means: {}",
            wsl.protections[0].detail
        );
    }

    /// **In force is earned, not granted by existing.** WSL runs things now, so
    /// its rows may say a protection is on — but only where detection proved
    /// it. A distribution that still mounts the drive gets nothing, and neither
    /// can it be chosen.
    #[test]
    fn a_built_mode_still_only_claims_what_was_proved() {
        let mut mounted = ready_wsl();
        mounted.drive_mounted = Some(true);
        let table = report("off", &mounted, &DockerFindings::default());
        let wsl = table.modes.iter().find(|m| m.id == "wsl").expect("a wsl column");
        assert!(wsl.built, "it runs things now");
        assert_ne!(wsl.protections[0].state, State::Enforced);
        assert!(!wsl.can_choose, "choosing it would stop the terminal working for nothing");

        let table = report("off", &ready_wsl(), &DockerFindings::default());
        let wsl = table.modes.iter().find(|m| m.id == "wsl").expect("a wsl column");
        assert_eq!(wsl.protections[0].state, State::Enforced, "the drive really is unreachable");
        assert!(wsl.can_choose);
        // The three WSL cannot do stay honest however well the rest reads.
        assert_eq!(wsl.protections[1].state, State::Unavailable, "runs share one distribution");
        assert_eq!(wsl.protections[3].state, State::Unavailable);
        assert_eq!(wsl.protections[4].state, State::Unavailable);
    }

    /// Off is the machine you are on, stated rather than apologised for.
    #[test]
    fn off_says_plainly_that_nothing_is_bounded() {
        let table = report("off", &WslFindings::default(), &DockerFindings::default());
        let off = table.modes.iter().find(|m| m.id == "off").unwrap();
        assert!(off.built);
        assert!(off.protections.iter().all(|p| p.state == State::Unavailable));
        assert_eq!(off.protections.len(), PROTECTIONS.len());
    }

    /// Every cell explains itself. An unexplained verdict is one somebody has
    /// to guess at, and guessing about a boundary is the failure this prevents.
    #[test]
    fn no_cell_is_left_without_a_reason() {
        let table = report("off", &WslFindings::default(), &DockerFindings::default());
        for mode in &table.modes {
            assert!(!mode.summary.trim().is_empty(), "{} has no summary", mode.id);
            for row in &mode.protections {
                assert!(!row.detail.trim().is_empty(), "{} / {} has no reason", mode.id, row.name);
            }
        }
    }

    #[test]
    fn every_mode_answers_for_every_protection() {
        let table = report("docker", &ready_wsl(), &DockerFindings::default());
        assert_eq!(table.modes.len(), SANDBOXES.len());
        assert_eq!(table.chosen, "docker");
        for mode in &table.modes {
            assert_eq!(mode.protections.len(), PROTECTIONS.len(), "{}", mode.id);
        }
    }

    #[test]
    fn off_hands_back_exactly_what_it_was_given() {
        let args = vec!["/C".to_string(), "npm test".to_string()];
        let spawned = wrap(&Place::here(), "cmd", &args, Path::new("."))
            .expect("off never fails — it is what the app already does");
        assert_eq!(spawned.program, "cmd");
        assert_eq!(spawned.args, args);
        assert_eq!(spawned.cwd, PathBuf::from("."));
    }

    /// The two unbuilt modes refuse rather than run outside the boundary that
    /// was asked for. A later round makes them work; until then the failure is
    /// loud on purpose.
    #[test]
    fn a_mode_that_is_not_built_refuses_instead_of_running_unprotected() {
        let place = Place { mode: Mode::Docker, inside: "/work".into() };
        let said = wrap(&place, "cmd", &[], Path::new("."))
            .expect_err("an unbuilt sandbox must not run the command");
        assert!(said.contains("docker"), "the refusal should name the mode: {said}");
    }

    /// **A sandboxed command with nowhere to be is a bug, not a default.**
    /// Running it here anyway would be the one failure this whole feature
    /// exists to prevent, so it refuses instead.
    #[test]
    fn a_sandbox_asked_for_without_a_place_inside_refuses() {
        let nowhere = Place { mode: Mode::Wsl, inside: String::new() };
        assert!(wrap(&nowhere, "cmd", &[], Path::new(".")).is_err());
    }

    /// The command that actually reaches WSL: the app's own distribution, the
    /// agent's user, and the folder inside — never this machine's.
    #[test]
    fn a_wsl_command_names_the_distribution_the_user_and_the_place_inside() {
        let place = Place { mode: Mode::Wsl, inside: "/work/runs/12".into() };
        let spawned = wrap(&place, "npm", &["test".to_string()], Path::new("C:\\repo"))
            .expect("a place inside was given");

        assert_eq!(spawned.program, "wsl.exe");
        assert_eq!(
            spawned.args,
            vec![
                "-d",
                crate::tooling::sandbox_detect::OWN_DISTRIBUTION,
                "--user",
                crate::tooling::sandbox_provision::AGENT_USER,
                "--cd",
                "/work/runs/12",
                "--",
                "npm",
                "test",
            ]
        );
    }

    /// **A finding from inside has to be openable from out here.** The run's
    /// files live on the Linux filesystem and have no drive letter, so a path
    /// out of a test runner names a file this side cannot see — unless it is
    /// spelled the way Windows can reach it.
    #[test]
    fn a_path_out_of_the_sandbox_can_be_opened_on_this_machine() {
        let said = "FAILED /work/runs/12/src/lib.rs:42 — assertion failed";
        let here = from_sandbox_text(said, "/work/runs/12");
        assert!(
            here.contains("\\\\wsl.localhost\\coperativeai\\work\\runs\\12\\src\\lib.rs:42"),
            "got: {here}"
        );
    }

    /// Off is untouched: no translation, not even a copy that differs.
    #[test]
    fn output_from_this_machine_is_left_exactly_as_it_was() {
        let said = "FAILED C:\\repo\\src\\lib.rs:42";
        assert_eq!(from_sandbox_text(said, ""), said);
    }

    #[test]
    fn an_unknown_setting_reads_as_no_boundary_rather_than_an_imagined_one() {
        for stored in ["", "  ", "nonsense", "Docker "] {
            assert_eq!(Mode::from_setting(stored), Mode::Off, "stored: {stored:?}");
        }
        assert_eq!(Mode::from_setting("wsl"), Mode::Wsl);
        assert_eq!(Mode::from_setting("docker"), Mode::Docker);
        assert_eq!(Mode::from_setting(" docker "), Mode::Docker);
    }

    #[test]
    fn every_offered_sandbox_is_one_the_code_knows() {
        for (id, label) in SANDBOXES {
            assert_eq!(Mode::from_setting(id).id(), *id, "offered but unknown: {id}");
            assert!(!label.trim().is_empty(), "{id} has no description");
        }
        assert_eq!(SANDBOXES.len(), 3);
    }

    /// **The test that stops a fourth caller slipping past the boundary.**
    ///
    /// A seam only bounds what goes through it, and nothing about Rust stops
    /// somebody adding a `Command::new` in a new file next month. So the source
    /// is read and every file that starts a process has to appear in one of the
    /// two lists below: sandboxed, or outside with a reason. A new one fails
    /// this test, and the failure asks for the decision rather than the
    /// obedience — which of the two it is.
    ///
    /// Comment lines are skipped: two modules explain the Windows `.cmd` shim
    /// problem by quoting `Command::new` in prose, and prose starts no process.
    #[test]
    fn the_only_way_out_is_through_here() {
        /// Commands run on somebody's behalf. These go through `wrap`.
        const SANDBOXED: &[&str] = &[
            "terminal/mod.rs",
            "tooling/starter.rs",
            "tooling/test_runner.rs",
        ];
        /// Deliberately outside, and why. Each of these is the app working on
        /// its own account rather than running somebody's command.
        const OUTSIDE: &[(&str, &str)] = &[
            ("ai/claude_code.rs", "the app asking its own provider a question"),
            ("tooling/sandbox_detect.rs", "asking this machine what it has"),
            ("commands/my_spaces.rs", "the app's own git plumbing"),
            ("commands/runs.rs", "the app's own git plumbing"),
            ("debug/adapters.rs", "the debugger stays on this machine, per the brief"),
            ("debug/live.rs", "the debugger stays on this machine, per the brief"),
            ("debug/session.rs", "the debugger stays on this machine, per the brief"),
            ("design/drawio.rs", "handing a file to whatever opens it here"),
            ("files/workspace.rs", "the app's own git plumbing"),
            ("git/ssh.rs", "the app's own ssh plumbing"),
            ("git/vcs.rs", "the app's own git plumbing"),
        ];

        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut found: Vec<String> = Vec::new();
        collect_spawners(&src, &src, &mut found);
        found.sort();

        let mut known: Vec<String> = SANDBOXED.iter().map(|f| (*f).to_string()).collect();
        known.extend(OUTSIDE.iter().map(|(f, _)| (*f).to_string()));
        known.sort();

        // A file in SANDBOXED that never reaches `wrap` is a list telling
        // itself a story, so the claim is checked rather than trusted.
        for file in SANDBOXED {
            let text = std::fs::read_to_string(src.join(file)).expect("a listed file exists");
            assert!(
                text.contains("sandbox::wrap("),
                "{file} is listed as sandboxed but never goes through the seam"
            );
        }

        let unlisted: Vec<&String> = found.iter().filter(|f| !known.contains(f)).collect();
        assert!(
            unlisted.is_empty(),
            "these start a process and are in neither list: {unlisted:?}. Decide which they \
             are — a command run on somebody's behalf goes through sandbox::wrap and joins \
             SANDBOXED; the app working on its own account joins OUTSIDE with the reason."
        );

        let gone: Vec<&String> = known.iter().filter(|f| !found.contains(f)).collect();
        assert!(
            gone.is_empty(),
            "listed here but no longer starting a process: {gone:?}. Drop them from the list \
             so it keeps meaning something."
        );
    }

    /// Every `.rs` file under `dir` with a line that starts a process, named
    /// relative to `src` with forward slashes so the lists read the same on
    /// both platforms.
    fn collect_spawners(dir: &Path, src: &Path, found: &mut Vec<String>) {
        let entries = std::fs::read_dir(dir).expect("the source tree is readable");
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_spawners(&path, src, found);
            } else if path.extension().is_some_and(|e| e == "rs") {
                // This file names those tokens rather than using them, and by
                // design it never spawns anything — it decides and hands back.
                if path.file_name().is_some_and(|n| n == "sandbox.rs") {
                    continue;
                }
                let text = std::fs::read_to_string(&path).unwrap_or_default();
                let spawns = text.lines().any(|line| {
                    let line = line.trim_start();
                    !line.starts_with("//")
                        && (line.contains("Command::new(") || line.contains("CommandBuilder::new("))
                });
                if spawns {
                    let rel = path.strip_prefix(src).unwrap_or(&path);
                    found.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
}
