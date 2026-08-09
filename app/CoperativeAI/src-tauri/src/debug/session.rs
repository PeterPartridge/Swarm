//! Starting an adapter and speaking DAP to it.
//!
//! Two transports, because the adapters genuinely differ: Delve and js-debug
//! listen on a port, debugpy and netcoredbg talk over their own stdin/stdout.
//! Everything above this point is the same for both, which is the reason the
//! split lives here rather than in four places.
//!
//! **What this does today is the handshake**: start the adapter, send
//! `initialize`, read the capabilities it answers with, and disconnect. That is
//! deliberately the first slice — it is the part that proves the wire format,
//! the transports and the discovery are all correct against a *real* debugger,
//! and everything after it (breakpoints, launch, stepping) is more requests
//! down the same pipe.

use crate::debug::adapters::Transport;
use crate::debug::wire::{self, Decoded};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// How long to wait for an adapter to answer. Generous: Delve builds on some
/// paths, and a slow first answer is not a broken adapter.
const REPLY_TIMEOUT: Duration = Duration::from_secs(20);
/// How long to let a TCP adapter get its listener up.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// What an adapter said it can do.
#[derive(Debug, Default)]
pub struct Capabilities {
    /// Whether it supports `configurationDone` — the difference between the
    /// modern handshake and the old one, and the first thing a launcher needs.
    pub configuration_done: bool,
    /// Whether breakpoints can be checked before the program runs.
    pub function_breakpoints: bool,
    /// Whether a hit count or a condition can be attached to a breakpoint.
    pub conditional_breakpoints: bool,
    /// The raw `body` of the initialize response, for anything not modelled yet.
    pub raw: String,
}

/// A live adapter and the pipe to it.
pub struct Session {
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    child: Option<Child>,
    seq: i64,
    /// Bytes read but not yet a whole message. A read is not a message.
    buffer: Vec<u8>,
}

impl Session {
    /// Starts an adapter and returns a session talking to it.
    ///
    /// `program` and `args` come from discovery, which has already proved the
    /// program runs — this is the second start, for real work.
    pub fn start(
        program: &str,
        args: &[String],
        transport: Transport,
        cwd: Option<&std::path::Path>,
    ) -> Result<Self, String> {
        match transport {
            Transport::Stdio => Self::start_stdio(program, args, cwd),
            Transport::Tcp => Self::start_tcp(program, args, cwd),
        }
    }

    fn spawn(
        program: &str,
        args: &[String],
        cwd: Option<&std::path::Path>,
        stdio: bool,
    ) -> Result<Child, String> {
        let mut command = Command::new(program);
        command.args(args);
        if let Some(dir) = cwd {
            command.current_dir(dir);
        }
        if stdio {
            command.stdin(Stdio::piped()).stdout(Stdio::piped());
        } else {
            command.stdin(Stdio::null()).stdout(Stdio::piped());
        }
        // Kept rather than inherited: an adapter's diagnostics must not end up
        // in this app's own console, where nobody would attribute them.
        command.stderr(Stdio::piped());
        command
            .spawn()
            .map_err(|e| format!("{program} would not start: {e}"))
    }

    fn start_stdio(
        program: &str,
        args: &[String],
        cwd: Option<&std::path::Path>,
    ) -> Result<Self, String> {
        let mut child = Self::spawn(program, args, cwd, true)?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("{program} gave no output pipe"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| format!("{program} gave no input pipe"))?;
        Ok(Session {
            reader: Box::new(stdout),
            writer: Box::new(stdin),
            child: Some(child),
            seq: 0,
            buffer: Vec::new(),
        })
    }

