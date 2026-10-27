//! Cells — where a command an app runs on somebody's behalf actually runs.
//!
//! A bolt-on: everything that decides, detects, sets up and reports a sandbox,
//! moved out of Swarm so it is one piece with one boundary. Swarm re-exports
//! these modules under `tooling::`, so its callers did not change when they
//! moved. `sandbox` is the seam itself and the place to start reading.
//!
//! **What does not live here** is anything that needs the host app: its
//! database, its settings, its Tauri commands. Those read the setting and pass
//! it in, which is what `sandbox` already asked of its callers.

pub mod sandbox;
pub mod sandbox_detect;
pub mod sandbox_docker;
pub mod sandbox_intune;
pub mod sandbox_policy;
pub mod sandbox_provision;
pub mod sandbox_run;
pub mod seam;
pub mod which;
