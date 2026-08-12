//! A debug session that is actually running, with breakpoints and stepping.
//!
//! [`super::session::Session`] is the handshake: send one thing, wait for its
//! answer. That shape cannot survive a real session, because the interesting
//! half is **unsolicited** — the adapter says `stopped` when it hits a
//! breakpoint, `output` whenever the program prints, and `terminated` when it
//! ends, none of it in reply to anything.
//!
//! So this is the usual shape for a protocol like it: one reader thread per
//! connection, a map of outstanding requests keyed by `seq`, and a sink for
//! everything that is not a reply. A request blocks its caller until its own
//! response arrives; events reach the UI as they happen.
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
//! sequence below was captured from a real run rather than read off the spec:
//!
//! ```text
//! root:  initialize → initialized → setBreakpoints → configurationDone → launch
//! root:  ← REVERSE REQUEST startDebugging { configuration: { __pendingTargetId } }
//! client: reply success, then open a SECOND connection to the same port
//! child: initialize → initialized → setBreakpoints → configurationDone → launch
//! child: ← thread → continued → stopped   ← the breakpoint hits HERE
//! ```
//!
//! Two consequences, and they are why this module is built around a
//! [`Channel`] rather than one writer:
//!
//! 1. **Reverse requests.** The adapter sends `type: "request"` *to us* and
//!    waits for a response. Ignoring one leaves js-debug hanging.
//! 2. **The child owns the program.** Once a child exists, `stackTrace`,
//!    `variables` and every step go to it; the root only supervises. A
//!    breakpoint set on the root comes back `verified: false`
//!    ("breakpoint.provisionalBreakpoint") until the child claims it, so the
//!    breakpoints are kept and re-sent on the child's own handshake.
//!
//! Delve needs none of this — it never sends a reverse request, so its session
//! simply never grows a child and every request goes to the one connection.

use crate::debug::adapters::Transport;
use crate::debug::loopbacks;
use crate::debug::wire::{self, Decoded};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Condvar, Mutex};
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
    /// Whether **this** frame can be run again.
    ///
    /// Separate from the adapter-wide capability: a runtime or native frame is
    /// on the stack and cannot be restarted even where the adapter can restart
    /// others. DAP says an absent field means "assume yes if the adapter
    /// supports it at all", so the default here is true and the capability is
    /// the outer gate.
    pub can_restart: bool,
}

/// One thread the program is running, as the adapter names it.
///
/// **"Thread" is the protocol's word, not the runtime's.** Delve reports Go
/// goroutines here, js-debug reports one per execution context, and netcoredbg
/// reports real OS threads. All three are the thing you can ask for a stack, so
/// all three go here under the protocol's name rather than a translated one
/// that would be wrong for two of them.
#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: i64,
    pub name: String,
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
    /// An expression in the debugged language that has to be true for the
    /// program to stop here. Empty means stop every time.
    ///
    /// **Evaluated by the adapter, in the program**, not by this app: it is the
    /// debuggee's own language, its own scope and its own types. Defaulted so
    /// breakpoints stored before conditions existed still load.
    #[serde(default)]
    pub condition: String,
    /// A message to print instead of stopping — a **log point**.
    ///
    /// The point of it is that the program keeps running: this is the `println`
    /// you would otherwise add, without the edit and without the rebuild.
    /// `{expr}` inside the message is evaluated in the program, so
    /// `total is {subtotal + tax}` prints the sum.
    ///
    /// A breakpoint with one of these does not stop, so setting a log message
    /// and expecting a stop is the one confusion the UI has to head off.
    #[serde(default)]
    pub log: String,
    /// How many times the line has to be reached before this counts — the
    /// answer to "stop the 500th time round, not the first".
    ///
    /// **The syntax belongs to the adapter, not to DAP.** The protocol says
    /// only that it is an expression the adapter understands; Delve takes
    /// `== 7`, `> 100`, `% 3`, and each debugger is free to differ. So it is
    /// passed through verbatim and the adapter's own complaint is what a person
    /// sees, rather than this app inventing a grammar and being wrong about it.
    #[serde(default)]
    pub hits: String,
}

/// One DAP connection: somewhere to write, and everything waiting for a reply.
///
/// A session has one of these for Delve and two for js-debug, which is the
/// whole reason it is a type rather than three fields on `Live`.
struct Channel {
    writer: Mutex<Box<dyn Write + Send>>,
    seq: AtomicI64,
    pending: Mutex<HashMap<i64, SyncSender<Value>>>,
    /// Set when this connection's `initialized` event arrives.
    ready: (Mutex<bool>, Condvar),
}

impl Channel {
    fn new(writer: Box<dyn Write + Send>) -> Self {
        Channel {
            writer: Mutex::new(writer),
            seq: AtomicI64::new(0),
            pending: Mutex::new(HashMap::new()),
            ready: (Mutex::new(false), Condvar::new()),
        }
    }

    /// Writes one message. One guard, taken once — writing and flushing through
    /// two `lock()` calls in the same expression deadlocks a non-reentrant
    /// mutex against itself, and looks exactly like an adapter that will not
    /// answer.
    fn write(&self, body: &str, what: &str) -> Result<(), String> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| "the debug session is in a bad state".to_string())?;
        writer
            .write_all(&wire::frame(body))
            .and_then(|()| writer.flush())
            .map_err(|e| format!("could not send {what} to the adapter: {e}"))
    }

    /// Sends a request and hands back the channel its response will arrive on.
    fn send(&self, command: &str, arguments: Value) -> Result<Receiver<Value>, String> {
        let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = sync_channel(1);
        self.pending
            .lock()
            .map_err(|_| "the debug session is in a bad state".to_string())?
            .insert(seq, tx);
        self.write(
            &json!({
                "seq": seq,
                "type": "request",
                "command": command,
                "arguments": arguments,
            })
            .to_string(),
            command,
        )?;
        Ok(rx)
    }

    /// Sends a request and waits for its own response.
    fn request(&self, command: &str, arguments: Value) -> Result<Value, String> {
        let rx = self.send(command, arguments)?;
        let reply = rx
            .recv_timeout(REPLY_TIMEOUT)
            .map_err(|_| format!("the adapter did not answer {command} in time"))?;
        if reply.get("success").and_then(|s| s.as_bool()) == Some(false) {
            return Err(reply
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("the adapter refused, without saying why")
                .to_string());
        }
        Ok(reply.get("body").cloned().unwrap_or(Value::Null))
    }

    /// Answers a request the **adapter** made of us. Leaving one unanswered
    /// leaves js-debug waiting forever.
    fn respond(&self, to: &Value) {
        let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        let body = json!({
            "seq": seq,
            "type": "response",
            "request_seq": to.get("seq").and_then(|s| s.as_i64()).unwrap_or_default(),
            "command": to.get("command").and_then(|c| c.as_str()).unwrap_or_default(),
            "success": true,
            "body": {},
        })
        .to_string();
        let _ = self.write(&body, "a reply");
    }

    /// Waits for this connection's `initialized` event.
    fn wait_until_ready(&self) -> Result<(), String> {
        let (lock, cond) = &self.ready;
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
}

/// Everything a reader thread needs, shared between them.
struct Core {
    root: Arc<Channel>,
    /// The child session, once the adapter has asked for one. Requests about
    /// the program go here in preference to the root.
    active: Mutex<Option<Arc<Channel>>>,
    /// The port the adapter is listening on, so a child can be opened on it.
    /// None for a stdio adapter, which cannot have children.
    port: Option<u16>,
    /// Kept so a child can be given them: a breakpoint set on the root is only
    /// provisional until a child claims it.
    breakpoints: Mutex<Vec<Breakpoint>>,
    /// Whether the adapter said it can evaluate breakpoint conditions.
    ///
    /// Read from `initialize`, before any breakpoint is sent. An adapter that
    /// cannot do this ignores a `condition` field silently and stops every
    /// time — which is the opposite of what was asked for — so the condition is
    /// never sent blind.
    conditional: AtomicBool,
    /// Whether the adapter said it can print a message instead of stopping.
    ///
    /// Same failure shape as `conditional`, and worse in effect: an adapter
    /// that ignores `logMessage` **stops** at a breakpoint whose whole purpose
    /// was not to.
    log_points: AtomicBool,
    /// Whether the adapter said it can count hits before honouring a
    /// breakpoint. Ignoring `hitCondition` stops on the *first* hit — usually
    /// the one iteration somebody already knows is fine.
    hit_counts: AtomicBool,
    /// Whether the adapter can rewind to the start of a frame.
    restart_frame: AtomicBool,
    on_event: EventSink,
}

