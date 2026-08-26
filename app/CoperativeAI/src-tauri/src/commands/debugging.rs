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
    /// Printing a message instead of stopping, and counting hits first.
    ///
    /// Reported for the same reason as the condition flag: this app offers all
    /// three on every breakpoint, and an adapter that cannot do one of them
    /// holds that breakpoint back. Saying which up front beats finding out on
    /// starting — and these two are where the adapters actually differ.
    pub log_points: bool,
    pub hit_counts: bool,
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
                log_points: false,
                hit_counts: false,
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
                log_points: false,
                hit_counts: false,
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
                    log_points: false,
                    hit_counts: false,
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
                log_points: caps.log_points,
                hit_counts: caps.hit_counts,
                problem: String::new(),
                reported: caps.raw,
            },
            Err(problem) => AdapterCheck {
                language: adapter.language,
                speaks_dap: false,
                configuration_done: false,
                conditional_breakpoints: false,
                function_breakpoints: false,
                log_points: false,
                hit_counts: false,
                problem,
                reported: String::new(),
            },
        }
    })
    .await
    .map_err(|e| format!("could not check the debug adapter: {e}"))
}

/* ── Live sessions: breakpoints, stepping, stack and variables ───────────── */

use crate::debug::live::{Breakpoint, Frame, Live, Thread, Variable};
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
    /// Whether this adapter will evaluate a breakpoint condition.
    ///
    /// Reported so the editor can say "this debugger cannot do that" rather
    /// than offering a box whose contents would be dropped on the floor.
    pub conditions: bool,
    /// Whether it will print a message instead of stopping.
    pub log_points: bool,
    /// Whether it will count hits before honouring a breakpoint.
    pub hit_counts: bool,
    /// Whether one frame can be run again from its first line — the only thing
    /// DAP offers that acts on a frame rather than a thread.
    pub restart_frame: bool,
    /// Whether it answers an `evaluate` sent because a pointer moved.
    pub hovers: bool,
    /// Whether a named value can be changed in its container, and whether
    /// whatever an expression denotes can be. Not the same question: Delve
    /// reports the first and not the second.
    pub set_variable: bool,
    pub set_expression: bool,
    /// A caveat about this particular launch, or empty.
    ///
    /// **Not an error and not a capability** — something true about what is
    /// running that somebody would otherwise discover by being confused. So far
    /// only C# has one, when the only build available was optimised.
    pub note: String,
}

/// The Solution's "start from", resolved against its working copy.
///
/// **Checked to exist, and refused loudly when it does not.** This field is set
/// once and then forgotten, so the file it names outlives the memory of naming
/// it — a rename or a moved folder would otherwise hand the adapter a path that
/// is not there, and every adapter answers that differently and badly. Delve
/// says the package is not there, debugpy exits at once with nothing on the
/// console, and netcoredbg stops at no breakpoints at all. One clear refusal
/// here beats three different confusions.
///
/// Relative paths are resolved against the working copy, because that is how
/// somebody would write it — `src/main.py`, not the whole absolute path. An
/// absolute one is taken as given.
fn named_start(program: &str, start_from: Option<&str>) -> Result<Option<String>, String> {
    let Some(named) = start_from.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let asked = std::path::Path::new(named);
    let resolved = if asked.is_absolute() {
        asked.to_path_buf()
    } else {
        // Written with forward slashes by habit even on Windows; joining each
        // segment makes `src/main.py` a path rather than one odd filename.
        //
        // **`..` is resolved rather than joined on.** A relative path is
        // allowed to leave the repository — a sibling checkout is a real
        // answer, and the UI says it will not travel — but joining the segments
        // blindly produces `C:\repos\orders\..\..\shared\serve.py`, and that is
        // what a refusal would then quote back at somebody. It exists or it
        // does not either way; only the sentence differs.
        let mut path = std::path::PathBuf::from(program);
        for part in named.split(['/', '\\']) {
            match part {
                "" | "." => {}
                ".." => {
                    // Never above the root of the drive: popping an empty path
                    // would silently turn `../..` into the current directory.
                    if !path.pop() {
                        return Err(format!(
                            "this Solution says to start from '{named}', which climbs above {}. \
                             There is nothing above it to point at.",
                            program
                        ));
                    }
                }
                part => path = path.join(part),
            }
        }
        path
    };
    if !resolved.exists() {
        return Err(format!(
            "this Solution says to start from '{named}', and there is nothing at {}. Point it at \
             something that is there, or clear it to let the debugger work it out.",
            resolved.display()
        ));
    }
    Ok(Some(resolved.display().to_string()))
}

