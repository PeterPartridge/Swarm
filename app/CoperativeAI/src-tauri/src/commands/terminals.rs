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
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

/// Recent output, kept so a panel that was closed and reopened can catch up.
///
/// **In memory, bounded, and never written anywhere.** The page brief's rule is
/// that terminal output is not persisted, because it can contain anything a
/// developer pastes — that still holds: this dies with the process, exactly as
/// the xterm widget's own scrollback used to. What changed is only *which*
/// thing it dies with. Without it, a Debug panel reattaching to a dev server
/// that has been up for an hour shows an empty box, which reads as a shell that
/// failed rather than one that is fine and simply not being watched.
#[derive(Default)]
pub struct Replay(String);

impl Replay {
    /// Roughly a screen of scrollback. Enough to see why something died;
    /// nowhere near enough to be a log.
    const CAP: usize = 64 * 1024;

    fn push(&mut self, chunk: &str) {
        self.0.push_str(chunk);
        if self.0.len() <= Self::CAP {
            return;
        }
        // Trim from the front, landing on a character boundary — a PTY chunk
        // can split a multi-byte character and `drain` on a byte index inside
        // one would panic.
        let want = self.0.len() - Self::CAP;
        let at = (want..=self.0.len())
            .find(|i| self.0.is_char_boundary(*i))
            .unwrap_or(self.0.len());
        self.0.drain(..at);
    }

    fn text(&self) -> String {
        self.0.clone()
    }
}

/// One shell this app started, with what the UI needs to find it again.
pub struct Running {
    session: Session,
    solution_id: i64,
    shell: String,
    cwd: String,
    started_at: i64,
    replay: Arc<Mutex<Replay>>,
}

/// Every open panel, by id.
///
/// **This is the process registry.** The shells always lived here rather than in
/// the window — Tauri manages this state for the life of the app — but nothing
/// could ask what was in it, so a panel that unmounted had no way back to its
/// own shell and closed it instead. `list_terminals` and `attach_terminal` are
/// that way back.
#[derive(Default)]
pub struct Terminals(pub Mutex<HashMap<String, Running>>);

/// A shell that is still running, as the UI sees it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningTerminal {
    pub id: String,
    pub solution_id: i64,
    pub shell: String,
    pub cwd: String,
    /// When this app started it. The only start it can honestly claim to know.
    pub started_at: i64,
}

/// A shell being picked up again, with enough recent output to make sense of.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachedTerminal {
    pub id: String,
    pub solution_id: i64,
    pub shell: String,
    pub cwd: String,
    pub started_at: i64,
    /// What it has said lately, to write into the fresh widget.
    pub replay: String,
}

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
    spawn_terminal(&app, &terminals, solution_id, &cwd, cols, rows)
}

/// Opens a terminal and starts the Claude Code sign-in in it.
///
/// **The answer to "why can't the app just do this?"** — it can, and this is
/// it. Signing in opens a browser and then waits for a person to come back and
/// confirm, so it cannot be a silent background call; what it needs is a
/// terminal somebody is looking at, and this app has had real ones since the
/// process registry landed. The claim in `ai::claude_code` that there was no
/// terminal to run a login in was true when it was written and is not now.
///
/// The command is **typed into a shell** rather than run as the terminal's own
/// program, because that is what makes it recoverable: the login can be
/// answered, abandoned, and run again in the same panel, and whatever it prints
/// stays on screen afterwards. A PTY that *was* the login would close on the
/// first mistake and take the reason with it.
///
/// Opened in the home folder, which always exists — this is about the machine's
/// sign-in rather than about any one Solution.
#[tauri::command]
pub async fn open_claude_sign_in(
    app: AppHandle,
    terminals: State<'_, Terminals>,
    executable: String,
    cols: u16,
    rows: u16,
) -> Result<OpenedTerminal, String> {
    // Discovery runs first: a sign-in typed into a shell that has no `claude`
    // on its PATH fails as "command not found", which reads as a broken app
    // rather than a missing install.
    let argv = crate::ai::claude_code::sign_in_command(&executable).await?;
    let home = crate::ai::claude_code::home_dir()
        .ok_or_else(|| "this machine reports no home folder to open a terminal in".to_string())?;

    // Solution zero: this terminal belongs to the machine, not to a repository.
    let opened = spawn_terminal(&app, &terminals, 0, &home.display().to_string(), cols, rows)?;

    // Quoted, because the discovered path routinely contains spaces — the
    // desktop app keeps its copy under `AppData\Roaming\Claude\...`.
    let typed = format!(
        "& \"{}\" {}\r",
        argv[0],
        argv[1..].join(" ")
    );
    {
        let mut sessions = terminals
            .0
            .lock()
            .map_err(|_| "the terminal list is in a bad state".to_string())?;
        if let Some(running) = sessions.get_mut(&opened.id) {
            running.session.write(&typed)?;
        }
    }
    Ok(opened)
}