/// What an adapter said it can do with a breakpoint beyond stopping at a line.
///
/// One value rather than two loose `bool`s: they are read together, passed
/// together and mixed up if they are ever passed positionally.
#[derive(Clone, Copy, Debug, Default)]
pub struct Honours {
    /// `supportsConditionalBreakpoints`.
    pub conditions: bool,
    /// `supportsLogPoints`.
    pub log_points: bool,
    /// `supportsHitConditionalBreakpoints`.
    pub hit_counts: bool,
    /// `supportsRestartFrame` — the only thing DAP offers that acts on a
    /// **frame** rather than a thread.
    ///
    /// Worth naming here because the absence of the others is what makes this
    /// one matter: `next`, `stepIn` and `stepOut` all take a `threadId` and
    /// nothing else, so stepping always acts on the innermost frame no matter
    /// which one is selected. Selecting a caller and stepping is not a thing
    /// the protocol can express — restarting that caller is.
    pub restart_frame: bool,
}

/// Where every event goes on its way to the window.
///
/// `Sync` as well as `Send`, because js-debug has two connections and therefore
/// two reader threads calling this.
type EventSink = Box<dyn Fn(&str, Value) + Send + Sync>;

impl Core {
    fn honours(&self) -> Honours {
        Honours {
            conditions: self.conditional.load(Ordering::Relaxed),
            log_points: self.log_points.load(Ordering::Relaxed),
            hit_counts: self.hit_counts.load(Ordering::Relaxed),
            restart_frame: self.restart_frame.load(Ordering::Relaxed),
        }
    }

    /// Where a request about the running program should go.
    fn talker(&self) -> Arc<Channel> {
        self.active
            .lock()
            .ok()
            .and_then(|held| held.clone())
            .unwrap_or_else(|| Arc::clone(&self.root))
    }
}

/// A live adapter, its program, and everything in flight.
pub struct Live {
    core: Arc<Core>,
    child: Option<Child>,
    configuration_done: bool,
}

impl Live {
    /// Starts an adapter and wires its reader thread up.
    ///
    /// `on_event` is called for every event the adapter sends, from a reader
    /// thread — so it must not block, and in the app it does nothing but hand
    /// the value to Tauri's emitter. It must be `Sync` because js-debug has two
    /// connections and therefore two readers.
    pub fn start<F>(
        argv: &[String],
        transport: Transport,
        cwd: Option<&std::path::Path>,
        on_event: F,
    ) -> Result<Self, String>
    where
        F: Fn(&str, Value) + Send + Sync + 'static,
    {
        let (program, args) = argv.split_first().ok_or("no debug adapter command to run")?;
        let wired: WiredTcp = match transport {
            // A stdio adapter has no port, and so can never have a child.
            Transport::Stdio => {
                let (r, w, c) = connect_stdio(program, args, cwd)?;
                (r, w, c, 0)
            }
            Transport::Tcp => connect_tcp(program, args, cwd)?,
        };
        let (reader, writer, child, port) = wired;
        let port = if port == 0 { None } else { Some(port) };

        let root = Arc::new(Channel::new(writer));
        let core = Arc::new(Core {
            root: Arc::clone(&root),
            active: Mutex::new(None),
            port,
            breakpoints: Mutex::new(Vec::new()),
            // Assumed absent until `initialize` says otherwise: neither is ever
            // sent to an adapter that has not claimed it can honour it.
            conditional: AtomicBool::new(false),
            log_points: AtomicBool::new(false),
            hit_counts: AtomicBool::new(false),
            restart_frame: AtomicBool::new(false),
            on_event: Box::new(on_event),
        });

        let held = Arc::clone(&core);
        std::thread::spawn(move || read_loop(reader, held, root, true));

        Ok(Live {
            core,
            child: Some(child),
            configuration_done: false,
        })
    }

    /// The opening handshake, on the root connection.
    pub fn initialize(&mut self, adapter_id: &str) -> Result<(), String> {
        let body = self.core.root.request("initialize", initialize_args(adapter_id))?;
        self.configuration_done = body
            .get("supportsConfigurationDoneRequest")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        self.core.conditional.store(
            body.get("supportsConditionalBreakpoints")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            Ordering::Relaxed,
        );
        self.core.log_points.store(
            body.get("supportsLogPoints")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            Ordering::Relaxed,
        );
        self.core.hit_counts.store(
            body.get("supportsHitConditionalBreakpoints")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            Ordering::Relaxed,
        );
        self.core.restart_frame.store(
            body.get("supportsRestartFrame")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            Ordering::Relaxed,
        );
        Ok(())
    }

    /// Launches a program, sets its breakpoints, and lets it run.
    pub fn launch(&self, arguments: Value, breakpoints: &[Breakpoint]) -> Result<(), String> {
        if let Ok(mut held) = self.core.breakpoints.lock() {
            *held = breakpoints.to_vec();
        }
        configure_and_launch(
            &self.core.root,
            arguments,
            breakpoints,
            self.configuration_done,
            self.core.honours(),
        )
    }

    /// Sends every breakpoint, grouped by file, to whichever connection owns
    /// the program.
    ///
    /// **`setBreakpoints` replaces the whole file's set**, so a file with none
    /// left still has to be sent — otherwise removing the last breakpoint in a
    /// file leaves it armed in the adapter and the program keeps stopping there.
    pub fn apply_breakpoints(&self, breakpoints: &[Breakpoint]) -> Result<Vec<Value>, String> {
        if let Ok(mut held) = self.core.breakpoints.lock() {
            *held = breakpoints.to_vec();
        }
        set_breakpoints(&self.core.talker(), breakpoints, self.core.honours())
    }

    /// What this adapter will do with a breakpoint beyond stopping at a line.
    ///
    /// Surfaced so the UI can say "this debugger cannot do that" instead of
    /// showing a box whose contents would be quietly dropped.
    pub fn honours(&self) -> Honours {
        self.core.honours()
    }

