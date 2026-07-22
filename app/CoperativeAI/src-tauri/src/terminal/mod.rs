//! A real shell in a panel, over a real PTY.
//!
//! Not a command runner. The difference is the pseudo-terminal: with one, the
//! shell believes it is talking to a terminal, so prompts, colour, Ctrl-C,
//! progress bars and full-screen TUIs all work — which is the whole reason this
//! exists, because Claude Code is a TUI and will not run in a pipe.
//!
//! **The Windows half is the risky half**, as the page brief said before any of
//! this was written. `portable-pty` uses ConPTY there, and the spike found the
//! thing that would otherwise have looked like a dead terminal:
//!
//! **ConPTY opens by sending `ESC [ 6 n` — "report your cursor position" — and
//! says nothing further until something answers.** A real terminal emulator
//! replies automatically; xterm.js does, which is why the panel works. Anything
//! that merely reads the PTY without behaving like a terminal sees four bytes
//! and then silence, and looks exactly like a shell that failed to start. The
//! tests below therefore answer the query the way xterm.js does.
//!
//! The other two ConPTY differences: it needs an explicit resize or it wraps at
//! its startup width, and killing the shell does not by itself kill what the
//! shell started. Both are handled below and named where they are handled.
//!
//! **Nothing here is logged or persisted**, per the page brief: terminal output
//! can contain anything the developer types, including secrets they paste. It
//! goes from the PTY to the window and nowhere else.

use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::path::Path;

/// One running shell.
pub struct Session {
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
}

/// The shell a developer on this machine expects.
///
/// PowerShell on Windows — what the page brief named and what the rest of this
/// project's tooling assumes. `$SHELL` elsewhere, falling back to `/bin/sh`,
/// the one shell a Unix machine is guaranteed to have.
pub fn default_shell() -> String {
    if cfg!(windows) {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
}

impl Session {
    /// Starts a shell in `cwd`, returning the session and a reader for its
    /// output. The reader is handed straight to a thread by the command layer;
    /// returning it rather than owning it is what lets this be tested without
    /// Tauri anywhere in the picture.
    pub fn spawn(
        program: &str,
        cwd: &Path,
        cols: u16,
        rows: u16,
    ) -> Result<(Self, Box<dyn Read + Send>), String> {
        if !cwd.is_dir() {
            return Err(format!(
                "{} is not a folder to open a terminal in",
                cwd.display()
            ));
        }
        let pty = NativePtySystem::default()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("could not open a terminal: {e}"))?;

        let mut command = CommandBuilder::new(program);
        command.cwd(cwd);
        // A terminal that does not say it is a terminal gets served the dumb
        // version of everything — no colour, and TUIs refuse to start.
        command.env("TERM", "xterm-256color");

        let child = pty
            .slave
            .spawn_command(command)
            .map_err(|e| format!("could not start {program}: {e}"))?;
        // The slave is dropped deliberately: while this process still holds it
        // open, the reader never sees EOF when the shell exits, and the panel
        // would sit there looking alive forever.
        drop(pty.slave);

        let reader = pty
            .master
            .try_clone_reader()
            .map_err(|e| format!("could not read from the terminal: {e}"))?;
        let writer = pty
            .master
            .take_writer()
            .map_err(|e| format!("could not write to the terminal: {e}"))?;

        Ok((
            Session {
                writer,
                child,
                master: pty.master,
            },
            reader,
        ))
    }

    /// Sends keystrokes. Bytes, not lines — Ctrl-C is `\x03` and the arrow keys
    /// are escape sequences, so anything assuming whole lines breaks both.
    pub fn write(&mut self, data: &str) -> Result<(), String> {
        self.writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("could not send to the terminal: {e}"))?;
        self.writer
            .flush()
            .map_err(|e| format!("could not send to the terminal: {e}"))
    }

    /// Tells the shell its new size.
    ///
    /// Without this the shell keeps its startup guess and wraps at that width,
    /// so a resized panel folds text in the wrong place — the exact
    /// "wrapped/garbled output" the page brief listed as a thing to watch.
    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("could not resize the terminal: {e}"))
    }

    /// Ends the shell **and everything it started**.
    ///
    /// Killing the shell alone does not take its children with it: an
    /// `npm run dev` launched in the panel outlives it and keeps holding its
    /// port, which is a leak that only shows up after an afternoon's work and
    /// then presents as "port already in use" with nothing visible using it.
    ///
    /// The tree is ended through the platform's own tool rather than a crate,
    /// because both spellings are one command and neither needs a dependency:
    /// `taskkill /T` on Windows walks the child tree, and on Unix the shell is
    /// a process-group leader so a negative PID signals the whole group.
    ///
    /// Best effort by design. A child that has already exited, or one this
    /// process may not signal, must not stop the panel from closing — so the
    /// tree kill is attempted, its failure ignored, and the shell itself is
    /// then ended directly.
    pub fn kill(&mut self) -> Result<(), String> {
        if let Some(pid) = self.child.process_id() {
            let _ = kill_tree(pid);
        }
        self.child
            .kill()
            .map_err(|e| format!("could not close the terminal: {e}"))?;
        let _ = self.child.wait();
        Ok(())
    }

    /// Whether the shell has exited on its own — someone typed `exit`.
    pub fn finished(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(Some(_)))
    }
}

