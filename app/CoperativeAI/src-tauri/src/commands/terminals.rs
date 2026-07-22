//! Terminal panels: open a shell in a Solution's folder and stream it to the UI.
//!
//! Every session gets a **dedicated reader thread**, because a PTY read blocks
//! when the shell has nothing to say. Anything that tried to poll instead would
//! either spin or freeze the async runtime, and there is no non-blocking read to
//! reach for.
//!
//! Output travels as Tauri events rather than as command return values: the
//! shell speaks when it feels like it, and a request/response call cannot carry
//! that. **Nothing here logs the output** — it can contain anything a developer
//! pastes, and the page brief is explicit that it is never persisted.
//!
//! A `std::sync::Mutex` holds the sessions rather than a tokio one: every use is
//! a short, non-async lock around a write or a resize, and mixing an async lock
//! into a synchronous reader thread would buy nothing but a way to deadlock.

use crate::terminal::{default_shell, Session};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// Every open panel, by id.
#[derive(Default)]
pub struct Terminals(pub Mutex<HashMap<String, Session>>);

/// A chunk of shell output on its way to the window.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    id: String,
    data: String,
}

/// The panel that was opened.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedTerminal {
    pub id: String,
    /// The shell that was started, so the panel can say what it is.
    pub shell: String,
    pub cwd: String,
}

/// Opens a shell in a Solution's working copy.
#[tauri::command]
pub async fn open_terminal(
    app: AppHandle,
    db: State<'_, super::AppDb>,
    terminals: State<'_, Terminals>,
    solution_id: i64,
    cols: u16,
    rows: u16,
) -> Result<OpenedTerminal, String> {
    let cwd = {
        let conn = db.0.lock().await;
        let Some(row) = crate::db::solution::find_by_id(&conn, solution_id)
            .await
            .map_err(super::to_message)?
        else {
            return Err("that Solution no longer exists".into());
        };
        row.local_path
            .filter(|p| !p.trim().is_empty())
            .ok_or_else(|| {
                format!(
                    "'{}' has no folder on this machine yet — point it at a working copy \
                     before opening a terminal in it",
                    row.name
                )
            })?
    };

    let shell = default_shell();
    // A fresh id per panel, not per Solution: two terminals on one repository is
    // an ordinary thing to want.
    let id = format!("term-{}-{}", solution_id, crate::db::now_millis());
    let (session, mut reader) = Session::spawn(
        &shell,
        std::path::Path::new(&cwd),
        cols.max(20),
        rows.max(5),
    )?;

    let emitter = app.clone();
    let stream_id = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match std::io::Read::read(&mut reader, &mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    // Lossy on purpose: a PTY can split a multi-byte character
                    // across two reads, and refusing to forward the chunk would
                    // stall the panel over one character.
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    if emitter
                        .emit(
                            "terminal-output",
                            Output {
                                id: stream_id.clone(),
                                data,
                            },
                        )
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        // The shell ended — someone typed `exit`, or it was killed.
        let _ = emitter.emit("terminal-closed", stream_id.clone());
    });

    terminals
        .0
        .lock()
        .map_err(|_| "the terminal list is in a bad state".to_string())?
        .insert(id.clone(), session);

    Ok(OpenedTerminal { id, shell, cwd })
}

/// Sends keystrokes to a panel.
#[tauri::command]
pub async fn write_terminal(
    terminals: State<'_, Terminals>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = terminals
        .0
        .lock()
        .map_err(|_| "the terminal list is in a bad state".to_string())?;
    let Some(session) = sessions.get_mut(&id) else {
        return Err("that terminal is not open any more".into());
    };
    session.write(&data)
}

/// Tells the shell the panel's new size, so it stops wrapping at the old width.
#[tauri::command]
pub async fn resize_terminal(
    terminals: State<'_, Terminals>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut sessions = terminals
        .0
        .lock()
        .map_err(|_| "the terminal list is in a bad state".to_string())?;
    let Some(session) = sessions.get_mut(&id) else {
        // A resize arriving after the shell exited is ordinary, not an error
        // worth showing anyone.
        return Ok(());
    };
    session.resize(cols.max(20), rows.max(5))
}

/// Closes a panel and ends its shell.
#[tauri::command]
pub async fn close_terminal(terminals: State<'_, Terminals>, id: String) -> Result<(), String> {
    let mut session = {
        let mut sessions = terminals
            .0
            .lock()
            .map_err(|_| "the terminal list is in a bad state".to_string())?;
        match sessions.remove(&id) {
            Some(session) => session,
            None => return Ok(()),
        }
    };
    // A shell someone already ended with `exit` needs no killing, and reporting
    // a failure to kill a dead process would be a confusing way to say "closed".
    if session.finished() {
        return Ok(());
    }
    session.kill()
}
