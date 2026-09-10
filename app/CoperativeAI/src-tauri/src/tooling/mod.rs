//! Working out what command to run, and creating projects to run it in.
//!
//! The two runners share a shape on purpose: the platform cannot know every
//! toolchain, so each detects what it recognises, allows a per-Solution
//! override for what it does not, and never invents a command it cannot see.
//! `dev_runner` finds how to start and hot-refresh a Solution; `test_runner`
//! finds its test suites. `starter` and `scaffold` create new projects.
//! `sandbox` decides where any of it actually runs.

pub mod dev_runner;
pub mod sandbox;
pub mod sandbox_detect;
pub mod sandbox_docker;
pub mod sandbox_provision;
pub mod sandbox_run;
pub mod scaffold;
pub mod starter;
pub mod test_runner;
