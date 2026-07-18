//! AI provider integration: OS-credential-store key handling and the
//! Claude Messages API client. Per the project security rules, key values
//! only ever move between the UI, the OS credential store, and the outbound
//! HTTPS request — never the database, config, code, or logs.

pub mod backend;
pub mod client;
pub mod keys;
pub mod ollama;
pub mod router;
pub mod tiering;
