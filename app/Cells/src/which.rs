//! Finding a program on PATH the way this platform will actually run it.
//!
//! In Cells because detection needs it and Cells cannot reach back into the
//! app that hosts it. Swarm re-exports it from `tooling::dev_runner`, so
//! nothing there changed when it moved.

/// Where an executable actually is, extension and all.
///
/// **Finding the file is not the same as being able to run it**, and on Windows
/// that gap is a real bug rather than a nicety. `claude` installs as
/// `claude.cmd`; `Command::new("claude")` tries only `claude` and `claude.exe`,
/// so it fails with "program not found" against an install that is perfectly
/// good. Anything spawning a tool by name has to resolve it through PATHEXT
/// first and spawn the full path it gets back.
///
/// Returns `None` when there is no PATH or nothing matches — callers decide
/// whether that means "not installed" or "cannot tell".
pub fn which(name: &str) -> Option<std::path::PathBuf> {
    if name.trim().is_empty() {
        return None;
    }
    // An explicit path is already the answer; searching PATH for something with
    // a separator in it would find nothing.
    let given = std::path::Path::new(name);
    if given.is_absolute() || name.contains('/') || name.contains('\\') {
        return given.is_file().then(|| given.to_path_buf());
    }

    let path = std::env::var_os("PATH")?;
    let extensions: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".into())
            .split(';')
            .filter(|e| !e.is_empty())
            .map(|e| e.to_lowercase())
            .collect()
    } else {
        Vec::new()
    };

    std::env::split_paths(&path).find_map(|dir| {
        // **Extensions before the bare name, and the order matters more than it
        // looks.** npm and Claude Code both ship *two* files in the same folder:
        // `npm` with no extension, which is a shell script for Git Bash, and
        // `npm.cmd`, which is the one Windows can actually execute. Preferring
        // the bare name finds the shell script and spawning it fails with
        // "%1 is not a valid Win32 application" — a good install that reports
        // itself as broken, again, one error further along than before.
        //
        // On Unix `extensions` is empty, so this falls straight through to the
        // bare name, which is the whole story there.
        extensions
            .iter()
            .find_map(|ext| {
                let candidate = dir.join(format!("{name}{ext}"));
                candidate.is_file().then_some(candidate)
            })
            .or_else(|| {
                let bare = dir.join(name);
                bare.is_file().then_some(bare)
            })
    })
}