/// Ends a process and its descendants, as far as the OS will allow.
fn kill_tree(pid: u32) -> std::io::Result<()> {
    if cfg!(windows) {
        std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|_| ())
    } else {
        // A negative PID is the process group. The shell leads its own group,
        // so this reaches everything it started.
        std::process::Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "coperativeai-pty-{}-{name}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    /// Drives a session the way a terminal emulator would, until `needle`
    /// appears or the time runs out.
    ///
    /// Two things make this more than a read loop, and both were found the hard
    /// way:
    ///
    /// 1. **The read runs on its own thread.** A PTY read blocks when the shell
    ///    has nothing to say, so checking a deadline between reads — the obvious
    ///    way to write this — hangs the moment the shell reaches its prompt.
    /// 2. **`ESC [ 6 n` is answered.** ConPTY asks for the cursor position on
    ///    startup and produces nothing at all until something replies. xterm.js
    ///    answers it in the real panel; a test that does not answer sees four
    ///    bytes and silence, which looks identical to a shell that failed.
    fn drive_until(
        session: &mut Session,
        mut reader: Box<dyn Read + Send>,
        input: &str,
        needle: &str,
        secs: u64,
    ) -> String {
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });

        let deadline = Instant::now() + Duration::from_secs(secs);
        let mut seen = String::new();
        let mut sent_input = false;
        while Instant::now() < deadline {
            let left = deadline.saturating_duration_since(Instant::now());
            let Ok(chunk) = rx.recv_timeout(left) else { break };
            let text = String::from_utf8_lossy(&chunk).to_string();

            // Behave like a terminal: report the cursor when asked.
            if text.contains("\x1b[6n") {
                let _ = session.write("\x1b[1;1R");
            }
            seen.push_str(&text);

            // The shell is only ready once it has said something beyond the
            // cursor query; sending before that races its startup.
            if !sent_input && seen.len() > 8 {
                let _ = session.write(input);
                sent_input = true;
            }
            if seen.contains(needle) {
                return seen;
            }
        }
        seen
    }

    /// The ConPTY spike, as a test: a real shell starts, runs what it is given,
    /// and answers in the folder it was pointed at. If Windows were going to be
    /// a problem, it would be a problem here — and it was, until the cursor
    /// query got its answer.
    #[test]
    fn a_real_shell_runs_a_command_in_the_folder_it_was_given() {
        let dir = scratch("runs");
        let marker = "coperativeai-marker-9317";
        std::fs::write(dir.join(format!("{marker}.txt")), "x").expect("marker file");

        let (mut session, reader) =
            Session::spawn(&default_shell(), &dir, 120, 30).expect("spawn a shell");

        // Listing the folder proves both that the shell runs and that its
        // working directory is the one that was asked for.
        let list = if cfg!(windows) { "dir\r\n" } else { "ls\n" };
        let seen = drive_until(&mut session, reader, list, marker, 30);
        session.kill().expect("kill");

        assert!(
            seen.contains(marker),
            "the shell did not run in the folder it was given. Saw:\n{seen}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Resizing must be accepted while the shell runs — this is the call that
    /// stops a widened panel from folding text at the old width.
    #[test]
    fn a_running_shell_can_be_resized() {
        let dir = scratch("resize");
        let (mut session, _reader) =
            Session::spawn(&default_shell(), &dir, 80, 24).expect("spawn a shell");

        session.resize(200, 50).expect("resize while running");
        session.kill().expect("kill");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Closing the panel must end the shell. One orphan per open-and-close is a
    /// leak that only shows up after an afternoon's work.
    #[test]
    fn closing_the_panel_ends_the_shell() {
        let dir = scratch("kill");
        let (mut session, _reader) =
            Session::spawn(&default_shell(), &dir, 80, 24).expect("spawn a shell");

        assert!(!session.finished(), "it should be running before it is killed");
        session.kill().expect("kill");
        assert!(session.finished(), "the shell outlived the panel");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A folder that is not there is refused with a message rather than
    /// silently opening a shell somewhere else — which is how someone runs a
    /// destructive command in the wrong repository.
    #[test]
    fn a_missing_folder_is_refused_rather_than_falling_back() {
        let missing = std::env::temp_dir().join("coperativeai-no-such-folder-4471");
        let _ = std::fs::remove_dir_all(&missing);
        // `expect_err` needs Debug on the Ok side, and a live PTY has none.
        let err = Session::spawn(&default_shell(), &missing, 80, 24)
            .err()
            .expect("should refuse a folder that is not there");
        assert!(err.contains("not a folder"), "got: {err}");
    }
}
