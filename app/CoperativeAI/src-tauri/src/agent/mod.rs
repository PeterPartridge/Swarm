//! Handing work to an AI agent, queueing it, and judging what came back.
//!
//! `handover` assembles the brief an agent starts from; `jobs` is the queue that
//! lets several work items be submitted without waiting for each other; `review`
//! checks a finished change against the developer rules it was given.

pub mod handover;
pub mod jobs;
pub mod review;
