//! What this machine can debug — and, on request, proof that it can.
//!
//! Two commands, and the difference between them is the point:
//!
//! - `debug_adapters` **finds** the adapters. Every candidate is executed, so a
//!   Windows Store stub or an npm shell-script shim is reported missing rather
//!   than present — see `debug::adapters`.
//! - `debug_check` **speaks DAP to one**: it starts the adapter and completes
//!   the `initialize` handshake. Finding a binary that runs is not the same as
//!   finding one that talks the protocol, and the second claim is the one the
//!   breakpoint UI will rest on.
//!
//! Sessions that carry breakpoints and stepping are the next piece. This is the
//! layer they stand on, landed and provable on its own rather than half-built
//! under a gutter that cannot honour a click.

use crate::debug::adapters::{self, AdapterStatus};
use crate::debug::session::Session;
use serde::Serialize;

/// Every language this app can debug, with whether its adapter is installed.
#[tauri::command]
pub async fn debug_adapters() -> Result<Vec<AdapterStatus>, String> {
    // Off the async runtime: this runs several child processes and each one can
    // take a moment, which would otherwise block every other command.
    tauri::async_runtime::spawn_blocking(adapters::discover)
        .await
        .map_err(|e| format!("could not look for debug adapters: {e}"))
}

/// What a handshake proved.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterCheck {
    pub language: String,
    /// True only when the adapter started **and** answered `initialize`.
    pub speaks_dap: bool,
    /// Its own account of what it can do, when it answered.
    pub configuration_done: bool,
    pub conditional_breakpoints: bool,
    pub function_breakpoints: bool,
    /// Why it did not, in words somebody can act on.
    pub problem: String,
    /// Everything the adapter said about itself, verbatim. Shown rather than
    /// summarised because the modelled flags above are the three this app uses
    /// today and an adapter reports a dozen — the rest are the answer to "why
    /// will it not do X?" long before this app models them.
    pub reported: String,
}

/// Starts one language's adapter and completes the DAP handshake with it.
///
/// A real start and a real conversation, then shut down again — so "yes, this
/// machine can debug Go" is a thing that has been demonstrated rather than
/// inferred from a filename.
#[tauri::command]
pub async fn debug_check(language: String) -> Result<AdapterCheck, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let found = adapters::discover();
        let Some(adapter) = found.into_iter().find(|a| a.language == language) else {
            return AdapterCheck {
                language,
                speaks_dap: false,
                configuration_done: false,
                conditional_breakpoints: false,
                function_breakpoints: false,
                problem: "no adapter is configured for that language".into(),
                reported: String::new(),
            };
        };

        if !adapter.available || adapter.argv.is_empty() {
            return AdapterCheck {
                language: adapter.language,
                speaks_dap: false,
                configuration_done: false,
                conditional_breakpoints: false,
                function_breakpoints: false,
                problem: adapter.problem,
                reported: String::new(),
            };
        }

        let (program, args) = adapter.argv.split_first().expect("argv is not empty");
        let started = Session::start(program, args, adapter.transport, None);
        let mut session = match started {
            Ok(session) => session,
            Err(problem) => {
                return AdapterCheck {
                    language: adapter.language,
                    speaks_dap: false,
                    configuration_done: false,
                    conditional_breakpoints: false,
                    function_breakpoints: false,
                    problem,
                    reported: String::new(),
                }
            }
        };

        let outcome = session.initialize(&adapter.language);
        // Always, on both paths: an adapter left running after a check is the
        // same leak a terminal panel would be.
        session.shutdown();

        match outcome {
            Ok(caps) => AdapterCheck {
                language: adapter.language,
                speaks_dap: true,
                configuration_done: caps.configuration_done,
                conditional_breakpoints: caps.conditional_breakpoints,
                function_breakpoints: caps.function_breakpoints,
                problem: String::new(),
                reported: caps.raw,
            },
            Err(problem) => AdapterCheck {
                language: adapter.language,
                speaks_dap: false,
                configuration_done: false,
                conditional_breakpoints: false,
                function_breakpoints: false,
                problem,
                reported: String::new(),
            },
        }
    })
    .await
    .map_err(|e| format!("could not check the debug adapter: {e}"))
}

/* ── Live sessions: breakpoints, stepping, stack and variables ───────────── */

use crate::debug::live::{Breakpoint, Frame, Live, Variable};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// Every debug session this window has going.
///
/// The same shape as `Terminals`, and for the same reason: an adapter is a
/// child process, so it belongs to the app rather than to whichever pane last
/// drew it.
#[derive(Default)]
pub struct DebugSessions(pub Mutex<HashMap<String, Live>>);

/// One event on its way to the window, tagged with the session it came from —
/// two programs stopping at once must not be confused for one.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugEvent {
    session: String,
    event: String,
    body: serde_json::Value,
}