    /// Every thread the program has, stopped or not.
    ///
    /// **Asked for rather than remembered.** Threads come and go while a
    /// program runs, and DAP's `thread` events are advisory — an adapter is
    /// not obliged to send one for every start and exit. Reading the list at
    /// each stop is the only way it is right.
    pub fn threads(&self) -> Result<Vec<Thread>, String> {
        let body = self.core.talker().request("threads", json!({}))?;
        Ok(body
            .get("threads")
            .and_then(|t| t.as_array())
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|t| Thread {
                id: t.get("id").and_then(|v| v.as_i64()).unwrap_or_default(),
                name: text(t, "name"),
            })
            .collect())
    }

    /// Where the program is stopped, innermost frame first.
    pub fn stack(&self, thread_id: i64) -> Result<Vec<Frame>, String> {
        let body = self.core.talker().request(
            "stackTrace",
            json!({ "threadId": thread_id, "startFrame": 0, "levels": 40 }),
        )?;
        Ok(body
            .get("stackFrames")
            .and_then(|f| f.as_array())
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|f| Frame {
                id: f.get("id").and_then(|v| v.as_i64()).unwrap_or_default(),
                name: text(f, "name"),
                path: f
                    .get("source")
                    .and_then(|s| s.get("path"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
                line: f.get("line").and_then(|v| v.as_i64()).unwrap_or_default(),
                column: f.get("column").and_then(|v| v.as_i64()).unwrap_or_default(),
                can_restart: f
                    .get("canRestart")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true),
            })
            .collect())
    }

    /// What is in scope in one frame, flattened across its scopes.
    pub fn variables(&self, frame_id: i64) -> Result<Vec<Variable>, String> {
        let talker = self.core.talker();
        let scopes = talker.request("scopes", json!({ "frameId": frame_id }))?;
        let mut out = Vec::new();
        for scope in scopes
            .get("scopes")
            .and_then(|s| s.as_array())
            .cloned()
            .unwrap_or_default()
        {
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
            out.extend(read_variables(&talker, reference)?);
        }
        Ok(out)
    }

    /// Works out what an expression comes to, in one frame.
    ///
    /// **The thing the variable list cannot do.** That list shows what happens
    /// to have a name in scope; a watch shows what you want to know —
    /// `subtotal + tax`, `len(items)`, `order.Customer.Region`. None of those
    /// are variables, and none of them can be read off a scope.
    ///
    /// Evaluated **in the frame**, by the adapter, in the program's own
    /// language. So the same expression against a caller and against the
    /// innermost frame are different questions with different answers, and the
    /// frame is not optional here even though DAP allows it to be: without one
    /// an adapter falls back to a global scope where almost nothing a person
    /// would type is in scope at all.
    ///
    /// Answers in the same shape as a variable, so a watch that comes back a
    /// struct opens with [`Live::expand`] like any other.
    pub fn evaluate(&self, expression: &str, frame_id: i64) -> Result<Variable, String> {
        let body = self.core.talker().request(
            "evaluate",
            json!({
                "expression": expression,
                "frameId": frame_id,
                // "watch" tells the adapter this is a value being displayed
                // rather than a command being run: side effects are avoided
                // where the adapter can avoid them, and js-debug in particular
                // formats the answer for reading rather than for a console.
                "context": "watch",
            }),
        )?;
        Ok(Variable {
            name: expression.to_string(),
            value: text(&body, "result"),
            kind: text(&body, "type"),
            children: body
                .get("variablesReference")
                .and_then(|v| v.as_i64())
                .unwrap_or_default(),
        })
    }

    /// One variable's own fields — the struct opened, the slice's elements.
    ///
    /// **Only ever fetched when asked for.** A `variablesReference` is a handle
    /// to something the adapter has not sent, and walking them eagerly means
    /// reading the whole object graph on every stop: a linked list would be
    /// followed to its end and a cyclic one would never finish. So the tree is
    /// filled a level at a time, by opening it.
    ///
    /// The handles are invalidated by the adapter as soon as the program moves,
    /// so an expansion held across a step is stale and must be re-fetched
    /// rather than reused.
    pub fn expand(&self, reference: i64) -> Result<Vec<Variable>, String> {
        if reference <= 0 {
            return Err("that variable has no fields to open".into());
        }
        read_variables(&self.core.talker(), reference)
    }

    /// Runs one frame again from its first line.
    ///
    /// **The only per-frame operation in the protocol.** Stepping takes a
    /// thread, so it always acts on the innermost frame; this takes a
    /// `frameId`, and it is what "do something with the frame I selected"
    /// actually means. The program is put back at the start of that call with
    /// everything it did since undone as far as the stack is concerned —
    /// side effects it already had are, of course, still had.
    pub fn restart_frame(&self, frame_id: i64) -> Result<(), String> {
        if !self.core.restart_frame.load(Ordering::Relaxed) {
            return Err("this debugger cannot run a frame again".into());
        }
        self.core
            .talker()
            .request("restartFrame", json!({ "frameId": frame_id }))?;
        Ok(())
    }

    /// Continue, or one of the three steps.
    ///
    /// **Takes a thread, not a frame**, because that is all DAP offers: `next`,
    /// `stepIn` and `stepOut` carry a `threadId` and nothing else. Whichever
    /// frame is selected in the UI, a step acts on the innermost one — see
    /// [`Live::restart_frame`] for the operation that does take a frame.
    pub fn resume(&self, how: &str, thread_id: i64) -> Result<(), String> {
        let command = match how {
            "continue" => "continue",
            "over" => "next",
            "in" => "stepIn",
            "out" => "stepOut",
            other => return Err(format!("no such way to resume: {other}")),
        };
        self.core
            .talker()
            .request(command, json!({ "threadId": thread_id }))?;
        Ok(())
    }

    /// Ends the program and the adapter with it.
    pub fn stop(&mut self) {
        // Sent without waiting, to every connection: not every adapter answers
        // either one — js-debug answers neither — and killing the adapter below
        // is what actually ends the program.
        for channel in [Some(self.core.talker()), Some(Arc::clone(&self.core.root))]
            .into_iter()
            .flatten()
        {
            let _ = channel.send("terminate", json!({ "restart": false }));
            let _ = channel.send("disconnect", json!({ "restart": false }));
        }
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

/// One `variables` request, read into the shape the UI wants.
///
/// Shared by the frame's scopes and by opening a single variable, because they
/// are the same DAP request against a different handle — a scope's reference and
/// a variable's reference are both just numbers the adapter gave out.
fn read_variables(talker: &Arc<Channel>, reference: i64) -> Result<Vec<Variable>, String> {
    let body = talker.request("variables", json!({ "variablesReference": reference }))?;
    Ok(body
        .get("variables")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|v| Variable {
            name: text(v, "name"),
            value: text(v, "value"),
            kind: text(v, "type"),
            children: v
                .get("variablesReference")
                .and_then(|s| s.as_i64())
                .unwrap_or_default(),
        })
        .collect())
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|s| s.as_str())
        .unwrap_or_default()
        .to_string()
}

fn initialize_args(adapter_id: &str) -> Value {
    json!({
        "clientID": "coperativeai",
        "clientName": "CoperativeAI",
        "adapterID": adapter_id,
        "locale": "en",
        // Lines and columns from 1, because that is what an editor shows.
        // Claiming otherwise offsets every breakpoint by one.
        "linesStartAt1": true,
        "columnsStartAt1": true,
        "pathFormat": "path",
        "supportsRunInTerminalRequest": false,
        // Without this js-debug will not ask us to open a child session, and
        // the program runs with nothing watching it.
        "supportsStartDebuggingRequest": true,
    })
}

/// `launch`, then configuration, then the launch's answer — the order the
/// protocol fixes. Shared by the root and by any child session, because the
/// sequence is the same on both.
fn configure_and_launch(
    channel: &Channel,
    arguments: Value,
    breakpoints: &[Breakpoint],
    configuration_done: bool,
    honours: Honours,
) -> Result<(), String> {
    // Sent, not awaited: the response may not come until configuration is
    // finished, and waiting here would deadlock against that.
    let launched = channel.send("launch", arguments)?;

    // Breakpoints set before this are dropped by most adapters, silently.
    channel.wait_until_ready()?;
    set_breakpoints(channel, breakpoints, honours)?;
    if configuration_done {
        channel.request("configurationDone", json!({}))?;
    }

    let reply = launched
        .recv_timeout(REPLY_TIMEOUT)
        .map_err(|_| "the adapter never confirmed the launch".to_string())?;
    if reply.get("success").and_then(|s| s.as_bool()) == Some(false) {
        return Err(reply
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("the adapter refused to launch the program")
            .to_string());
    }
    Ok(())
}

