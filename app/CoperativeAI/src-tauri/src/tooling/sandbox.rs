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
pub fn wrap(mode: Mode, program: &str, args: &[String], cwd: &Path) -> Result<Spawn, String> {
    match mode {
        Mode::Off => Ok(Spawn {
            program: program.to_string(),
            args: args.to_vec(),
            cwd: cwd.to_path_buf(),
        }),
        Mode::Wsl | Mode::Docker => Err(format!(
            "the '{}' sandbox is not built yet, so nothing was run. Set where agents run \
             back to 'off' — running this outside the boundary you asked for is not \
             something this app will do quietly.",
            mode.id()
        )),
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
            State::AvailableNotBuilt,
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
            State::AvailableNotBuilt,
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
        built: false,
        summary: match (ready, found.detail.trim()) {
            (true, _) => {
                format!("'{OWN_DISTRIBUTION}' is here. Running work inside it is not built yet.")
            }
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
        let spawned = wrap(Mode::Off, "cmd", &args, Path::new("."))
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
        for mode in [Mode::Wsl, Mode::Docker] {
            let refused = wrap(mode, "cmd", &[], Path::new("."));
            let said = refused.expect_err("an unbuilt sandbox must not run the command");
            assert!(said.contains(mode.id()), "the refusal should name the mode: {said}");
        }
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
