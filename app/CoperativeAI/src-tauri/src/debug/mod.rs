//! Debugging, over the Debug Adapter Protocol.
//!
//! The app does not implement a debugger; it speaks to one. DAP is the protocol
//! VS Code defined and every serious debugger now has an adapter for, which is
//! what makes four languages tractable at all — the alternative was four
//! bespoke integrations and no chance of a fifth.
//!
//! - [`wire`] — the envelope. Framing and de-framing, and nothing else.
//! - [`adapters`] — which adapters this machine actually has, found by running
//!   them rather than by believing PATH.
//! - [`session`] — starting one and speaking to it, over stdio or TCP.
//! - [`live`] — a session that is running: breakpoints, stepping, and the
//!   events an adapter sends without being asked.
//!
//! **Nothing here is a debugger of our own.** Where an adapter is missing the
//! app says so and how to install it, rather than degrading to a control that
//! looks like it works. A breakpoint that silently does nothing costs more than
//! no breakpoint at all.

use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};

/// Both loopback addresses, because adapters do not agree on one.
///
/// Delve is told `--listen=127.0.0.1:PORT` and binds IPv4. **js-debug binds
/// `::1` and nothing else**, so connecting to 127.0.0.1 gets "actively refused"
/// — which reads exactly like an adapter that failed to start, and cost a
/// confusing failure before it was pinned down. Trying both is the only thing
/// that works for every adapter without special-casing each one.
fn loopbacks(port: u16) -> [SocketAddr; 2] {
    [
        SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        SocketAddr::from((Ipv6Addr::LOCALHOST, port)),
    ]
}

pub mod adapters;
pub mod dotnet;
pub mod live;
pub mod session;
pub mod wire;