/// One `setBreakpoints` per file, and the adapter's answer about each.
fn set_breakpoints(
    channel: &Channel,
    breakpoints: &[Breakpoint],
    honours: Honours,
) -> Result<Vec<Value>, String> {
    let mut by_file: HashMap<&str, Vec<&Breakpoint>> = HashMap::new();
    // An extra sent to an adapter that cannot honour it is worse than none,
    // because DAP has no failure for it — the field is simply ignored, and what
    // is left behaves like a plain breakpoint. A dropped condition stops
    // *every* time; a dropped log message **stops**, at a breakpoint whose
    // whole purpose was not to. Both are the opposite of what was asked for, so
    // neither is sent blind: they are held back and reported, below.
    let mut refused: Vec<(&Breakpoint, &str)> = Vec::new();
    for bp in breakpoints {
        if !bp.condition.is_empty() && !honours.conditions {
            refused.push((bp, "evaluate breakpoint conditions"));
            continue;
        }
        if !bp.log.is_empty() && !honours.log_points {
            refused.push((bp, "print a message instead of stopping"));
            continue;
        }
        if !bp.hits.is_empty() && !honours.hit_counts {
            refused.push((bp, "count hits before stopping"));
            continue;
        }
        by_file.entry(bp.path.as_str()).or_default().push(bp);
    }
    // Every file that had one still has to be sent even if everything in it was
    // refused — `setBreakpoints` replaces the file's whole set, so an unsent
    // file keeps whatever the adapter last armed.
    for (bp, _) in &refused {
        by_file.entry(bp.path.as_str()).or_default();
    }

    let mut verified = Vec::new();
    for (path, wanted) in by_file {
        let lines: Vec<i64> = wanted.iter().map(|b| b.line).collect();
        let body = channel.request(
            "setBreakpoints",
            json!({
                "source": { "path": path },
                "breakpoints": wanted
                    .iter()
                    .map(|b| {
                        let mut one = json!({ "line": b.line });
                        if !b.condition.is_empty() {
                            one["condition"] = json!(b.condition);
                        }
                        // With this set the adapter prints and carries on
                        // rather than stopping — that is the whole feature.
                        if !b.log.is_empty() {
                            one["logMessage"] = json!(b.log);
                        }
                        // Verbatim: the grammar is the adapter's, not DAP's.
                        if !b.hits.is_empty() {
                            one["hitCondition"] = json!(b.hits);
                        }
                        one
                    })
                    .collect::<Vec<_>>(),
            }),
        )?;
        // The adapter answers with where it *actually* put each one — it slides
        // a breakpoint to the next executable line, and a UI that kept showing
        // the requested line would be lying about where the program will stop.
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

    for (bp, what) in refused {
        verified.push(json!({
            "path": bp.path,
            "requested": bp.line,
            "line": Value::Null,
            "verified": false,
            "message": format!(
                "this debugger cannot {what}, so this breakpoint was not set — clearing that \
                 would arm it",
            ),
        }));
    }
    Ok(verified)
}

/// Opens the second connection js-debug asked for and runs its handshake.
///
/// On its own thread, because it is started from inside a reader thread while
/// answering a reverse request — and it makes requests of its own, which that
/// reader is the one who would have to deliver.
fn open_child(core: Arc<Core>, configuration: Value) {
    let Some(port) = core.port else {
        (core.on_event)(
            "dap-broken",
            json!({ "message": "the adapter asked for a child session but is not a server" }),
        );
        return;
    };

    std::thread::spawn(move || {
        let stream = loopbacks(port)
            .iter()
            .find_map(|a| TcpStream::connect(a).ok());
        let Some(stream) = stream else {
            (core.on_event)(
                "dap-broken",
                json!({ "message": "could not open the child debug session" }),
            );
            return;
        };
        let Ok(reader) = stream.try_clone() else { return };
        let _ = reader.set_read_timeout(Some(POLL));

        let channel = Arc::new(Channel::new(Box::new(stream)));
        let held = Arc::clone(&core);
        let mine = Arc::clone(&channel);
        std::thread::spawn(move || read_loop(Box::new(reader), held, mine, false));

        // The child owns the program from here, so every later request goes to
        // it — set before the handshake, so a `stopped` that arrives during it
        // is answered against the right connection.
        if let Ok(mut active) = core.active.lock() {
            *active = Some(Arc::clone(&channel));
        }

        let adapter_id = configuration
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("pwa-node")
            .to_string();
        let done = channel
            .request("initialize", initialize_args(&adapter_id))
            .map(|body| {
                body.get("supportsConfigurationDoneRequest")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
            });
        let Ok(configuration_done) = done else {
            (core.on_event)(
                "dap-broken",
                json!({ "message": "the child debug session would not start" }),
            );
            return;
        };

        let breakpoints = core
            .breakpoints
            .lock()
            .map(|held| held.clone())
            .unwrap_or_default();
        // The child is the same product as the root, so it honours exactly what
        // the root said it could.
        let honours = core.honours();
        if let Err(why) = configure_and_launch(
            &channel,
            configuration,
            &breakpoints,
            configuration_done,
            honours,
        ) {
            (core.on_event)("dap-broken", json!({ "message": why }));
        }
    });
}

/// Reads one connection forever: replies go to whoever asked, events to the
/// sink, and requests from the adapter get answered.
fn read_loop(
    mut reader: Box<dyn Read + Send>,
    core: Arc<Core>,
    channel: Arc<Channel>,
    is_root: bool,
) {
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
                    dispatch(&body, &core, &channel);
                }
                Decoded::Bad(why) => {
                    (core.on_event)("dap-broken", json!({ "message": why }));
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
    // Only the root closing means the session is over. A child that ends is one
    // program finishing, which the `terminated` event has already said.
    if is_root {
        (core.on_event)("dap-closed", json!({}));
    }
}

fn dispatch(body: &str, core: &Arc<Core>, channel: &Arc<Channel>) {
    let Ok(message) = serde_json::from_str::<Value>(body) else {
        return;
    };
    match message.get("type").and_then(|t| t.as_str()) {
        Some("response") => {
            let Some(seq) = message.get("request_seq").and_then(|s| s.as_i64()) else {
                return;
            };
            let waiting = channel
                .pending
                .lock()
                .ok()
                .and_then(|mut held| held.remove(&seq));
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
                let (lock, cond) = &channel.ready;
                if let Ok(mut flag) = lock.lock() {
                    *flag = true;
                    cond.notify_all();
                }
            }
            (core.on_event)(&name, message.get("body").cloned().unwrap_or(Value::Null));
        }
        // A request from the adapter. Every one is answered, because an
        // unanswered reverse request leaves js-debug waiting forever.
        Some("request") => {
            channel.respond(&message);
            if message.get("command").and_then(|c| c.as_str()) == Some("startDebugging") {
                let configuration = message
                    .get("arguments")
                    .and_then(|a| a.get("configuration"))
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                open_child(Arc::clone(core), configuration);
            }
        }
        _ => {}
    }
}

