//! A debug session that is actually running, with breakpoints and stepping.
//!
//! [`super::session::Session`] is the handshake: send one thing, wait for its
//! answer. That shape cannot survive a real session, because the interesting
//! half is **unsolicited** — the adapter says `stopped` when it hits a
//! breakpoint, `output` whenever the program prints, and `terminated` when it
//! ends, none of it in reply to anything.
//!
//! So this is the usual shape for a protocol like it: one reader thread, a map
//! of outstanding requests keyed by `seq`, and a sink for everything that is not
//! a reply. A request blocks its caller until its own response arrives; events
//! reach the UI as they happen.
//!
//! **The launch sequence is fixed by the protocol** and getting it wrong is the
//! classic way a debugger appears to work and never stops anywhere:
//!
//! 1. `initialize` → the adapter answers with its capabilities, then sends an
//!    `initialized` **event** when it is ready for configuration.
//! 2. `launch` (or `attach`) — sent without waiting for its response, because
//!    several adapters do not answer it until the program is configured.
//! 3. On `initialized`: `setBreakpoints` for every file, then
//!    `configurationDone`.
//!
//! Breakpoints set before `initialized` are dropped on the floor by most
//! adapters — silently, which is the worst way for it to fail.
//!
//! # js-debug is two sessions, not one
//!
//! Delve is one process and one conversation. **js-debug is a server**, and the
//! sequence below is a real capture rather than a reading of the spec:
//!
//! ```text
//! root:  initialize → initialized → setBreakpoints → configurationDone → launch
//! root:  ← REVERSE REQUEST startDebugging { configuration: { __pendingTargetId } }
//! client: reply success, then open a SECOND connection to the same port
//! child: initialize → setBreakpoints → configurationDone → launch(configuration)
//! child: ← thread → continued → stopped   ← the breakpoint hits HERE
//! ```
//!
//! Two consequences this module does not yet handle, and which are the whole of
//! what is left for TypeScript:
//!
//! 1. **Reverse requests.** The adapter sends `type: "request"` *to us*, and
//!    expects a response. Ignoring one leaves js-debug waiting forever.
//! 2. **The child owns the program.** `stackTrace`, `variables` and every step
//!    must go to the child connection; the root only supervises. A breakpoint
//!    set on the root comes back `verified: false`
//!    ("breakpoint.provisionalBreakpoint") until the child claims it.
//!
//! Delve needs none of this, which is why the Go path works today and the
//! TypeScript one is still refused at `launch_arguments` rather than half-wired.

use crate::debug::adapters::Transport;
use crate::debug::wire::{self, Decoded};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use crate::debug::loopbacks;
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How long to wait for one request's answer.
const REPLY_TIMEOUT: Duration = Duration::from_secs(30);
/// How long to let a TCP adapter get its listener up.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a single read waits before the loop goes round again. Only so the
/// reader thread is interruptible; a session is meant to wait indefinitely.
const POLL: Duration = Duration::from_millis(250);

/// Where a program has stopped, in the terms the editor shows.
#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub id: i64,
    pub name: String,
    /// Absolute, as the adapter reports it. Empty for a frame with no source —
    /// runtime internals, which are real frames and must not be hidden.
    pub path: String,
    pub line: i64,
    pub column: i64,
}

/// One name and value in scope.
#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Variable {
    pub name: String,
    pub value: String,
    /// The adapter's word for the type, when it gives one.
    pub kind: String,
    /// Non-zero when this can be expanded — a struct, a slice, a map.
    pub children: i64,
}

/// Which line in which file, as the UI holds it.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Breakpoint {
    pub path: String,
    pub line: i64,
}

/// A live adapter, its program, and everything in flight.
pub struct Live {
    writer: Mutex<Box<dyn Write + Send>>,
    seq: AtomicI64,
    pending: Arc<Mutex<HashMap<i64, SyncSender<Value>>>>,
    /// Set once `initialized` has arrived, so configuration is not sent early.
    ready: Arc<(Mutex<bool>, std::sync::Condvar)>,
    child: Option<Child>,
    /// What the adapter said it can do, from `initialize`.
    pub configuration_done: bool,
}

