//! What command starts a Solution running, and what keeps it refreshing.
//!
//! Two commands, not one, because they answer different needs. **Start** is
//! what spins a front end up — `npm run dev` — and it already reloads itself,
//! because that is what a Vite or Next dev server does. **Watch** is for the
//! backends that do not: `cargo run` builds once and stops, so a Rust service
//! is restarted on change by `cargo watch`, a .NET one by `dotnet watch`, and
//! so on. The user's phrase for it was "hot refresh", and for a compiled
//! language that means watch-and-restart rather than in-place reload.
//!
//! Detection is the same shape as the test runner's, and for the same reason:
//! the platform cannot know every toolchain, so it detects what it recognises,
//! offers a per-Solution override for what it does not, and never invents a
//! command it cannot see.

use std::path::Path;

/// How to run a Solution while working on it.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevCommand {
    /// "cargo" | "vite" | "npm" | "dotnet" | "go" | "python" | "custom"
    pub kind: String,
    /// Starts it. For a front end this is the dev server, which reloads itself.
    pub start: String,
    /// Keeps a backend refreshing on change. Empty when the start command
    /// already reloads — a front end needs no separate watcher.
    pub watch: String,
    /// Whether `watch` needs a tool that may not be installed, said plainly so
    /// a failure reads as "install cargo-watch" rather than a mystery.
    pub watch_needs: String,
    /// The executable `watch` needs on PATH, so the panel can check before
    /// offering it. Empty when nothing extra is required — `dotnet watch` is
    /// built in, and a front end has no watcher at all.
    pub watch_bin: String,
    /// The file that gave the language away.
    pub found_by: String,
}

/// Works out how to run whatever is in `root`.
///
/// The manifest is read, not guessed at: a `package.json` with a `dev` script
/// is a front end that spins itself up, while one with only `start` is a plain
/// Node service that wants a watcher. Reading the script is the evidence.
pub fn detect(root: &Path) -> Option<DevCommand> {
    let has = |name: &str| root.join(name).exists();

    if has("package.json") {
        let manifest = std::fs::read_to_string(root.join("package.json")).unwrap_or_default();
        if manifest.contains("\"dev\"") {
            // A dev server reloads itself — no separate watcher.
            return Some(cmd("vite", "npm run dev", "", "", "", "package.json"));
        }
        // A plain Node service: start it, and restart on change with nodemon.
        return Some(cmd(
            "npm",
            "npm start",
            "npx nodemon .",
            "nodemon (npx fetches it)",
            // npx fetches nodemon on demand, so npm itself is the requirement.
            "npx",
            "package.json",
        ));
    }
    if has("Cargo.toml") {
        // cargo run builds once and stops; cargo watch is the refresh.
        return Some(cmd(
            "cargo",
            "cargo run",
            "cargo watch -x run",
            "cargo-watch (cargo install cargo-watch)",
            "cargo-watch",
            "Cargo.toml",
        ));
    }
    if has("go.mod") {
        return Some(cmd(
            "go",
            "go run .",
            "air",
            "air (github.com/air-verse/air)",
            "air",
            "go.mod",
        ));
    }
    for marker in ["pyproject.toml", "requirements.txt", "manage.py"] {
        if has(marker) {
            // uvicorn/flask reload flags vary by framework, so watchmedo is the
            // language-level answer that works whatever the entry point is.
            return Some(cmd(
                "python",
                "python -m app",
                "watchmedo auto-restart -d . -p '*.py' -- python -m app",
                "watchdog (pip install watchdog)",
                "watchmedo",
                marker,
            ));
        }
    }
    if has_extension(root, "csproj") || has_extension(root, "sln") {
        // dotnet watch is built in — the one language where the refresh needs
        // no extra tool at all.
        return Some(cmd("dotnet", "dotnet run", "dotnet watch run", "", "", "a .csproj or .sln"));
    }
    None
}

fn cmd(
    kind: &str,
    start: &str,
    watch: &str,
    watch_needs: &str,
    watch_bin: &str,
    found_by: &str,
) -> DevCommand {
    DevCommand {
        kind: kind.into(),
        start: start.into(),
        watch: watch.into(),
        watch_needs: watch_needs.into(),
        watch_bin: watch_bin.into(),
        found_by: found_by.into(),
    }
}