/// Opens a shell in a run's worktree.
///
/// A run's agent must start in its own checkout, not the main one — that is the
/// isolation the whole feature rests on. The path is **checked to be one of the
/// Solution's own worktrees** before a shell is opened in it: an arbitrary path
/// from the frontend is an untrusted string, and a terminal is arbitrary
/// execution, so it is never opened somewhere the app did not create.
#[tauri::command]
pub async fn open_terminal_at(
    app: AppHandle,
    db: State<'_, super::AppDb>,
    terminals: State<'_, Terminals>,
    solution_id: i64,
    path: String,
    cols: u16,
    rows: u16,
) -> Result<OpenedTerminal, String> {
    let root = {
        let conn = db.0.lock().await;
        let Some(row) = crate::db::solution::find_by_id(&conn, solution_id)
            .await
            .map_err(super::to_message)?
        else {
            return Err("that Solution no longer exists".into());
        };
        row.local_path
            .filter(|p| !p.trim().is_empty())
            .ok_or("that Solution has no folder on this machine")?
    };
    // Only somewhere the app made: a worktree of this Solution's repository.
    let known = crate::git::vcs::list_worktrees(&root)?;
    if !known.iter().any(|w| same_path(w, &path)) {
        return Err("that folder is not one of this run's worktrees".into());
    }
    spawn_terminal(&app, &terminals, solution_id, &path, cols, rows)
}

fn same_path(a: &str, b: &str) -> bool {
    let norm = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
    norm(a) == norm(b)
}

/// Starts a shell in `cwd` and streams it, shared by both open commands.
fn spawn_terminal(
    app: &AppHandle,
    terminals: &Terminals,
    solution_id: i64,
    cwd: &str,
    cols: u16,
    rows: u16,
) -> Result<OpenedTerminal, String> {
    let shell = default_shell();
    // A fresh id per panel, not per Solution: two terminals on one repository is
    // an ordinary thing to want, and one worktree per run makes it the norm.
    let id = format!("term-{}-{}", solution_id, crate::db::now_millis());
    let (session, mut reader) =
        Session::spawn(&shell, std::path::Path::new(cwd), cols.max(20), rows.max(5))?;

    let emitter = app.clone();
    let stream_id = id.clone();
    let replay = Arc::new(Mutex::new(Replay::default()));
    let keep = Arc::clone(&replay);
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
                    // Kept before it is emitted, so a panel that is not mounted
                    // right now still has it to catch up on. A poisoned lock
                    // must not take the stream down with it — the output is the
                    // point, the replay is the convenience.
                    if let Ok(mut held) = keep.lock() {
                        held.push(&data);
                    }
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
        .insert(
            id.clone(),
            Running {
                session,
                solution_id,
                shell: shell.clone(),
                cwd: cwd.to_string(),
                started_at: crate::db::now_millis(),
                replay,
            },
        );

    Ok(OpenedTerminal { id, shell, cwd: cwd.to_string() })
}

/// Every shell this app still has running.
///
/// Sessions whose shell has exited on its own are dropped on the way past: a
/// panel asking what is running should not be told about something that is not,
/// and this is the only place that notices `exit` without a window watching.
#[tauri::command]
pub async fn list_terminals(
    terminals: State<'_, Terminals>,
) -> Result<Vec<RunningTerminal>, String> {
    let mut sessions = terminals
        .0
        .lock()
        .map_err(|_| "the terminal list is in a bad state".to_string())?;
    sessions.retain(|_, running| !running.session.finished());
    let mut open: Vec<RunningTerminal> = sessions
        .iter()
        .map(|(id, running)| RunningTerminal {
            id: id.clone(),
            solution_id: running.solution_id,
            shell: running.shell.clone(),
            cwd: running.cwd.clone(),
            started_at: running.started_at,
        })
        .collect();
    // Oldest first, so a list of them reads in the order they were started
    // rather than in whatever order the map happens to hold.
    open.sort_by_key(|t| t.started_at);
    Ok(open)
}

