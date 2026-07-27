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
            return Some(cmd("vite", "npm run dev", "", "", "package.json"));
        }
        // A plain Node service: start it, and restart on change with nodemon.
        return Some(cmd(
            "npm",
            "npm start",
            "npx nodemon .",
            "nodemon (npx fetches it)",
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
            "Cargo.toml",
        ));
    }
    if has("go.mod") {
        return Some(cmd(
            "go",
            "go run .",
            "air",
            "air (github.com/air-verse/air)",
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
                marker,
            ));
        }
    }
    if has_extension(root, "csproj") || has_extension(root, "sln") {
        // dotnet watch is built in — the one language where the refresh needs
        // no extra tool at all.
        return Some(cmd("dotnet", "dotnet run", "dotnet watch run", "", "a .csproj or .sln"));
    }
    None
}

fn cmd(kind: &str, start: &str, watch: &str, watch_needs: &str, found_by: &str) -> DevCommand {
    DevCommand {
        kind: kind.into(),
        start: start.into(),
        watch: watch.into(),
        watch_needs: watch_needs.into(),
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
    cmd("custom", start.trim(), "", "", "set on this Solution")
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