/// The launch arguments for one language.
///
/// **All four now, and they differ more than "different arguments" suggests.**
/// Delve is given a folder and builds it; js-debug is given a `.js` and answers
/// with a `startDebugging` reverse request, so the lifecycle differs too;
/// netcoredbg is given a **built assembly**, which has to exist already; and
/// debugpy is given one `.py` file, which is the hard part — a folder of Python
/// says nothing about which file is the program.
///
/// `interpreter` is the adapter's own executable, which for Python is the
/// interpreter that was proved to have debugpy importable. The others do not
/// need it.
fn launch_arguments(
    language: &str,
    program: &str,
    interpreter: &str,
    start_from: Option<&str>,
) -> Result<(serde_json::Value, String), String> {
    let plain = |v: serde_json::Value| Ok((v, String::new()));
    // What the Solution says to start, resolved against the working copy and
    // checked to exist. Absent when nobody has said, which is the ordinary case
    // and leaves each language to work it out.
    let named = named_start(program, start_from)?;
    match language {
        // Delve takes a package: the folder is right for the common case, and
        // a named one points at the `cmd/…` that actually has the `main`.
        "go" => plain(serde_json::json!({
            "request": "launch",
            "mode": "debug",
            "program": named.clone().unwrap_or_else(|| program.to_string()),
            "cwd": program,
        })),
        // js-debug wants the file rather than the folder, and answers this with
        // a `startDebugging` reverse request — see `debug::live`, which opens
        // the child session that actually runs the program.
        "typescript" => plain(serde_json::json!({
            "type": "pwa-node",
            "request": "launch",
            "name": "CoperativeAI",
            "program": named.clone().unwrap_or_else(|| program.to_string()),
            "cwd": std::path::Path::new(program)
                .parent()
                .map(|d| d.display().to_string())
                .unwrap_or_else(|| program.to_string()),
        })),
        // netcoredbg debugs the **built assembly**, so unlike Go and TypeScript
        // there is a step that has to have happened first. Saying "build it"
        // plainly beats launching a debugger that stops at nothing.
        "csharp" => {
            let root = std::path::Path::new(program);
            // A named assembly is taken as given: somebody who points at one
            // `.dll` in a solution of several has answered the question the
            // search exists to guess at, and there is no configuration to infer
            // from a path they chose.
            let found = match &named {
                Some(dll) => Some((std::path::PathBuf::from(dll), "the one you named".to_string())),
                None => crate::debug::dotnet::built_assembly(root),
            };
            let Some((dll, configuration)) = found else {
                return Err(format!(
                    "nothing has been built in {} yet. C# is debugged through its compiled \
                     assembly, so run `dotnet build` there first — or name the assembly to start \
                     from on the Solution.",
                    root.display()
                ));
            };
            // **Said rather than refused.** Debugging optimised code is a poor
            // experience but not a useless one, and somebody with only a
            // Release build may have a good reason. What must not happen is
            // finding out by watching the debugger stop on the wrong line and
            // deciding this app is broken.
            let note = if named.is_some() {
                // Nothing to warn about: nothing was guessed. Saying which
                // assembly is running still earns its place, because "start
                // from" is set once and then forgotten.
                format!("Debugging {}, named on this Solution.", dll.display())
            } else if configuration.eq_ignore_ascii_case("debug") {
                String::new()
            } else {
                format!(
                    "Only a {configuration} build was found, so that is what is being debugged. \
                     The compiler moves lines around and drops locals when it optimises, so \
                     expect stops on unexpected lines and variables that are not there. Run \
                     `dotnet build` for a Debug build."
                )
            };
            Ok((
                serde_json::json!({
                    "type": "coreclr",
                    "request": "launch",
                    "name": "CoperativeAI",
                    "program": dll.display().to_string(),
                    "cwd": program,
                    "stopAtEntry": false,
                    "justMyCode": true,
                }),
                note,
            ))
        }
        // **The hard one, and not for protocol reasons.** Go is handed a folder
        // and Delve builds it; C# is handed a built assembly, which either
        // exists or does not. debugpy runs exactly one `.py`, and a folder of
        // Python says nothing about which file that is — so the entry point is
        // found by convention and refused rather than guessed at, because a
        // debugger pointed at the wrong file starts, runs something, and stops
        // at none of the breakpoints.
        "python" => {
            let root = std::path::Path::new(program);
            let script = match &named {
                Some(path) => std::path::PathBuf::from(path),
                None => crate::debug::python::entry_script(root)?,
            };
            // Said when it was not the obvious one. A wrong guess presents as
            // breakpoints that never hit, and naming the file turns that from a
            // mystery into an easy correction — and a file somebody named is
            // worth confirming for the same reason, since it is set once and
            // then forgotten.
            let note = if named.is_some() {
                format!("Debugging {}, named on this Solution.", script.display())
            } else if script == root.join("main.py") {
                String::new()
            } else {
                format!(
                    "Debugging {}, chosen because it is the first thing in this folder that looks \
                     like the program. If that is the wrong file, name one to start from on this \
                     Solution.",
                    script.display()
                )
            };
            Ok((
                serde_json::json!({
                    "type": "python",
                    "request": "launch",
                    "name": "CoperativeAI",
                    "program": script.display().to_string(),
                    "cwd": program,
                    // **The interpreter that was proved to have debugpy.** Left
                    // unset, debugpy runs the program with whatever it resolves
                    // itself — which on Windows is routinely a different Python
                    // from the one the search found, and the program then fails
                    // on imports that are plainly installed.
                    "python": interpreter,
                    // Output comes back as DAP `output` events, which is what
                    // the console pane reads. `integratedTerminal` would need
                    // the client to spawn a terminal for the adapter, and this
                    // app does not hand it one.
                    "console": "internalConsole",
                    "redirectOutput": true,
                    // Stepping stays in the code somebody wrote, matching C#.
                    "justMyCode": true,
                }),
                note,
            ))
        }
        other => Err(format!(
            "launching {other} is not wired up yet — the adapter is found and speaks DAP, but its \
             launch shape is still to do. Go, Python, TypeScript and C# work today."
        )),
    }
}