fn has_extension(dir: &Path, ext: &str) -> bool {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .any(|e| e.path().extension().and_then(|x| x.to_str()) == Some(ext))
        })
        .unwrap_or(false)
}

/// A Solution's own command, replacing detection.
pub fn custom(start: &str) -> DevCommand {
    cmd("custom", start.trim(), "", "", "", "set on this Solution")
}

/// Whether an executable is on PATH.
///
/// Checked so the panel can say "hot refresh needs cargo-watch, which is not
/// installed" *before* the button is pressed, rather than leaving someone to
/// read a shell error. An empty name is "nothing to check", which is true for
/// `dotnet watch` and for a front end that reloads itself.
///
/// PATHEXT is honoured on Windows because `cargo-watch` on disk is really
/// `cargo-watch.exe`, and looking only for the bare name would report every
/// installed tool as missing.
pub fn tool_on_path(name: &str) -> bool {
    if name.trim().is_empty() {
        return true;
    }
    // No PATH to search is not evidence the tool is absent, and claiming it is
    // missing would be a worse guess than staying quiet.
    std::env::var_os("PATH").is_none() || which(name).is_some()
}

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

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "coperativeai-dev-{}-{name}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch");
        dir
    }

    /// A front end spins itself up: the dev server reloads, so no watcher.
    #[test]
    fn a_dev_script_is_a_front_end_that_reloads_itself() {
        let dir = scratch("vite");
        std::fs::write(dir.join("package.json"), r#"{"scripts":{"dev":"vite"}}"#).unwrap();
        let d = detect(&dir).expect("detected");
        assert_eq!(d.start, "npm run dev");
        assert_eq!(d.watch, "", "a dev server needs no separate watcher");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A compiled backend does not reload — hot refresh means watch-and-restart.
    #[test]
    fn a_rust_service_gets_a_watcher_because_cargo_run_stops() {
        let dir = scratch("rust");
        std::fs::write(dir.join("Cargo.toml"), "[package]\nname=\"x\"").unwrap();
        let d = detect(&dir).expect("detected");
        assert_eq!(d.start, "cargo run");
        assert_eq!(d.watch, "cargo watch -x run");
        assert!(d.watch_needs.contains("cargo-watch"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A plain Node service (start, no dev) wants a watcher rather than being
    /// mistaken for a front end.
    #[test]
    fn a_plain_node_service_is_watched_not_treated_as_a_front_end() {
        let dir = scratch("node");
        std::fs::write(dir.join("package.json"), r#"{"scripts":{"start":"node ."}}"#).unwrap();
        let d = detect(&dir).expect("detected");
        assert_eq!(d.start, "npm start");
        assert!(d.watch.contains("nodemon"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The panel checks this before offering Hot refresh, so it has to answer
    /// honestly both ways.
    #[test]
    fn a_tool_on_path_is_found_and_a_made_up_one_is_not() {
        // Something every machine running these tests has, by definition.
        assert!(tool_on_path("cargo"), "cargo built this test");
        assert!(
            !tool_on_path("coperativeai-definitely-not-a-real-tool"),
            "a name nothing could match must report missing"
        );
        // Nothing to check is not a failure — dotnet watch needs no extra tool.
        assert!(tool_on_path(""), "an empty requirement is satisfied");
    }

    /// .NET is the one language whose refresh needs no extra tool.
    #[test]
    fn dotnet_watch_needs_nothing_installed() {
        let dir = scratch("dotnet");
        std::fs::write(dir.join("app.csproj"), "<Project></Project>").unwrap();
        let d = detect(&dir).expect("detected");
        assert_eq!(d.watch, "dotnet watch run");
        assert_eq!(d.watch_needs, "");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_folder_with_nothing_recognisable_offers_no_command() {
        let dir = scratch("empty");
        std::fs::write(dir.join("README.md"), "# hi").unwrap();
        assert!(detect(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