/// Picks a running shell back up, with its recent output to catch up on.
#[tauri::command]
pub async fn attach_terminal(
    terminals: State<'_, Terminals>,
    id: String,
) -> Result<AttachedTerminal, String> {
    let sessions = terminals
        .0
        .lock()
        .map_err(|_| "the terminal list is in a bad state".to_string())?;
    let Some(running) = sessions.get(&id) else {
        return Err("that terminal is not open any more".into());
    };
    let replay = running
        .replay
        .lock()
        .map(|held| held.text())
        .unwrap_or_default();
    Ok(AttachedTerminal {
        id,
        solution_id: running.solution_id,
        shell: running.shell.clone(),
        cwd: running.cwd.clone(),
        started_at: running.started_at,
        replay,
    })
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
    let Some(running) = sessions.get_mut(&id) else {
        return Err("that terminal is not open any more".into());
    };
    running.session.write(&data)
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
    let Some(running) = sessions.get_mut(&id) else {
        // A resize arriving after the shell exited is ordinary, not an error
        // worth showing anyone.
        return Ok(());
    };
    running.session.resize(cols.max(20), rows.max(5))
}

/// Closes a panel and ends its shell.
#[tauri::command]
pub async fn close_terminal(terminals: State<'_, Terminals>, id: String) -> Result<(), String> {
    let mut running = {
        let mut sessions = terminals
            .0
            .lock()
            .map_err(|_| "the terminal list is in a bad state".to_string())?;
        match sessions.remove(&id) {
            Some(running) => running,
            None => return Ok(()),
        }
    };
    // A shell someone already ended with `exit` needs no killing, and reporting
    // a failure to kill a dead process would be a confusing way to say "closed".
    if running.session.finished() {
        return Ok(());
    }
    running.session.kill()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Under the cap nothing is lost — the common case, and the one where a
    /// reattached panel shows the whole session.
    #[test]
    fn recent_output_is_kept_verbatim_under_the_cap() {
        let mut replay = Replay::default();
        replay.push("vite ready in 412ms\r\n");
        replay.push("listening on :5173\r\n");
        assert_eq!(replay.text(), "vite ready in 412ms\r\nlistening on :5173\r\n");
    }

    /// Past the cap the front goes, so a dev server up for a day cannot grow
    /// without bound. The tail is what matters: it is why something died.
    #[test]
    fn output_past_the_cap_drops_from_the_front() {
        let mut replay = Replay::default();
        replay.push(&"a".repeat(Replay::CAP));
        replay.push("THE-END");

        let text = replay.text();
        assert_eq!(text.len(), Replay::CAP, "it should sit exactly on the cap");
        assert!(
            text.ends_with("THE-END"),
            "the newest output must survive the trim"
        );
        // Exactly as much went from the front as arrived at the back — no more,
        // so a long-running shell loses the least it can.
        assert_eq!(
            text.chars().filter(|c| *c == 'a').count(),
            Replay::CAP - "THE-END".len(),
            "only the overflow should have been dropped"
        );
    }

    /// **The one that would panic.** A PTY splits multi-byte characters across
    /// reads, so the trim point lands inside one sooner or later, and
    /// `String::drain` on a byte index that is not a character boundary is a
    /// panic — in a reader thread, where it would take the stream with it.
    #[test]
    fn trimming_never_cuts_a_character_in_half() {
        let mut replay = Replay::default();
        // Three-byte characters, so most byte offsets are not boundaries.
        replay.push(&"→".repeat(Replay::CAP));
        replay.push("done");
        let text = replay.text();
        assert!(text.len() <= Replay::CAP);
        assert!(text.ends_with("done"));
        // Getting this far without a panic is most of the test; that every
        // surviving character is whole is the rest.
        assert!(text.trim_end_matches("done").chars().all(|c| c == '→'));
    }

    /// A chunk larger than the whole buffer must still leave something usable
    /// rather than emptying it — a single huge paste is not a reason to show a
    /// blank panel.
    #[test]
    fn one_oversized_chunk_still_leaves_the_tail() {
        let mut replay = Replay::default();
        replay.push(&format!("{}TAIL", "x".repeat(Replay::CAP * 2)));
        assert!(replay.text().ends_with("TAIL"));
        assert!(replay.text().len() <= Replay::CAP);
    }
}
