//! Drawing things, and the design tool the pictures come from.
//!
//! `diagram` validates a document is really the notation it claims to be before
//! it is stored; `drawio` writes real `.drawio` files the desktop editor opens;
//! `figma` fetches frames so the AI can see what a screen is meant to look like.

pub mod diagram;
pub mod drawio;
pub mod figma;