/// What starting a session produced.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedDebug {
    pub session: String,
    pub language: String,
    /// Where each breakpoint actually landed — an adapter slides one to the
    /// next executable line, and showing the requested line instead would be a
    /// lie about where the program will stop.
    pub breakpoints: Vec<serde_json::Value>,
}

/// The launch arguments for one language.
///
/// **Go only, for now.** Delve takes a folder and builds it. js-debug is a
/// *server* that spawns a child adapter per session, which is a different
/// lifecycle rather than different arguments; debugpy and netcoredbg need their
/// own launch shapes too. Each is a small piece of work, and pretending the
/// others already work would produce a session that starts and never stops.
fn launch_arguments(language: &str, program: &str) -> Result<serde_json::Value, String> {
    match language {
        "go" => Ok(serde_json::json!({
            "request": "launch",
            "mode": "debug",
            "program": program,
            "cwd": program,
        })),
        other => Err(format!(
            "launching {other} is not wired up yet — the adapter is found and speaks DAP, but its \
             launch shape is still to do. Go works today."
        )),
    }
}

/// Starts a program under its debugger, with breakpoints already set.
#[tauri::command]
pub async fn debug_start(
    app: AppHandle,
    sessions: State<'_, DebugSessions>,
    language: String,
    program: String,
    breakpoints: Vec<Breakpoint>,
) -> Result<StartedDebug, String> {
    let arguments = launch_arguments(&language, &program)?;
    let found = adapters::discover();
    let Some(adapter) = found.into_iter().find(|a| a.language == language) else {
        return Err(format!("no adapter is configured for {language}"));
    };
    if !adapter.available {
        return Err(adapter.problem);
    }

    let id = format!("dbg-{}-{}", language, crate::db::now_millis());
    let emitter = app.clone();
    let for_event = id.clone();
    let mut live = Live::start(
        &adapter.argv,
        adapter.transport,
        Some(std::path::Path::new(&program)),
        move |event, body| {
            let _ = emitter.emit(
                "debug-event",
                DebugEvent {
                    session: for_event.clone(),
                    event: event.to_string(),
                    body,
                },
            );
        },
    )?;

    live.initialize(&adapter.language)?;
    live.launch(arguments, &breakpoints)?;
    let placed = live.apply_breakpoints(&breakpoints)?;

    sessions
        .0
        .lock()
        .map_err(|_| "the debug sessions are in a bad state".to_string())?
        .insert(id.clone(), live);

    Ok(StartedDebug {
        session: id,
        language,
        breakpoints: placed,
    })
}

/// Replaces the breakpoints of a running session.
#[tauri::command]
pub async fn debug_set_breakpoints(
    sessions: State<'_, DebugSessions>,
    session: String,
    breakpoints: Vec<Breakpoint>,
) -> Result<Vec<serde_json::Value>, String> {
    let held = sessions
        .0
        .lock()
        .map_err(|_| "the debug sessions are in a bad state".to_string())?;
    let Some(live) = held.get(&session) else {
        return Err("that debug session has ended".into());
    };
    live.apply_breakpoints(&breakpoints)
}

/// Continue, or step over / in / out.
#[tauri::command]
pub async fn debug_resume(
    sessions: State<'_, DebugSessions>,
    session: String,
    how: String,
    thread_id: i64,
) -> Result<(), String> {
    let held = sessions
        .0
        .lock()
        .map_err(|_| "the debug sessions are in a bad state".to_string())?;
    let Some(live) = held.get(&session) else {
        return Err("that debug session has ended".into());
    };
    live.resume(&how, thread_id)
}

/// Where the program is stopped.
#[tauri::command]
pub async fn debug_stack(
    sessions: State<'_, DebugSessions>,
    session: String,
    thread_id: i64,
) -> Result<Vec<Frame>, String> {
    let held = sessions
        .0
        .lock()
        .map_err(|_| "the debug sessions are in a bad state".to_string())?;
    let Some(live) = held.get(&session) else {
        return Err("that debug session has ended".into());
    };
    live.stack(thread_id)
}

/// What is in scope in one frame.
#[tauri::command]
pub async fn debug_variables(
    sessions: State<'_, DebugSessions>,
    session: String,
    frame_id: i64,
) -> Result<Vec<Variable>, String> {
    let held = sessions
        .0
        .lock()
        .map_err(|_| "the debug sessions are in a bad state".to_string())?;
    let Some(live) = held.get(&session) else {
        return Err("that debug session has ended".into());
    };
    live.variables(frame_id)
}

/// Ends a session and the program under it.
#[tauri::command]
pub async fn debug_stop(
    sessions: State<'_, DebugSessions>,
    session: String,
) -> Result<(), String> {
    let mut live = {
        let mut held = sessions
            .0
            .lock()
            .map_err(|_| "the debug sessions are in a bad state".to_string())?;
        match held.remove(&session) {
            Some(live) => live,
            None => return Ok(()),
        }
    };
    live.stop();
    Ok(())
}