/// Starts a program under its debugger, with breakpoints already set.
#[tauri::command]
pub async fn debug_start(
    app: AppHandle,
    db: State<'_, super::AppDb>,
    sessions: State<'_, DebugSessions>,
    language: String,
    program: String,
    // `solution_id` is the Solution being debugged, so its "start from" can be
    // honoured. None where there is not one.
    solution_id: Option<i64>,
    breakpoints: Vec<Breakpoint>,
) -> Result<StartedDebug, String> {
    let start_from = match solution_id {
        Some(id) => {
            let conn = db.0.lock().await;
            crate::db::solution::find_by_id(&conn, id)
                .await
                .map_err(super::to_message)?
                .and_then(|s| s.start_from)
        }
        None => None,
    };
    // The adapter first: Python's launch shape needs the interpreter that was
    // proved to have debugpy, and there is no point resolving an entry script
    // for a debugger that is not on this machine either way.
    let found = adapters::discover();
    let Some(adapter) = found.into_iter().find(|a| a.language == language) else {
        return Err(format!("no adapter is configured for {language}"));
    };
    if !adapter.available {
        return Err(adapter.problem);
    }
    let (arguments, note) = launch_arguments(
        &language,
        &program,
        adapter.argv.first().map_or("", |s| s.as_str()),
        start_from.as_deref(),
    )?;

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

    let honours = live.honours();
    sessions
        .0
        .lock()
        .map_err(|_| "the debug sessions are in a bad state".to_string())?
        .insert(id.clone(), live);

    Ok(StartedDebug {
        session: id,
        language,
        breakpoints: placed,
        conditions: honours.conditions,
        log_points: honours.log_points,
        hit_counts: honours.hit_counts,
        restart_frame: honours.restart_frame,
        hovers: honours.hovers,
        set_variable: honours.set_variable,
        set_expression: honours.set_expression,
        note,
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

/// Opens one variable, giving its own fields.
///
/// The reference comes from a variable the UI is already showing, and is only
/// valid while the program is stopped where it was handed out — the adapter
/// invalidates every handle the moment it moves. Asking after a step gets an
/// error rather than someone else's memory.
#[tauri::command]
pub async fn debug_expand(
    sessions: State<'_, DebugSessions>,
    session: String,
    reference: i64,
) -> Result<Vec<Variable>, String> {
    let held = sessions
        .0
        .lock()
        .map_err(|_| "the debug sessions are in a bad state".to_string())?;
    let Some(live) = held.get(&session) else {
        return Err("that debug session has ended".into());
    };
    live.expand(reference)
}

/// Works out what an expression comes to, in one frame.
///
/// The thing the variable list cannot do: it shows what happens to have a name
/// in scope, and a watch shows what somebody wants to know.
///
/// **Errors are the ordinary case, not a failure of the session.** A watch that
/// is out of scope in the frame you have selected is a normal thing to be
/// looking at — you set it for a different frame — so the message comes back to
/// be shown against that one expression rather than raised over the panel.
///
/// `context` is `"watch"` from the watch pane and `"hover"` from the editor.
/// Not a label: it changes what the adapter is willing to do, and `"hover"` is
/// refused outright where the adapter has not said it answers them.
#[tauri::command]
pub async fn debug_evaluate(
    sessions: State<'_, DebugSessions>,
    session: String,
    expression: String,
    frame_id: i64,
    context: String,
) -> Result<Variable, String> {
    let held = sessions
        .0
        .lock()
        .map_err(|_| "the debug sessions are in a bad state".to_string())?;
    let Some(live) = held.get(&session) else {
        return Err("that debug session has ended".into());
    };
    live.evaluate(&expression, frame_id, &context)
}

/// Puts a new value into a named variable, in its container.
///
/// **This writes into a running program.** The value is written in the
/// debuggee's own language and parsed by the adapter, and what comes back is
/// what it actually became — which is not always what was asked for.
#[tauri::command]
pub async fn debug_set_variable(
    sessions: State<'_, DebugSessions>,
    session: String,
    parent: i64,
    name: String,
    value: String,
) -> Result<Variable, String> {
    let held = sessions
        .0
        .lock()
        .map_err(|_| "the debug sessions are in a bad state".to_string())?;
    let Some(live) = held.get(&session) else {
        return Err("that debug session has ended".into());
    };
    live.set_variable(parent, &name, &value)
}

/// Puts a new value into whatever an expression denotes.
///
/// A different request from `debug_set_variable`, not a fallback for it: that
/// one names a variable by its container and so cannot reach
/// `order.Items[0].Price`.
#[tauri::command]
pub async fn debug_set_expression(
    sessions: State<'_, DebugSessions>,
    session: String,
    expression: String,
    frame_id: i64,
    value: String,
) -> Result<Variable, String> {
    let held = sessions
        .0
        .lock()
        .map_err(|_| "the debug sessions are in a bad state".to_string())?;
    let Some(live) = held.get(&session) else {
        return Err("that debug session has ended".into());
    };
    live.set_expression(&expression, frame_id, &value)
}

/// Every thread the program has.
///
/// Read at each stop rather than kept: threads come and go, and DAP's `thread`
/// events are advisory — an adapter need not send one for every start and exit.
#[tauri::command]
pub async fn debug_threads(
    sessions: State<'_, DebugSessions>,
    session: String,
) -> Result<Vec<Thread>, String> {
    let held = sessions
        .0
        .lock()
        .map_err(|_| "the debug sessions are in a bad state".to_string())?;
    let Some(live) = held.get(&session) else {
        return Err("that debug session has ended".into());
    };
    live.threads()
}

/// Runs one frame again from its first line.
///
/// The only per-frame operation there is: stepping takes a thread and so always
/// acts on the innermost frame, whichever one is selected.
#[tauri::command]
pub async fn debug_restart_frame(
    sessions: State<'_, DebugSessions>,
    session: String,
    frame_id: i64,
) -> Result<(), String> {
    let held = sessions
        .0
        .lock()
        .map_err(|_| "the debug sessions are in a bad state".to_string())?;
    let Some(live) = held.get(&session) else {
        return Err("that debug session has ended".into());
    };
    live.restart_frame(frame_id)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// **The shape debugpy actually needs.** It runs one file, so `program` is
    /// a `.py` and not the folder — the mistake that would present as a
    /// debugger stopping at none of the breakpoints.
    #[test]
    fn python_launches_one_file_with_the_interpreter_that_has_debugpy() {
        let root = std::env::temp_dir().join(format!("coperativeai-launch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("temp");
        std::fs::write(root.join("main.py"), "print('x')\n").expect("write");

        let (arguments, note) = launch_arguments(
            "python",
            &root.display().to_string(),
            "C:/Python312/python.exe",
            None,
        )
        .expect("a shape");

        assert_eq!(arguments["type"], "python");
        assert_eq!(arguments["request"], "launch");
        assert_eq!(
            arguments["program"],
            root.join("main.py").display().to_string(),
            "the file, not the folder"
        );
        assert_eq!(arguments["cwd"], root.display().to_string());
        // The interpreter proved to have debugpy, not whatever debugpy would
        // resolve for itself — on Windows those are routinely different.
        assert_eq!(arguments["python"], "C:/Python312/python.exe");
        // Output has to arrive as DAP events, because that is what the console
        // pane reads; an integrated terminal would need one to be handed over.
        assert_eq!(arguments["console"], "internalConsole");
        assert_eq!(arguments["redirectOutput"], true);
        // main.py is the obvious answer, so nothing to say about it.
        assert_eq!(note, "");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// A file chosen by convention is named, because a wrong guess otherwise
    /// presents as breakpoints that never hit.
    #[test]
    fn a_less_obvious_entry_point_is_named() {
        let root = std::env::temp_dir().join(format!("coperativeai-launch2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("temp");
        std::fs::write(root.join("manage.py"), "print('x')\n").expect("write");

        let (_, note) =
            launch_arguments("python", &root.display().to_string(), "python", None).expect("a shape");
        assert!(note.contains("manage.py"), "got: {note}");
        // It points at the escape hatch rather than telling somebody to rename
        // their file, which is what it used to say.
        assert!(note.contains("name one to start from"), "got: {note}");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Refused rather than pointed at something arbitrary — the refusal carries
    /// the list of what was looked for.
    #[test]
    fn a_folder_with_no_program_in_it_is_refused() {
        let root = std::env::temp_dir().join(format!("coperativeai-launch3-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("temp");
        std::fs::write(root.join("helpers.py"), "x = 1\n").expect("write");

        let err = launch_arguments("python", &root.display().to_string(), "python", None)
            .expect_err("nothing to start");
        assert!(err.contains("main.py"), "got: {err}");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// **The escape hatch from the convention.** A project that starts from
    /// `serve.py` was getting a refusal and being asked to rename its file;
    /// naming it on the Solution is the answer, and it wins over every guess.
    #[test]
    fn a_named_start_beats_the_convention() {
        let root = std::env::temp_dir().join(format!("coperativeai-start-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("temp");
        // Both exist, and the convention would take main.py.
        std::fs::write(root.join("main.py"), "print('x')\n").expect("write");
        std::fs::write(root.join("serve.py"), "print('x')\n").expect("write");

        let (arguments, note) = launch_arguments(
            "python",
            &root.display().to_string(),
            "python",
            Some("serve.py"),
        )
        .expect("a shape");

        assert_eq!(arguments["program"], root.join("serve.py").display().to_string());
        // Set once and then forgotten, so it is worth confirming.
        assert!(note.contains("serve.py"), "got: {note}");
        assert!(note.contains("named on this Solution"), "got: {note}");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Written the way somebody would write it — `src/main.py`, not the whole
    /// absolute path — and resolved against the working copy.
    #[test]
    fn a_relative_start_is_resolved_against_the_working_copy() {
        let root = std::env::temp_dir().join(format!("coperativeai-start2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("api")).expect("temp");
        std::fs::write(root.join("api").join("serve.py"), "print('x')\n").expect("write");

        let (arguments, _) = launch_arguments(
            "python",
            &root.display().to_string(),
            "python",
            // Forward slashes, as somebody types them even on Windows.
            Some("api/serve.py"),
        )
        .expect("a shape");

        assert_eq!(
            arguments["program"],
            root.join("api").join("serve.py").display().to_string()
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A sibling checkout is a real answer, so `..` is resolved rather than
    /// joined on — otherwise a refusal quotes back
    /// `C:\repos\orders\..\..\shared\serve.py`, which is nobody's idea of a
    /// helpful message.
    #[test]
    fn a_relative_start_may_climb_out_of_the_working_copy() {
        let root = std::env::temp_dir().join(format!("coperativeai-climb-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let repo = root.join("orders");
        std::fs::create_dir_all(&repo).expect("temp");
        std::fs::create_dir_all(root.join("shared")).expect("temp");
        std::fs::write(root.join("shared").join("serve.py"), "print('x')\n").expect("write");

        let (arguments, _) = launch_arguments(
            "python",
            &repo.display().to_string(),
            "python",
            Some("../shared/serve.py"),
        )
        .expect("a sibling is a real answer");

        // Resolved, not joined: no `..` left in what the adapter is handed.
        let program = arguments["program"].as_str().expect("a program");
        assert!(!program.contains(".."), "got: {program}");
        assert_eq!(program, root.join("shared").join("serve.py").display().to_string());

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Climbing above the root of the drive is not a place. Popping an empty
    /// path would silently turn `../../..` into the current directory.
    #[test]
    fn a_start_that_climbs_off_the_top_is_refused() {
        let err = launch_arguments("python", "C:", "python", Some("../../../x.py"))
            .expect_err("nowhere to go");
        assert!(err.contains("climbs above"), "got: {err}");
    }

    /// **Set once and then forgotten**, so the file it names outlives the
    /// memory of naming it. A rename would otherwise hand the adapter a path
    /// that is not there, and every adapter answers that differently and badly.
    #[test]
    fn a_start_pointing_at_nothing_is_refused_clearly() {
        let root = std::env::temp_dir().join(format!("coperativeai-start3-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("temp");
        std::fs::write(root.join("main.py"), "print('x')\n").expect("write");

        let err = launch_arguments(
            "python",
            &root.display().to_string(),
            "python",
            Some("gone.py"),
        )
        .expect_err("nothing there");

        assert!(err.contains("gone.py"), "got: {err}");
        assert!(err.contains("clear it"), "it says how to get out of it: {err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// It is not a Python field. Every language is handed the thing it starts,
    /// and a field that quietly worked for one of four would be worse than none.
    #[test]
    fn every_language_honours_a_named_start() {
        let root = std::env::temp_dir().join(format!("coperativeai-start4-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("cmd")).expect("temp");
        std::fs::write(root.join("cmd").join("app.js"), "//\n").expect("write");

        let here = root.display().to_string();
        let named = root.join("cmd").join("app.js").display().to_string();

        let (go, _) = launch_arguments("go", &here, "", Some("cmd/app.js")).expect("go");
        assert_eq!(go["program"], named);
        // …and the working copy is still the cwd, so relative reads behave.
        assert_eq!(go["cwd"], here);

        let (ts, _) = launch_arguments("typescript", &here, "", Some("cmd/app.js")).expect("ts");
        assert_eq!(ts["program"], named);

        let (cs, note) = launch_arguments("csharp", &here, "", Some("cmd/app.js")).expect("c#");
        assert_eq!(cs["program"], named);
        // Nothing was guessed, so there is no Release warning to give — but the
        // assembly is still named, because this is set once and forgotten.
        assert!(note.contains("named on this Solution"), "got: {note}");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// The message that says what is not built yet has to stay true as shapes
    /// are added, or it sends somebody looking for a feature that exists.
    #[test]
    fn an_unknown_language_names_the_ones_that_work() {
        let err = launch_arguments("elixir", "C:/repo", "", None).expect_err("no shape");
        for language in ["Go", "Python", "TypeScript", "C#"] {
            assert!(err.contains(language), "{language} is missing from: {err}");
        }
    }
}
