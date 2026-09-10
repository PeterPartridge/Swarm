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

#[cfg(test)]
mod tests {
    use super::*;

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