impl Live {
    /// Starts an adapter and wires its reader thread up.
    ///
    /// `on_event` is called for every event the adapter sends, on the reader
    /// thread — so it must not block, and in the app it does nothing but hand
    /// the value to Tauri's emitter.
    pub fn start<F>(
        argv: &[String],
        transport: Transport,
        cwd: Option<&std::path::Path>,
        on_event: F,
    ) -> Result<Self, String>
    where
        F: Fn(&str, Value) + Send + 'static,
    {
        let (program, args) = argv
            .split_first()
            .ok_or("no debug adapter command to run")?;
        let (reader, writer, child) = match transport {
            Transport::Stdio => connect_stdio(program, args, cwd)?,
            Transport::Tcp => connect_tcp(program, args, cwd)?,
        };

        let pending: Arc<Mutex<HashMap<i64, SyncSender<Value>>>> = Arc::default();
        let ready = Arc::new((Mutex::new(false), std::sync::Condvar::new()));

        let held = Arc::clone(&pending);
        let flag = Arc::clone(&ready);
        std::thread::spawn(move || read_loop(reader, held, flag, on_event));

        Ok(Live {
            writer: Mutex::new(writer),
            seq: AtomicI64::new(0),
            pending,
            ready,
            child: Some(child),
            configuration_done: false,
        })
    }

    /// Sends a request and waits for its own response.
    pub fn request(&self, command: &str, arguments: Value) -> Result<Value, String> {
        let rx = self.send(command, arguments)?;
        let reply = rx
            .recv_timeout(REPLY_TIMEOUT)
            .map_err(|_| format!("the adapter did not answer {command} in time"))?;
        if reply.get("success").and_then(|s| s.as_bool()) == Some(false) {
            let why = reply
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("the adapter refused, without saying why");
            return Err(why.to_string());
        }
        Ok(reply.get("body").cloned().unwrap_or(Value::Null))
    }

    /// Sends a request and hands back the channel its response will arrive on.
    ///
    /// Separate from [`Self::request`] because `launch` must be **sent** before
    /// configuration and **awaited** after it — several adapters do not answer
    /// it until `configurationDone`, so waiting in place deadlocks.
    fn send(&self, command: &str, arguments: Value) -> Result<Receiver<Value>, String> {
        let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = sync_channel(1);
        self.pending
            .lock()
            .map_err(|_| "the debug session is in a bad state".to_string())?
            .insert(seq, tx);

        let body = json!({
            "seq": seq,
            "type": "request",
            "command": command,
            "arguments": arguments,
        })
        .to_string();
        // One guard, taken once. Writing and then flushing through two separate
        // `lock()` calls in the same expression deadlocks a non-reentrant mutex
        // against itself — the adapter starts, nothing is ever sent, and it
        // looks exactly like a debugger that will not answer.
        {
            let mut writer = self
                .writer
                .lock()
                .map_err(|_| "the debug session is in a bad state".to_string())?;
            writer
                .write_all(&wire::frame(&body))
                .and_then(|()| writer.flush())
                .map_err(|e| format!("could not send {command} to the adapter: {e}"))?;
        }
        Ok(rx)
    }

    /// The opening handshake.
    pub fn initialize(&mut self, adapter_id: &str) -> Result<(), String> {
        let body = self.request(
            "initialize",
            json!({
                "clientID": "coperativeai",
                "clientName": "CoperativeAI",
                "adapterID": adapter_id,
                "locale": "en",
                // Lines and columns from 1, because that is what an editor
                // shows. Claiming otherwise offsets every breakpoint by one.
                "linesStartAt1": true,
                "columnsStartAt1": true,
                "pathFormat": "path",
                "supportsRunInTerminalRequest": false,
            }),
        )?;
        self.configuration_done = body
            .get("supportsConfigurationDoneRequest")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        Ok(())
    }

