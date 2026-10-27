//! Version control, and the two things that authenticate to it.
//!
//! `vcs` shells out to git for everything the app does with a repository —
//! status, history, commits, worktrees, merges. `github` talks to the remote
//! over HTTPS, and `ssh` manages the key that lets git talk to it instead.

pub mod github;
pub mod ssh;
pub mod vcs;
