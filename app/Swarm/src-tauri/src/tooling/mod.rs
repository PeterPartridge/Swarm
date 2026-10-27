//! Working out what command to run, and creating projects to run it in.
//!
//! The two runners share a shape on purpose: the platform cannot know every
//! toolchain, so each detects what it recognises, allows a per-Solution
//! override for what it does not, and never invents a command it cannot see.
//! `dev_runner` finds how to start and hot-refresh a Solution; `test_runner`
//! finds its test suites. `starter` and `scaffold` create new projects.
//! `sandbox` decides where any of it actually runs.
//!
//! **The sandbox modules live in the `cells` crate** (`app/Cells`) and are
//! re-exported here under the names they always had, so moving them changed
//! no caller.

pub use cells::{
    sandbox, sandbox_detect, sandbox_docker, sandbox_intune, sandbox_policy, sandbox_provision,
    sandbox_run,
};

pub mod dev_runner;
pub mod scaffold;
pub mod starter;
pub mod test_runner;

#[cfg(test)]
mod tests {
    use std::path::Path;

    /// **The test that stops a fourth caller slipping past the boundary.**
    ///
    /// A seam only bounds what goes through it, and nothing about Rust stops
    /// somebody adding a `Command::new` in a new file next month. So the source
    /// is read and every file that starts a process has to appear in one of the
    /// two lists below: sandboxed, or outside with a reason. A new one fails
    /// this test, and the failure asks for the decision rather than the
    /// obedience — which of the two it is.
    ///
    /// The sandbox's own spawning files moved to `cells` and are checked there,
    /// by `seam::tests`, with the same scanner.
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
            ("debug/adapters.rs", "the debugger stays on this machine, per the brief"),
            ("debug/live.rs", "the debugger stays on this machine, per the brief"),
            ("debug/session.rs", "the debugger stays on this machine, per the brief"),
            ("design/drawio.rs", "handing a file to whatever opens it here"),
            ("files/workspace.rs", "the app's own git plumbing"),
            ("git/ssh.rs", "the app's own ssh plumbing"),
            ("git/vcs.rs", "the app's own git plumbing"),
        ];

        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let found = cells::seam::spawners(&src);

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
}