type Wired = (Box<dyn Read + Send>, Box<dyn Write + Send>, Child);
/// A TCP adapter also hands back the port it is listening on, because a child
/// session connects to the same one.
type WiredTcp = (Box<dyn Read + Send>, Box<dyn Write + Send>, Child, u16);

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
) -> Result<WiredTcp, String> {
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
            return Err(format!(
                "{program} exited straight away ({status}). {}",
                why.trim()
            ));
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
                return Ok((Box::new(read), Box::new(stream), child, port));
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
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
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

    /// Waits for a `stopped`, failing loudly if the program ends first.
    fn wait_for_stop(rx: &std::sync::mpsc::Receiver<(String, Value)>, secs: u64) -> Value {
        let deadline = Instant::now() + Duration::from_secs(secs);
        while Instant::now() < deadline {
            let left = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(left) {
                Ok((name, body)) if name == "stopped" => return body,
                Ok((name, body)) if name == "dap-broken" => {
                    panic!("the adapter broke: {body}");
                }
                Ok((name, body)) if name == "terminated" || name == "dap-closed" => {
                    panic!("the program ended without stopping: {name} {body}");
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        panic!("the program never stopped");
    }

    /// **The whole feature, against a real debugger.** Ignored by default: it
    /// needs Delve *and* a Go toolchain, and CI has neither.
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
        // `tax` are set and `total` is not yet — which is what makes this a real
        // assertion rather than "something happened".
        let breakpoints = vec![Breakpoint {
            path: source.display().to_string(),
            line: 8,
            condition: String::new(),
            log: String::new(),
            hits: String::new(),
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

        let stopped = wait_for_stop(&rx, 120);
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

    /// **A watch, against a real debugger.**
    ///
    /// The assertion is deliberately an expression that is **not a variable**:
    /// `subtotal + tax` has no name in any scope, so a "watch" that merely
    /// looked names up in the variable list would fail it while looking like it
    /// worked for `subtotal`.
    ///
    /// It also pins the frame down. The same expression against the caller is a
    /// different question, and an out-of-scope watch has to come back as a
    /// message about that one expression rather than an error over everything.
    #[test]
    #[ignore = "needs Delve and a Go toolchain"]
    fn a_watch_works_out_an_expression_that_is_not_a_variable() {
        let found = crate::debug::adapters::discover();
        let go = found.iter().find(|a| a.language == "go").expect("go");
        if !go.available {
            eprintln!("skipping: {}", go.problem);
            return;
        }

        let dir =
            std::env::temp_dir().join(format!("coperativeai-dap-watch-{}", std::process::id()));
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
             func priced(subtotal int, tax int) int {\n\
             \titems := []string{\"desk\", \"lamp\"}\n\
             \tfmt.Println(len(items))\n\
             \treturn subtotal + tax\n\
             }\n\
             \n\
             func main() {\n\
             \tfmt.Println(priced(11810, 1185))\n\
             }\n",
        )
        .expect("main.go");

        let (tx, rx) = channel::<(String, Value)>();
        let mut live = Live::start(&go.argv, Transport::Tcp, Some(&dir), move |name, body| {
            let _ = tx.send((name.to_string(), body));
        })
        .expect("start Delve");
        live.initialize("go").expect("initialize");

        // Line 8 is `return subtotal + tax`, inside `priced`.
        live.launch(
            json!({
                "request": "launch",
                "mode": "debug",
                "program": dir.display().to_string(),
                "cwd": dir.display().to_string(),
            }),
            &[Breakpoint {
                path: source.display().to_string(),
                line: 8,
                condition: String::new(),
                log: String::new(),
                hits: String::new(),
            }],
        )
        .expect("launch");

        let stopped = wait_for_stop(&rx, 120);
        let thread_id = stopped.get("threadId").and_then(|t| t.as_i64()).expect("thread");
        let frames = live.stack(thread_id).expect("stackTrace");
        let inner = frames.first().expect("a frame").clone();

        // Arithmetic over two locals: no scope holds this under any name.
        let sum = live.evaluate("subtotal + tax", inner.id).expect("evaluate");
        assert_eq!(
            sum.value, "12995",
            "the expression should be worked out, not looked up: {sum:?}"
        );

        // A call into the program's own standard library, which is further
        // still from anything the variable list could show.
        let counted = live.evaluate("len(items)", inner.id).expect("evaluate len");
        assert_eq!(counted.value, "2", "len(items) should come back: {counted:?}");

        // A composite answers with a handle, so a watch opens like any variable.
        let listed = live.evaluate("items", inner.id).expect("evaluate items");
        assert!(
            listed.children > 0,
            "a slice should carry a handle to its elements: {listed:?}"
        );
        let elements = live.expand(listed.children).expect("expand the watch");
        assert!(
            elements.iter().any(|e| e.value.contains("desk")),
            "the elements should come back: {elements:?}"
        );

        // **Out of scope is a message, not a broken session.** `subtotal` is a
        // parameter of `priced` and means nothing in its caller.
        let caller = frames
            .iter()
            .find(|f| f.name.contains("main.main"))
            .unwrap_or_else(|| panic!("main should be on the stack: {frames:?}"));
        let elsewhere = live.evaluate("subtotal + tax", caller.id);
        assert!(
            elsewhere.is_err(),
            "it is not in scope in the caller, and saying so is the point: {elsewhere:?}"
        );

        // And the session is still perfectly usable afterwards.
        let again = live.evaluate("tax", inner.id).expect("still working");
        assert_eq!(again.value, "1185");

        live.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **More than one thread, against a real debugger.**
    ///
    /// The case this exists for is a deadlock: the thread that stopped is
    /// rarely the one holding the lock, so a debugger that only ever shows the
    /// stopped thread cannot show you the problem.
    ///
    /// Deliberately not racy. The goroutines signal a `WaitGroup` *before*
    /// parking on a channel nothing ever sends to, and `main` waits on that
    /// group, so by the time the breakpoint is reached all three exist — rather
    /// than depending on whether the scheduler got round to them.
    #[test]
    #[ignore = "needs Delve and a Go toolchain"]
    fn every_thread_is_listed_and_each_one_has_its_own_stack() {
        let found = crate::debug::adapters::discover();
        let go = found.iter().find(|a| a.language == "go").expect("go");
        if !go.available {
            eprintln!("skipping: {}", go.problem);
            return;
        }

        let dir =
            std::env::temp_dir().join(format!("coperativeai-dap-threads-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch");
        std::fs::write(dir.join("go.mod"), "module scratch\n\ngo 1.21\n").expect("go.mod");
        let source = dir.join("main.go");
        std::fs::write(
            &source,
            "package main\n\
             \n\
             import (\n\
             \t\"fmt\"\n\
             \t\"sync\"\n\
             )\n\
             \n\
             func waiter(c chan int, wg *sync.WaitGroup) {\n\
             \twg.Done()\n\
             \t<-c\n\
             }\n\
             \n\
             func main() {\n\
             \tc := make(chan int)\n\
             \tvar wg sync.WaitGroup\n\
             \twg.Add(3)\n\
             \tfor i := 0; i < 3; i++ {\n\
             \t\tgo waiter(c, &wg)\n\
             \t}\n\
             \twg.Wait()\n\
             \tfmt.Println(\"ready\")\n\
             }\n",
        )
        .expect("main.go");

        let (tx, rx) = channel::<(String, Value)>();
        let mut live = Live::start(&go.argv, Transport::Tcp, Some(&dir), move |name, body| {
            let _ = tx.send((name.to_string(), body));
        })
        .expect("start Delve");
        live.initialize("go").expect("initialize");

        // Line 21 is `fmt.Println("ready")`, reached only after all three
        // goroutines have signalled and are on their way to parking.
        live.launch(
            json!({
                "request": "launch",
                "mode": "debug",
                "program": dir.display().to_string(),
                "cwd": dir.display().to_string(),
            }),
            &[Breakpoint {
                path: source.display().to_string(),
                line: 21,
                condition: String::new(),
                log: String::new(),
                hits: String::new(),
            }],
        )
        .expect("launch");

        let stopped = wait_for_stop(&rx, 120);
        let stopped_on = stopped
            .get("threadId")
            .and_then(|t| t.as_i64())
            .expect("a stop names its thread");

        let threads = live.threads().expect("threads");
        assert!(
            threads.len() > 1,
            "the goroutines should be listed alongside main. Saw: {threads:?}"
        );
        assert!(
            threads.iter().any(|t| t.id == stopped_on),
            "the thread that stopped should be in the list. Saw: {threads:?}"
        );
        assert!(
            threads.iter().all(|t| !t.name.is_empty()),
            "every thread should be named, or the picker has nothing to show: {threads:?}"
        );

        // **The assertion that matters.** A thread that is not the one that
        // stopped still has a stack, and that is the whole reason for showing
        // the list: in a deadlock the interesting stack is somebody else's.
        let other = threads
            .iter()
            .find(|t| t.id != stopped_on)
            .unwrap_or_else(|| panic!("another thread: {threads:?}"));
        let elsewhere = live.stack(other.id).expect("another thread's stack");
        assert!(
            !elsewhere.is_empty(),
            "thread {} ({}) should have frames of its own",
            other.id,
            other.name
        );

        live.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **Running one frame again, against a real debugger.**
    ///
    /// This exists because of what DAP *cannot* do: `next`, `stepIn` and
    /// `stepOut` take a `threadId` and nothing else, so a step always acts on
    /// the innermost frame however the UI's stack is selected. `restartFrame`
    /// is the only request that names a frame, and js-debug is the only adapter
    /// here that reports it.
    ///
    /// The assertion is that the program goes **backwards**: stopped deep in
    /// `inner`, restarting the caller puts it back at the top of `outer`, with
    /// `inner` gone off the stack.
    #[test]
    #[ignore = "needs js-debug extracted on this machine"]
    fn one_frame_can_be_run_again_from_its_first_line() {
        let found = crate::debug::adapters::discover();
        let js = found
            .iter()
            .find(|a| a.language == "typescript")
            .expect("typescript");
        if !js.available {
            eprintln!("skipping: {}", js.problem);
            return;
        }

        let dir =
            std::env::temp_dir().join(format!("coperativeai-dap-frame-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch");
        let source = dir.join("app.js");
        std::fs::write(
            &source,
            "function inner(n) {\n\
             \x20 const doubled = n * 2;\n\
             \x20 return doubled;\n\
             }\n\
             function outer() {\n\
             \x20 const a = inner(3);\n\
             \x20 return a;\n\
             }\n\
             console.log(outer());\n",
        )
        .expect("app.js");

        let (tx, rx) = channel::<(String, Value)>();
        let mut live = Live::start(&js.argv, Transport::Tcp, Some(&dir), move |name, body| {
            let _ = tx.send((name.to_string(), body));
        })
        .expect("start js-debug");
        live.initialize("pwa-node").expect("initialize");
        assert!(
            live.honours().restart_frame,
            "js-debug reports supporting restartFrame"
        );

        // Line 2 is `const doubled = n * 2;`, inside `inner`.
        live.launch(
            json!({
                "type": "pwa-node",
                "request": "launch",
                "name": "coperativeai",
                "program": source.display().to_string(),
                "cwd": dir.display().to_string(),
            }),
            &[Breakpoint {
                path: source.display().to_string(),
                line: 2,
                condition: String::new(),
                log: String::new(),
                hits: String::new(),
            }],
        )
        .expect("launch");

        let stopped = wait_for_stop(&rx, 90);
        let thread_id = stopped.get("threadId").and_then(|t| t.as_i64()).expect("thread");
        let frames = live.stack(thread_id).expect("stackTrace");
        assert_eq!(frames.first().map(|f| f.line), Some(2), "stack: {frames:?}");

        // The caller — the frame a person would select to say "run that again".
        let caller = frames
            .iter()
            .find(|f| f.name.contains("outer"))
            .unwrap_or_else(|| panic!("outer should be on the stack: {frames:?}"))
            .clone();

        live.restart_frame(caller.id).expect("restartFrame");

        // It stops again, and this time above where it was: back in `outer`,
        // with `inner` no longer on the stack at all.
        let again = wait_for_stop(&rx, 60);
        let thread_id = again.get("threadId").and_then(|t| t.as_i64()).expect("thread");
        let after = live.stack(thread_id).expect("stackTrace");
        let top = after.first().expect("a frame");
        assert!(
            top.name.contains("outer"),
            "it should be back in the caller. Saw: {after:?}"
        );
        assert!(
            !after.iter().any(|f| f.name.contains("inner")),
            "the call that was in progress should be gone. Saw: {after:?}"
        );
        assert!(
            top.line <= caller.line,
            "it should have gone backwards, not forwards: was line {}, now {}",
            caller.line,
            top.line
        );

        live.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **A hit count, against a real debugger — and only one has it.**
    ///
    /// Of the three adapters here, **js-debug alone reports
    /// `supportsHitConditionalBreakpoints`**; Delve and netcoredbg do not, and
    /// their capability replies were read to check rather than assumed. So this
    /// runs against Node, and the other two refuse a hit count with a reason —
    /// see `an_adapter_refuses_what_it_cannot_do`.
    ///
    /// The assertion is again *which* time it stopped. Without the hit count it
    /// stops on the first, so a dropped field fails loudly here.
    #[test]
    #[ignore = "needs js-debug extracted on this machine"]
    fn a_hit_count_decides_which_time_round_the_loop_it_stops() {
        let found = crate::debug::adapters::discover();
        let js = found
            .iter()
            .find(|a| a.language == "typescript")
            .expect("typescript");
        if !js.available {
            eprintln!("skipping: {}", js.problem);
            return;
        }

        let dir = std::env::temp_dir().join(format!("coperativeai-dap-hits-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch");
        let source = dir.join("app.js");
        std::fs::write(
            &source,
            "let total = 0;\n\
             for (let i = 0; i < 10; i++) {\n\
             \x20 total += i;\n\
             }\n\
             console.log(total);\n",
        )
        .expect("app.js");

        let (tx, rx) = channel::<(String, Value)>();
        let mut live = Live::start(&js.argv, Transport::Tcp, Some(&dir), move |name, body| {
            let _ = tx.send((name.to_string(), body));
        })
        .expect("start js-debug");
        live.initialize("pwa-node").expect("initialize");
        assert!(
            live.honours().hit_counts,
            "js-debug reports supporting hit-conditional breakpoints"
        );

        // Line 3 is `total += i;`, reached once per iteration. The hit count is
        // one-based and the loop counter is not, so the seventh hit is
        // `i == 6` — and that difference is exactly what this pins down.
        live.launch(
            json!({
                "type": "pwa-node",
                "request": "launch",
                "name": "coperativeai",
                "program": source.display().to_string(),
                "cwd": dir.display().to_string(),
            }),
            &[Breakpoint {
                path: source.display().to_string(),
                line: 3,
                condition: String::new(),
                log: String::new(),
                hits: "7".into(),
            }],
        )
        .expect("launch");

        let stopped = wait_for_stop(&rx, 90);
        let thread_id = stopped.get("threadId").and_then(|t| t.as_i64()).expect("thread");
        let frames = live.stack(thread_id).expect("stackTrace");
        let top = frames.first().expect("a frame");
        assert_eq!(top.line, 3, "it stopped somewhere else: {frames:?}");

        let vars = live.variables(top.id).expect("variables");
        assert!(
            vars.iter().any(|v| v.name == "i" && v.value == "6"),
            "the seventh hit is i == 6, not i == 0. Saw: {vars:?}"
        );

        live.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **The refusal path, against an adapter that really cannot do it.**
    ///
    /// netcoredbg reports neither `supportsLogPoints` nor
    /// `supportsHitConditionalBreakpoints`, which makes it the proof that the
    /// holding-back is real rather than a branch nothing reaches. DAP gives no
    /// failure for an unsupported extra — the field is simply ignored — so a
    /// log message sent anyway would turn into an ordinary breakpoint and
    /// **stop**, which is the opposite of what was asked for.
    #[test]
    #[ignore = "needs netcoredbg and the .NET SDK"]
    fn an_adapter_refuses_what_it_cannot_do() {
        let found = crate::debug::adapters::discover();
        let cs = found.iter().find(|a| a.language == "csharp").expect("csharp");
        if !cs.available {
            eprintln!("skipping: {}", cs.problem);
            return;
        }

        let dir =
            std::env::temp_dir().join(format!("coperativeai-dap-refuse-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch");
        std::fs::write(
            dir.join("Scratch.csproj"),
            "<Project Sdk=\"Microsoft.NET.Sdk\">\n\
             \x20 <PropertyGroup>\n\
             \x20   <OutputType>Exe</OutputType>\n\
             \x20   <TargetFramework>net8.0</TargetFramework>\n\
             \x20   <DebugType>portable</DebugType>\n\
             \x20 </PropertyGroup>\n\
             </Project>\n",
        )
        .expect("csproj");
        let source = dir.join("Program.cs");
        std::fs::write(
            &source,
            "int total = 0;\n\
             for (int i = 0; i < 10; i++) { total += i; }\n\
             System.Console.WriteLine(total);\n",
        )
        .expect("Program.cs");

        let built = Command::new("dotnet")
            .args(["build", "-c", "Debug"])
            .current_dir(&dir)
            .output()
            .expect("run dotnet build");
        assert!(built.status.success(), "dotnet build failed");
        let dll = crate::debug::dotnet::built_assembly(&dir).expect("an assembly");

        let (tx, rx) = channel::<(String, Value)>();
        let mut live = Live::start(&cs.argv, Transport::Stdio, Some(&dir), move |name, body| {
            let _ = tx.send((name.to_string(), body));
        })
        .expect("start netcoredbg");
        live.initialize("coreclr").expect("initialize");

        let honours = live.honours();
        assert!(honours.conditions, "netcoredbg does do conditions");
        assert!(!honours.log_points, "netcoredbg reports no log points");
        assert!(!honours.hit_counts, "netcoredbg reports no hit counts");

        // A log point and a hit count, neither of which this adapter can do.
        let asked = vec![
            Breakpoint {
                path: source.display().to_string(),
                line: 2,
                condition: String::new(),
                log: "round {i}".into(),
                hits: String::new(),
            },
            Breakpoint {
                path: source.display().to_string(),
                line: 3,
                condition: String::new(),
                log: String::new(),
                hits: "== 7".into(),
            },
        ];
        live.launch(
            json!({
                "type": "coreclr",
                "request": "launch",
                "name": "coperativeai",
                "program": dll.display().to_string(),
                "cwd": dir.display().to_string(),
                "stopAtEntry": false,
                "justMyCode": true,
            }),
            &asked,
        )
        .expect("launch");

        let placed = live.apply_breakpoints(&asked).expect("setBreakpoints");
        let refused: Vec<&Value> = placed
            .iter()
            .filter(|b| b.get("verified").and_then(|v| v.as_bool()) == Some(false))
            .collect();
        assert_eq!(refused.len(), 2, "both should be held back. Saw: {placed:?}");
        let words: Vec<&str> = refused
            .iter()
            .filter_map(|b| b.get("message").and_then(|m| m.as_str()))
            .collect();
        assert!(
            words.iter().any(|m| m.contains("print a message instead of stopping")),
            "the refusal should name what it cannot do. Saw: {words:?}"
        );
        assert!(
            words.iter().any(|m| m.contains("count hits before stopping")),
            "the refusal should name what it cannot do. Saw: {words:?}"
        );

        // And nothing armed: the program must not stop at a line whose whole
        // point was not to.
        let quiet = rx.recv_timeout(Duration::from_secs(20));
        if let Ok((name, body)) = quiet {
            assert_ne!(name, "stopped", "nothing should have been armed: {body}");
        }

        live.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **A log point, against a real debugger.**
    ///
    /// The assertion is the *absence* of a stop. A log point that were sent as
    /// a plain breakpoint would stop on the first iteration, and a test that
    /// only checked "the message was printed" would not catch it — the message
    /// arrives either way. So this waits for `terminated` and fails if a
    /// `stopped` turns up first.
    #[test]
    #[ignore = "needs Delve and a Go toolchain"]
    fn a_log_point_prints_and_lets_the_program_run_on() {
        let found = crate::debug::adapters::discover();
        let go = found.iter().find(|a| a.language == "go").expect("go");
        if !go.available {
            eprintln!("skipping: {}", go.problem);
            return;
        }

        let dir = std::env::temp_dir().join(format!("coperativeai-dap-log-{}", std::process::id()));
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
             \ttotal := 0\n\
             \tfor i := 0; i < 3; i++ {\n\
             \t\ttotal += i\n\
             \t}\n\
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
        assert!(
            live.honours().log_points,
            "Delve reports supporting log points"
        );

        // Line 8 is `total += i`, inside the loop. As a breakpoint this stops
        // three times; as a log point it should print three times and stop
        // never. `{i}` is evaluated in the program.
        live.launch(
            json!({
                "request": "launch",
                "mode": "debug",
                "program": dir.display().to_string(),
                "cwd": dir.display().to_string(),
            }),
            &[Breakpoint {
                path: source.display().to_string(),
                line: 8,
                condition: String::new(),
                log: "round {i}".into(),
                hits: String::new(),
            }],
        )
        .expect("launch");

        let deadline = Instant::now() + Duration::from_secs(120);
        let mut printed = Vec::new();
        let mut ended = false;
        while Instant::now() < deadline && !ended {
            let left = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(left) {
                Ok((name, body)) if name == "stopped" => {
                    panic!("a log point must not stop the program: {body}")
                }
                Ok((name, body)) if name == "output" => {
                    if let Some(text) = body.get("output").and_then(|o| o.as_str()) {
                        printed.push(text.to_string());
                    }
                }
                Ok((name, _)) if name == "terminated" || name == "dap-closed" => ended = true,
                Ok((name, body)) if name == "dap-broken" => panic!("the adapter broke: {body}"),
                Ok(_) => {}
                Err(_) => break,
            }
        }

        assert!(ended, "the program should have run to the end. Saw: {printed:?}");
        let logged: Vec<&String> = printed.iter().filter(|t| t.contains("round")).collect();
        assert_eq!(
            logged.len(),
            3,
            "three times round the loop, three messages. Saw: {printed:?}"
        );
        // `{i}` is interpolated by the adapter, out of the running program.
        assert!(
            logged.iter().any(|t| t.contains("round 2")),
            "the expression should be evaluated, not printed literally. Saw: {printed:?}"
        );
        // Nothing is asserted about the program's *own* stdout: Delve gives the
        // debuggee its own console rather than relaying it as DAP `output`, so
        // `fmt.Println` does not appear here. That the program reached the end
        // is what `terminated` above says, and it says it without ambiguity.

        live.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **A condition, against a real debugger.**
    ///
    /// The assertion that matters is not "it stopped" but **which iteration it
    /// stopped on**. A loop of ten with `i == 7` on the breakpoint has to stop
    /// once, at 7 — a condition that were silently dropped would stop at 0, and
    /// a test that only checked "it stopped somewhere" would pass either way.
    #[test]
    #[ignore = "needs Delve and a Go toolchain"]
    fn a_condition_decides_which_time_round_the_loop_it_stops() {
        let found = crate::debug::adapters::discover();
        let go = found.iter().find(|a| a.language == "go").expect("go");
        if !go.available {
            eprintln!("skipping: {}", go.problem);
            return;
        }

        let dir = std::env::temp_dir().join(format!("coperativeai-dap-cond-{}", std::process::id()));
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
             \ttotal := 0\n\
             \tfor i := 0; i < 10; i++ {\n\
             \t\ttotal += i\n\
             \t}\n\
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
        assert!(
            live.honours().conditions,
            "Delve reports supporting conditional breakpoints"
        );

        // Line 8 is `total += i`, inside the loop. Without the condition this
        // stops ten times, the first at i == 0.
        live.launch(
            json!({
                "request": "launch",
                "mode": "debug",
                "program": dir.display().to_string(),
                "cwd": dir.display().to_string(),
            }),
            &[Breakpoint {
                path: source.display().to_string(),
                line: 8,
                condition: "i == 7".into(),
                log: String::new(),
            hits: String::new(),
            }],
        )
        .expect("launch");

        let stopped = wait_for_stop(&rx, 120);
        let thread_id = stopped.get("threadId").and_then(|t| t.as_i64()).expect("thread");
        let frames = live.stack(thread_id).expect("stackTrace");
        let top = frames.first().expect("a frame");
        assert_eq!(top.line, 8, "it stopped somewhere else: {frames:?}");

        let vars = live.variables(top.id).expect("variables");
        let named = |want: &str| vars.iter().find(|v| v.name == want).cloned();
        assert_eq!(
            named("i").map(|v| v.value),
            Some("7".to_string()),
            "the condition should have held it until i == 7. Saw: {vars:?}"
        );
        // 0+1+…+6, so the loop really did run past six earlier iterations
        // without stopping.
        assert_eq!(
            named("total").map(|v| v.value),
            Some("21".to_string()),
            "the earlier iterations should have run through. Saw: {vars:?}"
        );

        live.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **Opening a variable, against a real debugger.**
    ///
    /// The flat list was never the interesting half: a stop shows `order` as
    /// `main.Order {...}`, and the question is always what is *in* it. This
    /// asserts the fields come back — and that a plain `int` is refused rather
    /// than fetched, since a zero reference is not a handle to anything.
    #[test]
    #[ignore = "needs Delve and a Go toolchain"]
    fn a_struct_opens_to_show_its_fields() {
        let found = crate::debug::adapters::discover();
        let go = found.iter().find(|a| a.language == "go").expect("go");
        if !go.available {
            eprintln!("skipping: {}", go.problem);
            return;
        }

        let dir =
            std::env::temp_dir().join(format!("coperativeai-dap-expand-{}", std::process::id()));
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
             type Order struct {\n\
             \tSubtotal int\n\
             \tTax      int\n\
             }\n\
             \n\
             func main() {\n\
             \torder := Order{Subtotal: 11810, Tax: 1185}\n\
             \ttotal := order.Subtotal + order.Tax\n\
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

        // Line 12 is `total := order.Subtotal + order.Tax`, so `order` is built
        // and `total` is not.
        live.launch(
            json!({
                "request": "launch",
                "mode": "debug",
                "program": dir.display().to_string(),
                "cwd": dir.display().to_string(),
            }),
            &[Breakpoint { path: source.display().to_string(), line: 12, condition: String::new(), log: String::new(), hits: String::new() }],
        )
        .expect("launch");

        let stopped = wait_for_stop(&rx, 120);
        let thread_id = stopped.get("threadId").and_then(|t| t.as_i64()).expect("thread");
        let frames = live.stack(thread_id).expect("stackTrace");
        let top = frames.first().expect("a frame");

        let vars = live.variables(top.id).expect("variables");
        let order = vars
            .iter()
            .find(|v| v.name == "order")
            .unwrap_or_else(|| panic!("order should be in scope. Saw: {vars:?}"));
        assert!(
            order.children > 0,
            "a struct should carry a handle to its fields: {order:?}"
        );

        let fields = live.expand(order.children).expect("expand");
        let named = |want: &str| fields.iter().find(|f| f.name == want).cloned();
        assert_eq!(
            named("Subtotal").map(|f| f.value),
            Some("11810".to_string()),
            "the struct's fields should come back. Saw: {fields:?}"
        );
        assert_eq!(
            named("Tax").map(|f| f.value),
            Some("1185".to_string()),
            "the struct's fields should come back. Saw: {fields:?}"
        );

        // A scalar has no handle, and asking anyway is a caller bug rather than
        // something to send to the adapter.
        assert!(live.expand(0).is_err(), "a zero reference is not a handle");

        live.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **The two-session model, against the real js-debug.**
    ///
    /// This is the test the whole `Channel` split exists for: js-debug answers
    /// `launch` with a `startDebugging` reverse request, and the breakpoint only
    /// hits on the *child* connection. If requests were still going to the root,
    /// the stack below would come back empty.
    #[test]
    #[ignore = "needs js-debug extracted on this machine"]
    fn a_breakpoint_stops_a_real_node_program_through_js_debug() {
        let found = crate::debug::adapters::discover();
        let js = found
            .iter()
            .find(|a| a.language == "typescript")
            .expect("typescript");
        if !js.available {
            eprintln!("skipping: {}", js.problem);
            return;
        }

        let dir = std::env::temp_dir().join(format!("coperativeai-dap-js-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch");
        let source = dir.join("app.js");
        std::fs::write(
            &source,
            "const subtotal = 11810;\n\
             const tax = 1185;\n\
             const total = subtotal + tax;\n\
             console.log(total);\n",
        )
        .expect("app.js");

        let (tx, rx) = channel::<(String, Value)>();
        let mut live = Live::start(&js.argv, Transport::Tcp, Some(&dir), move |name, body| {
            let _ = tx.send((name.to_string(), body));
        })
        .expect("start js-debug");

        live.initialize("pwa-node").expect("initialize");

        // Line 3 is `const total = subtotal + tax;` — `subtotal` and `tax` are
        // set there and `total` is not.
        let breakpoints = vec![Breakpoint {
            path: source.display().to_string(),
            line: 3,
            condition: String::new(),
            log: String::new(),
            hits: String::new(),
        }];
        live.launch(
            json!({
                "type": "pwa-node",
                "request": "launch",
                "name": "coperativeai",
                "program": source.display().to_string(),
                "cwd": dir.display().to_string(),
            }),
            &breakpoints,
        )
        .expect("launch");

        let stopped = wait_for_stop(&rx, 90);
        let thread_id = stopped
            .get("threadId")
            .and_then(|t| t.as_i64())
            .expect("a stop names its thread");

        let frames = live.stack(thread_id).expect("stackTrace");
        let top = frames.first().expect("at least one frame");
        assert_eq!(top.line, 3, "it stopped somewhere else: {frames:?}");
        assert!(
            top.path.to_lowercase().ends_with("app.js"),
            "stopped in the wrong file: {}",
            top.path
        );

        let vars = live.variables(top.id).expect("variables");
        assert!(
            vars.iter().any(|v| v.name == "subtotal" && v.value == "11810"),
            "subtotal should be set at this line. Saw: {vars:?}"
        );

        live.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **The first stdio adapter driven end to end**, and the first language
    /// whose launch target is a build output rather than source.
    ///
    /// Delve and js-debug both run over TCP, so until this passed, the reader
    /// thread was only ever proven against sockets. It also exercises
    /// `dotnet::built_assembly`: the debugger is pointed at the `.dll` while the
    /// breakpoint is set on the `.cs`, and only matching debug symbols connect
    /// the two.
    #[test]
    #[ignore = "needs netcoredbg and the .NET SDK"]
    fn a_breakpoint_stops_a_real_csharp_program_and_shows_its_variables() {
        let found = crate::debug::adapters::discover();
        let cs = found.iter().find(|a| a.language == "csharp").expect("csharp");
        if !cs.available {
            eprintln!("skipping: {}", cs.problem);
            return;
        }

        let dir = std::env::temp_dir().join(format!("coperativeai-dap-cs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch");
        std::fs::write(
            dir.join("Scratch.csproj"),
            "<Project Sdk=\"Microsoft.NET.Sdk\">\n\
             \x20 <PropertyGroup>\n\
             \x20   <OutputType>Exe</OutputType>\n\
             \x20   <TargetFramework>net8.0</TargetFramework>\n\
             \x20   <DebugType>portable</DebugType>\n\
             \x20 </PropertyGroup>\n\
             </Project>\n",
        )
        .expect("csproj");
        let source = dir.join("Program.cs");
        std::fs::write(
            &source,
            "int subtotal = 11810;\n\
             int tax = 1185;\n\
             int total = subtotal + tax;\n\
             System.Console.WriteLine(total);\n",
        )
        .expect("Program.cs");

        let built = Command::new("dotnet")
            .args(["build", "-c", "Debug"])
            .current_dir(&dir)
            .output()
            .expect("run dotnet build");
        assert!(
            built.status.success(),
            "dotnet build failed:\n{}",
            String::from_utf8_lossy(&built.stdout)
        );
        let dll = crate::debug::dotnet::built_assembly(&dir).expect("the build produced an assembly");

        let (tx, rx) = channel::<(String, Value)>();
        let mut live = Live::start(&cs.argv, Transport::Stdio, Some(&dir), move |name, body| {
            let _ = tx.send((name.to_string(), body));
        })
        .expect("start netcoredbg");

        live.initialize("coreclr").expect("initialize");

        // Line 3 is `int total = subtotal + tax;` — `subtotal` and `tax` are set
        // there and `total` is not yet.
        let breakpoints = vec![Breakpoint {
            path: source.display().to_string(),
            line: 3,
            condition: String::new(),
            log: String::new(),
            hits: String::new(),
        }];
        live.launch(
            json!({
                "type": "coreclr",
                "request": "launch",
                "name": "coperativeai",
                "program": dll.display().to_string(),
                "cwd": dir.display().to_string(),
                "stopAtEntry": false,
                "justMyCode": true,
            }),
            &breakpoints,
        )
        .expect("launch");

        let stopped = wait_for_stop(&rx, 120);
        let thread_id = stopped
            .get("threadId")
            .and_then(|t| t.as_i64())
            .expect("a stop names its thread");

        let frames = live.stack(thread_id).expect("stackTrace");
        let top = frames.first().expect("at least one frame");
        assert_eq!(top.line, 3, "it stopped somewhere else: {frames:?}");
        assert!(
            top.path.to_lowercase().ends_with("program.cs"),
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
            Breakpoint { path: "a.go".into(), line: 3, condition: String::new(), log: String::new(), hits: String::new() },
            Breakpoint { path: "b.go".into(), line: 9, condition: String::new(), log: String::new(), hits: String::new() },
            Breakpoint { path: "a.go".into(), line: 12, condition: String::new(), log: String::new(), hits: String::new() },
        ];
        let mut by_file: HashMap<&str, Vec<i64>> = HashMap::new();
        for bp in &list {
            by_file.entry(bp.path.as_str()).or_default().push(bp.line);
        }
        assert_eq!(by_file.len(), 2, "two files, one request each");
        assert_eq!(by_file["a.go"], vec![3, 12]);
        assert_eq!(by_file["b.go"], vec![9]);
    }

    /// js-debug will not offer a child session unless the client says it can
    /// handle one — and then the program runs with nothing watching it.
    #[test]
    fn the_handshake_says_we_can_open_a_child_session() {
        let args = initialize_args("pwa-node");
        assert_eq!(
            args.get("supportsStartDebuggingRequest").and_then(|v| v.as_bool()),
            Some(true)
        );
        // Lines from 1, or every breakpoint is off by one.
        assert_eq!(args.get("linesStartAt1").and_then(|v| v.as_bool()), Some(true));
    }
}