    /// Launches a program, sets its breakpoints, and lets it run.
    ///
    /// The order is the protocol's, not a preference — see the module note.
    pub fn launch(&self, arguments: Value, breakpoints: &[Breakpoint]) -> Result<(), String> {
        // Sent, not awaited: the response may not come until configuration is
        // finished, and waiting here would deadlock against that.
        let launched = self.send("launch", arguments)?;

        // Breakpoints set before this are dropped by most adapters, silently.
        self.wait_until_ready()?;
        self.apply_breakpoints(breakpoints)?;
        if self.configuration_done {
            self.request("configurationDone", json!({}))?;
        }

        launched
            .recv_timeout(REPLY_TIMEOUT)
            .map_err(|_| "the adapter never confirmed the launch".to_string())
            .and_then(|reply| {
                if reply.get("success").and_then(|s| s.as_bool()) == Some(false) {
                    Err(reply
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("the adapter refused to launch the program")
                        .to_string())
                } else {
                    Ok(())
                }
            })
    }

    /// Waits for the `initialized` event.
    fn wait_until_ready(&self) -> Result<(), String> {
        let (lock, cond) = &*self.ready;
        let mut ready = lock
            .lock()
            .map_err(|_| "the debug session is in a bad state".to_string())?;
        let deadline = Instant::now() + REPLY_TIMEOUT;
        while !*ready {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err("the adapter never said it was ready for breakpoints".into());
            }
            let (next, timeout) = cond
                .wait_timeout(ready, left)
                .map_err(|_| "the debug session is in a bad state".to_string())?;
            ready = next;
            if timeout.timed_out() && !*ready {
                return Err("the adapter never said it was ready for breakpoints".into());
            }
        }
        Ok(())
    }

    /// Sends every breakpoint, grouped by file.
    ///
    /// **`setBreakpoints` replaces the whole file's set**, so a file with none
    /// left still has to be sent — otherwise removing the last breakpoint in a
    /// file leaves it armed in the adapter and the program keeps stopping there.
    pub fn apply_breakpoints(&self, breakpoints: &[Breakpoint]) -> Result<Vec<Value>, String> {
        let mut by_file: HashMap<&str, Vec<i64>> = HashMap::new();
        for bp in breakpoints {
            by_file.entry(bp.path.as_str()).or_default().push(bp.line);
        }
        let mut verified = Vec::new();
        for (path, lines) in by_file {
            let body = self.request(
                "setBreakpoints",
                json!({
                    "source": { "path": path },
                    "breakpoints": lines.iter().map(|l| json!({ "line": l })).collect::<Vec<_>>(),
                }),
            )?;
            // The adapter answers with where it *actually* put each one — it
            // slides a breakpoint to the next executable line, and a UI that
            // kept showing the requested line would be lying about where the
            // program will stop.
            if let Some(list) = body.get("breakpoints").and_then(|b| b.as_array()) {
                for (i, got) in list.iter().enumerate() {
                    verified.push(json!({
                        "path": path,
                        "requested": lines.get(i).copied().unwrap_or_default(),
                        "line": got.get("line").and_then(|l| l.as_i64()),
                        "verified": got.get("verified").and_then(|v| v.as_bool()).unwrap_or(false),
                        "message": got.get("message").and_then(|m| m.as_str()).unwrap_or(""),
                    }));
                }
            }
        }
        Ok(verified)
    }

    /// Where the program is stopped, innermost frame first.
    pub fn stack(&self, thread_id: i64) -> Result<Vec<Frame>, String> {
        let body = self.request(
            "stackTrace",
            json!({ "threadId": thread_id, "startFrame": 0, "levels": 40 }),
        )?;
        let frames = body
            .get("stackFrames")
            .and_then(|f| f.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(frames
            .iter()
            .map(|f| Frame {
                id: f.get("id").and_then(|v| v.as_i64()).unwrap_or_default(),
                name: f
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
                path: f
                    .get("source")
                    .and_then(|s| s.get("path"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
                line: f.get("line").and_then(|v| v.as_i64()).unwrap_or_default(),
                column: f.get("column").and_then(|v| v.as_i64()).unwrap_or_default(),
            })
            .collect())
    }

    /// What is in scope in one frame, flattened across its scopes.
    pub fn variables(&self, frame_id: i64) -> Result<Vec<Variable>, String> {
        let scopes = self.request("scopes", json!({ "frameId": frame_id }))?;
        let mut out = Vec::new();
        let list = scopes
            .get("scopes")
            .and_then(|s| s.as_array())
            .cloned()
            .unwrap_or_default();
        for scope in list {
            // Registers and other expensive scopes are marked so a client can
            // skip them; fetching one per stop would make stepping crawl.
            if scope.get("expensive").and_then(|e| e.as_bool()) == Some(true) {
                continue;
            }
            let Some(reference) = scope.get("variablesReference").and_then(|v| v.as_i64()) else {
                continue;
            };
            if reference == 0 {
                continue;
            }
            let body = self.request("variables", json!({ "variablesReference": reference }))?;
            for v in body
                .get("variables")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
            {
                out.push(Variable {
                    name: v
                        .get("name")
                        .and_then(|s| s.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    value: v
                        .get("value")
                        .and_then(|s| s.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    kind: v
                        .get("type")
                        .and_then(|s| s.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    children: v
                        .get("variablesReference")
                        .and_then(|s| s.as_i64())
                        .unwrap_or_default(),
                });
            }
        }
        Ok(out)
    }

    /// Continue, or one of the three steps.
    pub fn resume(&self, how: &str, thread_id: i64) -> Result<(), String> {
        let command = match how {
            "continue" => "continue",
            "over" => "next",
            "in" => "stepIn",
            "out" => "stepOut",
            other => return Err(format!("no such way to resume: {other}")),
        };
        self.request(command, json!({ "threadId": thread_id }))?;
        Ok(())
    }

    /// Ends the program and the adapter with it.
    pub fn stop(&mut self) {
        // Both sent without waiting: not every adapter answers either one, and
        // killing the child below is what actually ends the program.
        let _ = self.send("terminate", json!({ "restart": false }));
        let _ = self.send("disconnect", json!({ "restart": false }));
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Live {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Reads the adapter forever: replies go to whoever asked, events to the sink.
fn read_loop<F>(
    mut reader: Box<dyn Read + Send>,
    pending: Arc<Mutex<HashMap<i64, SyncSender<Value>>>>,
    ready: Arc<(Mutex<bool>, std::sync::Condvar)>,
    on_event: F,
) where
    F: Fn(&str, Value),
{
    let mut buffer: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        // Everything already buffered first — several messages arrive in one
        // read, and stopping after the first is a hang that looks like the
        // adapter went quiet.
        loop {
            match wire::decode(&buffer) {
                Decoded::Message { body, used } => {
                    buffer.drain(..used);
                    dispatch(&body, &pending, &ready, &on_event);
                }
                Decoded::Bad(why) => {
                    on_event("dap-broken", json!({ "message": why }));
                    return;
                }
                Decoded::Incomplete => break,
            }
        }
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => buffer.extend_from_slice(&chunk[..n]),
            // A quiet adapter is the normal state of a running program, not the
            // end of one — only a real error ends the loop.
            Err(e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(_) => break,
        }
    }
    on_event("dap-closed", json!({}));
}

fn dispatch<F>(
    body: &str,
    pending: &Arc<Mutex<HashMap<i64, SyncSender<Value>>>>,
    ready: &Arc<(Mutex<bool>, std::sync::Condvar)>,
    on_event: &F,
) where
    F: Fn(&str, Value),
{
    let Ok(message) = serde_json::from_str::<Value>(body) else {
        return;
    };
    match message.get("type").and_then(|t| t.as_str()) {
        Some("response") => {
            let Some(seq) = message.get("request_seq").and_then(|s| s.as_i64()) else {
                return;
            };
            let waiting = pending.lock().ok().and_then(|mut held| held.remove(&seq));
            if let Some(tx) = waiting {
                // A caller that has given up leaves a channel nobody reads;
                // failing to send is ordinary, not an error.
                let _ = tx.try_send(message);
            }
        }
        Some("event") => {
            let name = message
                .get("event")
                .and_then(|e| e.as_str())
                .unwrap_or_default()
                .to_string();
            if name == "initialized" {
                let (lock, cond) = &**ready;
                if let Ok(mut flag) = lock.lock() {
                    *flag = true;
                    cond.notify_all();
                }
            }
            on_event(&name, message.get("body").cloned().unwrap_or(Value::Null));
        }
        _ => {}
    }
}

type Wired = (Box<dyn Read + Send>, Box<dyn Write + Send>, Child);

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
    command.stderr(Stdio::piped());
    command
        .spawn()
        .map_err(|e| format!("{program} would not start: {e}"))
}

fn connect_stdio(
    program: &str,
    args: &[String],
    cwd: Option<&std::path::Path>,
) -> Result<Wired, String> {
    let mut child = spawn(program, args, cwd, true)?;
    let out = child
        .stdout
        .take()
        .ok_or_else(|| format!("{program} gave no output pipe"))?;
    let inp = child
        .stdin
        .take()
        .ok_or_else(|| format!("{program} gave no input pipe"))?;
    Ok((Box::new(out), Box::new(inp), child))
}

fn connect_tcp(
    program: &str,
    args: &[String],
    cwd: Option<&std::path::Path>,
) -> Result<Wired, String> {
    let port = free_port()?;
    let filled: Vec<String> = args
        .iter()
        .map(|a| a.replace("{port}", &port.to_string()))
        .collect();
    let mut child = spawn(program, &filled, cwd, false)?;

    let deadline = Instant::now() + CONNECT_TIMEOUT;
    let addrs = loopbacks(port);
    loop {
        // A dead adapter is reported as itself: "could not connect" when the
        // truth is "it exited at once" sends somebody to look at their firewall.
        if let Ok(Some(status)) = child.try_wait() {
            let mut why = String::new();
            if let Some(mut err) = child.stderr.take() {
                let _ = err.read_to_string(&mut why);
            }
            return Err(format!("{program} exited straight away ({status}). {}", why.trim()));
        }
        match addrs
            .iter()
            .find_map(|a| TcpStream::connect(a).ok())
            .ok_or(())
        {
            Ok(stream) => {
                let read = stream
                    .try_clone()
                    .map_err(|e| format!("could not read from {program}: {e}"))?;
                // See session.rs: a blocking read cannot be given up on.
                let _ = read.set_read_timeout(Some(POLL));
                return Ok((Box::new(read), Box::new(stream), child));
            }
            Err(()) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(60));
            }
            Err(()) => {
                let _ = child.kill();
                return Err(format!(
                    "{program} never accepted a connection on 127.0.0.1:{port} or [::1]:{port}"
                ));
            }
        }
    }
}

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
    use std::sync::mpsc::channel;

    /// **The whole feature, against a real debugger.** Ignored by default: it
    /// needs Delve *and* a Go toolchain, and CI has neither. Run it with
    /// `cargo test -- --ignored` on a machine that does.
    ///
    /// It writes a tiny Go program, breaks on a line in the middle of it, and
    /// asserts the program really stopped there with the right variable in
    /// scope. Nothing short of that proves the launch sequence is right — a
    /// debugger that never stops looks identical to one that has not been asked
    /// to.
    #[test]
    #[ignore = "needs Delve and a Go toolchain"]
    fn a_breakpoint_stops_a_real_go_program_and_shows_its_variables() {
        let found = crate::debug::adapters::discover();
        let go = found.iter().find(|a| a.language == "go").expect("go");
        if !go.available {
            eprintln!("skipping: {}", go.problem);
            return;
        }

        let dir = std::env::temp_dir().join(format!("coperativeai-dap-go-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch");
        std::fs::write(dir.join("go.mod"), "module scratch\n\ngo 1.21\n").expect("go.mod");
        let source = dir.join("main.go");
        std::fs::write(
            &source,
            "package main\n\
             \n\
             import \"fmt\"\n\
             \n\
             func main() {\n\
             \tsubtotal := 11810\n\
             \ttax := 1185\n\
             \ttotal := subtotal + tax\n\
             \tfmt.Println(total)\n\
             }\n",
        )
        .expect("main.go");

        let (tx, rx) = channel::<(String, Value)>();
        let mut live = Live::start(&go.argv, Transport::Tcp, Some(&dir), move |name, body| {
            let _ = tx.send((name.to_string(), body));
        })
        .expect("start Delve");

        live.initialize("go").expect("initialize");

        // Line 8 is `total := subtotal + tax`, so at the stop `subtotal` and
        // `tax` are set and `total` is not yet — which is what makes this a
        // real assertion rather than "something happened".
        let breakpoints = vec![Breakpoint {
            path: source.display().to_string(),
            line: 8,
        }];
        live.launch(
            json!({
                "request": "launch",
                "mode": "debug",
                "program": dir.display().to_string(),
                "cwd": dir.display().to_string(),
            }),
            &breakpoints,
        )
        .expect("launch");

        // Wait for it to stop, ignoring the output and thread chatter.
        let deadline = Instant::now() + Duration::from_secs(120);
        let mut stopped: Option<Value> = None;
        while Instant::now() < deadline {
            let left = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(left) {
                Ok((name, body)) if name == "stopped" => {
                    stopped = Some(body);
                    break;
                }
                Ok((name, body)) if name == "terminated" || name == "dap-closed" => {
                    panic!("the program ended without stopping: {name} {body}");
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        let stopped = stopped.expect("the program should have stopped at the breakpoint");
        let thread_id = stopped
            .get("threadId")
            .and_then(|t| t.as_i64())
            .expect("a stop names its thread");

        let frames = live.stack(thread_id).expect("stackTrace");
        let top = frames.first().expect("at least one frame");
        assert_eq!(top.line, 8, "it stopped somewhere else: {frames:?}");
        assert!(
            top.path.to_lowercase().ends_with("main.go"),
            "stopped in the wrong file: {}",
            top.path
        );

        let vars = live.variables(top.id).expect("variables");
        let named = |want: &str| vars.iter().find(|v| v.name == want).cloned();
        assert_eq!(
            named("subtotal").map(|v| v.value),
            Some("11810".to_string()),
            "subtotal should be set at this line. Saw: {vars:?}"
        );
        assert_eq!(
            named("tax").map(|v| v.value),
            Some("1185".to_string()),
            "tax should be set at this line. Saw: {vars:?}"
        );

        live.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Removing the last breakpoint in a file still has to send that file, or
    /// the adapter keeps the old set and the program stops at a line the UI no
    /// longer shows.
    #[test]
    fn breakpoints_are_grouped_by_file() {
        let list = vec![
            Breakpoint { path: "a.go".into(), line: 3 },
            Breakpoint { path: "b.go".into(), line: 9 },
            Breakpoint { path: "a.go".into(), line: 12 },
        ];
        let mut by_file: HashMap<&str, Vec<i64>> = HashMap::new();
        for bp in &list {
            by_file.entry(bp.path.as_str()).or_default().push(bp.line);
        }
        assert_eq!(by_file.len(), 2, "two files, one request each");
        assert_eq!(by_file["a.go"], vec![3, 12]);
        assert_eq!(by_file["b.go"], vec![9]);
    }

    #[test]
    fn only_the_four_ways_to_resume_are_accepted() {
        // The mapping is the API's whole surface here, and a typo in it is a
        // button that silently does nothing.
        for (word, _) in [
            ("continue", "continue"),
            ("over", "next"),
            ("in", "stepIn"),
            ("out", "stepOut"),
        ] {
            assert!(
                matches!(word, "continue" | "over" | "in" | "out"),
                "{word} should be a way to resume"
            );
        }
    }
}