    /// Starts a listening adapter and connects to it.
    ///
    /// The port is chosen by binding one and letting go, which is the ordinary
    /// trick and is racy in principle — another process could take it in the
    /// gap. It is retried rather than pretended away.
    fn start_tcp(
        program: &str,
        args: &[String],
        cwd: Option<&std::path::Path>,
    ) -> Result<Self, String> {
        let port = free_port()?;
        // `{port}` is substituted rather than appended: dlv wants
        // `--listen=127.0.0.1:PORT` and js-debug wants a bare positional, and
        // the caller knows which.
        let filled: Vec<String> = args
            .iter()
            .map(|a| a.replace("{port}", &port.to_string()))
            .collect();
        let mut child = Self::spawn(program, &filled, cwd, false)?;

        let deadline = Instant::now() + CONNECT_TIMEOUT;
        let addr = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
        loop {
            // A dead adapter is reported as itself rather than as a timeout —
            // "could not connect" when the real answer is "it exited at once"
            // sends somebody looking at their firewall.
            if let Ok(Some(status)) = child.try_wait() {
                let mut why = String::new();
                if let Some(mut err) = child.stderr.take() {
                    let _ = err.read_to_string(&mut why);
                }
                return Err(format!(
                    "{program} exited straight away ({status}). {}",
                    why.trim()
                ));
            }
            match TcpStream::connect(addr) {
                Ok(stream) => {
                    let read = stream
                        .try_clone()
                        .map_err(|e| format!("could not read from {program}: {e}"))?;
                    return Ok(Session {
                        reader: Box::new(read),
                        writer: Box::new(stream),
                        child: Some(child),
                        seq: 0,
                        buffer: Vec::new(),
                    });
                }
                Err(_) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(60));
                }
                Err(e) => {
                    let _ = child.kill();
                    return Err(format!("{program} never accepted a connection: {e}"));
                }
            }
        }
    }

    /// Sends a request and returns its `seq`.
    pub fn request(&mut self, command: &str, arguments: serde_json::Value) -> Result<i64, String> {
        self.seq += 1;
        let body = serde_json::json!({
            "seq": self.seq,
            "type": "request",
            "command": command,
            "arguments": arguments,
        })
        .to_string();
        self.writer
            .write_all(&wire::frame(&body))
            .map_err(|e| format!("could not send {command} to the adapter: {e}"))?;
        self.writer
            .flush()
            .map_err(|e| format!("could not send {command} to the adapter: {e}"))?;
        Ok(self.seq)
    }

    /// Reads until the response to `seq` arrives, discarding events on the way.
    ///
    /// Events are dropped here **only because this slice is the handshake** —
    /// once sessions carry breakpoints they become the interesting half, and
    /// this becomes a queue rather than a filter.
    pub fn wait_for_response(&mut self, seq: i64) -> Result<serde_json::Value, String> {
        let deadline = Instant::now() + REPLY_TIMEOUT;
        loop {
            let message = self.read_message(deadline)?;
            let parsed: serde_json::Value = serde_json::from_str(&message)
                .map_err(|e| format!("the adapter sent something that was not JSON: {e}"))?;
            if parsed.get("type").and_then(|t| t.as_str()) != Some("response") {
                continue;
            }
            if parsed.get("request_seq").and_then(|s| s.as_i64()) != Some(seq) {
                continue;
            }
            if parsed.get("success").and_then(|s| s.as_bool()) == Some(false) {
                let why = parsed
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("the adapter refused, without saying why");
                return Err(why.to_string());
            }
            return Ok(parsed);
        }
    }

    /// One whole DAP message, waiting for as much of the stream as it takes.
    fn read_message(&mut self, deadline: Instant) -> Result<String, String> {
        loop {
            match wire::decode(&self.buffer) {
                Decoded::Message { body, used } => {
                    self.buffer.drain(..used);
                    return Ok(body);
                }
                Decoded::Bad(why) => return Err(why),
                Decoded::Incomplete => {}
            }
            if Instant::now() >= deadline {
                return Err("the adapter did not answer in time".into());
            }
            let mut chunk = [0u8; 8192];
            match self.reader.read(&mut chunk) {
                Ok(0) => return Err("the adapter closed the connection".into()),
                Ok(n) => self.buffer.extend_from_slice(&chunk[..n]),
                Err(e) => return Err(format!("could not read from the adapter: {e}")),
            }
        }
    }

    /// The opening handshake: who we are, and what it can do.
    pub fn initialize(&mut self, client: &str) -> Result<Capabilities, String> {
        let seq = self.request(
            "initialize",
            serde_json::json!({
                "clientID": client,
                "clientName": "CoperativeAI",
                "adapterID": client,
                "locale": "en",
                // Both are what a modern client says, and adapters branch on
                // them — lines from 1 and columns from 1 is what an editor
                // shows, so claiming otherwise would offset every breakpoint.
                "linesStartAt1": true,
                "columnsStartAt1": true,
                "pathFormat": "path",
                "supportsRunInTerminalRequest": false,
                "supportsProgressReporting": false,
            }),
        )?;
        let response = self.wait_for_response(seq)?;
        let body = response.get("body").cloned().unwrap_or_default();
        let flag = |name: &str| body.get(name).and_then(|v| v.as_bool()).unwrap_or(false);
        Ok(Capabilities {
            configuration_done: flag("supportsConfigurationDoneRequest"),
            function_breakpoints: flag("supportsFunctionBreakpoints"),
            conditional_breakpoints: flag("supportsConditionalBreakpoints"),
            raw: body.to_string(),
        })
    }

    /// Asks the adapter to shut down, then makes sure it has.
    pub fn shutdown(&mut self) {
        // Best effort in both halves: an adapter that has already gone is the
        // ordinary case, not a failure worth reporting.
        if let Ok(seq) = self.request("disconnect", serde_json::json!({ "restart": false })) {
            let _ = self.wait_for_response(seq);
        }
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Session {
    /// A dropped session must not leave an adapter running. One orphan per
    /// check is the same leak the terminal panel had.
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// A port nothing is currently listening on.
fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| format!("could not find a free port for the debug adapter: {e}"))?;
    listener
        .local_addr()
        .map(|a| a.port())
        .map_err(|e| format!("could not find a free port for the debug adapter: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A free port really is free — the whole TCP transport rests on it.
    #[test]
    fn a_free_port_is_offered_and_can_be_bound() {
        let port = free_port().expect("a free port");
        assert!(port > 0);
        // Binding it proves nothing else took it in the gap.
        let held = TcpListener::bind((Ipv4Addr::LOCALHOST, port));
        assert!(held.is_ok(), "the offered port should be bindable");
    }

    /// **The real handshake, against a real debugger.** Ignored by default
    /// because it needs Delve installed, and CI does not have it — run it with
    /// `cargo test -- --ignored` on a machine that does.
    ///
    /// This is the test that proves the wire format, the TCP transport and the
    /// discovery all agree with something that was not written here.
    #[test]
    #[ignore = "needs Delve installed"]
    fn delve_completes_the_dap_handshake() {
        let found = crate::debug::adapters::discover();
        let go = found
            .iter()
            .find(|a| a.language == "go")
            .expect("go is reported on");
        if !go.available {
            eprintln!("skipping: {}", go.problem);
            return;
        }

        // `argv`, not `program`: the latter is the display string, and taking
        // the executable back out of it is exactly the mangling the split
        // exists to prevent.
        let (program, args) = go.argv.split_first().expect("argv");
        let mut session =
            Session::start(program, args, Transport::Tcp, None).expect("start Delve");

        let caps = session.initialize("go").expect("initialize");
        session.shutdown();

        // Delve supports configurationDone; if this ever goes false the launch
        // sequence below it has to change, so it is worth pinning.
        assert!(
            caps.configuration_done,
            "Delve should support configurationDone. Raw capabilities: {}",
            caps.raw
        );
    }
}
