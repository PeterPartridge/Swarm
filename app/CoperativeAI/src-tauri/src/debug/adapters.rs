//! Finding the debug adapters, and saying honestly which are missing.
//!
//! **Being on PATH is neither necessary nor sufficient**, and this project has
//! paid for that lesson twice already (see `ai/claude_code.rs`). On this very
//! machine `python.exe` is on PATH and prints "Python was not found" — it is the
//! Windows Store alias stub, a real file that cannot run. So every candidate
//! here is **executed**, and the first one that actually answers wins.
//!
//! Four adapters, one per language this app scaffolds:
//!
//! | Language | Adapter | Transport | Comes from |
//! |---|---|---|---|
//! | TypeScript / JavaScript | `js-debug` | TCP | its GitHub release, or VS Code |
//! | Python | `debugpy` | stdio | `pip install debugpy` |
//! | Go | Delve (`dlv dap`) | TCP | `go install github.com/go-delve/delve/cmd/dlv@latest` |
//! | C# | `netcoredbg` | stdio | Samsung's netcoredbg release |
//!
//! **netcoredbg, not vsdbg.** Microsoft's `vsdbg` is the better debugger and its
//! licence permits use only from Visual Studio and VS Code, so shipping a client
//! that drives it from here would be a licence breach. netcoredbg is MIT and
//! speaks the same protocol.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// How a client talks to an adapter once it is running.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Transport {
    /// The adapter is a child process; DAP goes over its stdin/stdout.
    Stdio,
    /// The adapter listens on a port and DAP goes over a socket.
    Tcp,
}

/// One language's adapter, and what this machine has to say about it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterStatus {
    /// `typescript` | `python` | `go` | `csharp`.
    pub language: String,
    pub label: String,
    pub adapter: String,
    pub transport: Transport,
    /// True only when a candidate was found **and ran**.
    pub available: bool,
    /// What will be executed, for a person to read. Empty when nothing worked.
    pub program: String,
    /// What will be executed, for a computer to run: the executable followed by
    /// its arguments. `{port}` in an argument is replaced with a free port when
    /// the transport is TCP. Kept apart from `program` because splitting a
    /// display string back into argv is how paths with spaces get mangled.
    pub argv: Vec<String>,
    /// The adapter's own version line, when it gave one.
    pub version: String,
    /// Why it is not available, in words somebody can act on. Empty when it is.
    pub problem: String,
    /// What to do to get it, for a person to read. Always populated, so the UI
    /// never has to guess — but it is prose for two of these, because two of
    /// them are a download and an unzip rather than a command.
    pub install: String,
    /// The same thing as **one runnable command**, or empty where there is not
    /// one.
    ///
    /// **Kept apart from `install` because half of these cannot be run.**
    /// "Download js-debug-dap from … and extract it to ~/.js-debug" is a
    /// sentence; typing it into a shell produces `command not found`, which
    /// reads as a broken app rather than a manual step. An Install button is
    /// offered only where this is populated.
    pub install_command: String,
}

/// Looks for every adapter and reports what it found.
pub fn discover() -> Vec<AdapterStatus> {
    vec![js_debug(), debugpy(), delve(), netcoredbg()]
}

/// Runs a candidate and returns its first line of output.
///
/// **This is the whole point of the module.** A filename proves nothing: the
/// npm shim that is a shell script, the Store alias that is a stub, the
/// placeholder `claude.exe` that was 500 bytes of ASCII — all of them exist and
/// none of them runs. The only test that means anything is starting it.
fn probe(program: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = command
        .output()
        .map_err(|e| format!("{} would not start: {e}", program.display()))?;

    // Version flags land on either stream depending on the tool, and several
    // report a non-zero status for `--version`. What matters is that it ran and
    // said something.
    let text = if output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr).to_string()
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };
    let first = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    if first.trim().is_empty() {
        return Err(format!("{} ran but said nothing", program.display()));
    }
    Ok(first.trim().to_string())
}

/// Every place a binary might be, PATH included, extensions first.
///
/// **Extensions before the bare name**, because on Windows npm ships both `dlv`
/// (a shell script) and `dlv.exe` in the same folder, and running the bare name
/// gets "not a valid Win32 application".
fn candidates(name: &str, extra: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT".into())
            .split(';')
            .filter(|e| !e.trim().is_empty())
            .map(|e| e.trim().to_lowercase())
            .collect()
    } else {
        vec![]
    };

    for dir in extra {
        for ext in &exts {
            out.push(dir.join(format!("{name}{ext}")));
        }
        out.push(dir.join(name));
    }
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            for ext in &exts {
                out.push(dir.join(format!("{name}{ext}")));
            }
            out.push(dir.join(name));
        }
    }
    out
}

/// The first candidate that exists and runs.
fn first_that_runs(name: &str, extra: Vec<PathBuf>, args: &[&str]) -> Option<(PathBuf, String)> {
    for candidate in candidates(name, extra) {
        if !candidate.is_file() {
            continue;
        }
        if let Ok(version) = probe(&candidate, args) {
            return Some((candidate, version));
        }
    }
    None
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Go — Delve, which speaks DAP directly with `dlv dap`.
fn delve() -> AdapterStatus {
    let extra = home()
        .map(|h| vec![h.join("go").join("bin")])
        .unwrap_or_default();
    let found = first_that_runs("dlv", extra, &["version"]);
    AdapterStatus {
        language: "go".into(),
        label: "Go".into(),
        adapter: "Delve".into(),
        transport: Transport::Tcp,
        available: found.is_some(),
        program: found
            .as_ref()
            .map(|(p, _)| format!("{} dap", p.display()))
            .unwrap_or_default(),
        argv: found
            .as_ref()
            .map(|(p, _)| {
                vec![
                    p.display().to_string(),
                    "dap".into(),
                    "--listen=127.0.0.1:{port}".into(),
                ]
            })
            .unwrap_or_default(),
        version: found
            .as_ref()
            .map(|(_, v)| v.clone())
            .unwrap_or_default(),
        problem: if found.is_some() {
            String::new()
        } else {
            "Delve is not installed, or is installed somewhere this could not run it.".into()
        },
        install: "go install github.com/go-delve/delve/cmd/dlv@latest".into(),
        install_command: "go install github.com/go-delve/delve/cmd/dlv@latest".into(),
    }
}

/// TypeScript and JavaScript — js-debug, hosted by Node.
///
/// It is a script rather than a binary, so the thing to find is **Node**, and
/// then the script beside it. VS Code bundles a copy; npm has it standalone.
fn js_debug() -> AdapterStatus {
    let node = first_that_runs("node", vec![], &["--version"]);
    let script = js_debug_script();

    let (available, problem) = match (&node, &script) {
        (Some(_), Some(_)) => (true, String::new()),
        (None, _) => (
            false,
            "Node is not installed, and js-debug is a Node program.".to_string(),
        ),
        (_, None) => (
            false,
            "js-debug was not found. It is not an npm package — it ships as a release tarball              and inside the VS Code JavaScript Debugger extension."
                .to_string(),
        ),
    };

    AdapterStatus {
        language: "typescript".into(),
        label: "TypeScript / JavaScript".into(),
        adapter: "js-debug".into(),
        transport: Transport::Tcp,
        available,
        // Both halves, because neither alone is runnable.
        program: match (&node, &script) {
            (Some((n, _)), Some(s)) => format!("{} {}", n.display(), s.display()),
            _ => String::new(),
        },
        // js-debug takes the port as a bare positional argument.
        argv: match (&node, &script) {
            (Some((n, _)), Some(s)) => vec![
                n.display().to_string(),
                s.display().to_string(),
                "{port}".into(),
            ],
            _ => Vec::new(),
        },
        version: node.as_ref().map(|(_, v)| format!("node {v}")).unwrap_or_default(),
        problem,
        // Not an npm package: `npm i -g @vscode/js-debug` 404s, which is what
        // this used to say. The release tarball is the real distribution.
        install: "Download js-debug-dap from github.com/microsoft/vscode-js-debug/releases                   and extract it to ~/.js-debug (or install the VS Code JavaScript Debugger)"
            .into(),
        // A download and an unzip, not a command — so no Install button. See
        // `install_command`.
        install_command: String::new(),
    }
}

/// Where `dapDebugServer.js` might be.
///
/// **Not npm.** `@vscode/js-debug` is not a published package — asking for it
/// gets a 404, which is what the app used to tell people to run. js-debug ships
/// as a GitHub release tarball (`js-debug-dap-vX.Y.Z.tar.gz`, extracting to a
/// `js-debug/` folder) and inside the VS Code extension, and those are the two
/// places worth looking.
fn js_debug_script() -> Option<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();

    if let Some(h) = home() {
        // Where the release tarball would sensibly be unpacked.
        roots.push(h.join(".js-debug"));
        roots.push(h.join("js-debug"));
        roots.push(h.join("AppData").join("Local").join("js-debug"));
        roots.push(h.join(".local").join("share").join("js-debug"));

        // The VS Code extension, whose folder carries its version — so the
        // directory is scanned rather than guessed, and the newest wins.
        for dir in [
            h.join(".vscode").join("extensions"),
            h.join(".vscode-insiders").join("extensions"),
        ] {
            if let Ok(entries) = std::fs::read_dir(&dir) {
                let mut found: Vec<PathBuf> = entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| {
                        p.file_name()
                            .and_then(|n| n.to_str())
                            .is_some_and(|n| n.starts_with("ms-vscode.js-debug-"))
                    })
                    .collect();
                // Newest last by name, which for `…-1.117.0` orders well enough
                // to prefer a later release over an earlier one.
                found.sort();
                roots.extend(found.into_iter().rev());
            }
        }

        // The copy bundled inside a VS Code install.
        roots.push(
            h.join("AppData")
                .join("Local")
                .join("Programs")
                .join("Microsoft VS Code")
                .join("resources")
                .join("app")
                .join("extensions")
                .join("ms-vscode.js-debug"),
        );
    }
    roots.push(PathBuf::from(
        r"C:\Program Files\Microsoft VS Code\resources\app\extensions\ms-vscode.js-debug",
    ));
    roots.push(PathBuf::from(
        "/usr/share/code/resources/app/extensions/ms-vscode.js-debug",
    ));

    for root in roots {
        // `js-debug/src/…` is the tarball extracted as-is: the archive contains
        // a `js-debug/` folder, so unpacking it into `~/.js-debug` — the obvious
        // thing to do, and what this app tells people to do — nests it once.
        for rel in [
            "src/dapDebugServer.js",
            "js-debug/src/dapDebugServer.js",
            "dist/src/dapDebugServer.js",
        ] {
            let candidate = root.join(rel);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Python — debugpy, which is a module rather than a binary.
///
/// So the thing to find is a **Python that actually runs** and has debugpy
/// importable. On Windows that is not simply `python.exe`: the Store alias on
/// PATH is a stub that prints an advert and exits.
fn debugpy() -> AdapterStatus {
    let mut found: Option<(PathBuf, String)> = None;
    for name in ["python", "python3", "py"] {
        // `-c import debugpy` is the probe, not `--version`: a Python that runs
        // but has no debugpy is no more use here than no Python at all, and
        // reporting it as available would be a lie one press deep.
        if let Some(hit) = first_that_runs(
            name,
            vec![],
            &["-c", "import debugpy,sys;print('debugpy',debugpy.__version__)"],
        ) {
            if hit.1.starts_with("debugpy") {
                found = Some(hit);
                break;
            }
        }
    }

    AdapterStatus {
        language: "python".into(),
        label: "Python".into(),
        adapter: "debugpy".into(),
        transport: Transport::Stdio,
        available: found.is_some(),
        program: found
            .as_ref()
            .map(|(p, _)| format!("{} -m debugpy.adapter", p.display()))
            .unwrap_or_default(),
        argv: found
            .as_ref()
            .map(|(p, _)| vec![p.display().to_string(), "-m".into(), "debugpy.adapter".into()])
            .unwrap_or_default(),
        version: found.as_ref().map(|(_, v)| v.clone()).unwrap_or_default(),
        problem: if found.is_some() {
            String::new()
        } else {
            "No Python with debugpy installed was found. On Windows the `python` on PATH is \
             often the Microsoft Store stub, which cannot run."
                .into()
        },
        install: "pip install debugpy".into(),
        install_command: "pip install debugpy".into(),
    }
}

/// C# — netcoredbg, in its VS Code protocol mode.
fn netcoredbg() -> AdapterStatus {
    let mut extra = Vec::new();
    if let Some(h) = home() {
        extra.push(h.join(".netcoredbg"));
        extra.push(h.join("netcoredbg"));
        // The release zip contains a `netcoredbg/` folder, so unpacking it into
        // `~/.netcoredbg` — the obvious thing, and what this app suggests —
        // nests it once. Same shape as js-debug's tarball.
        extra.push(h.join(".netcoredbg").join("netcoredbg"));
        extra.push(h.join("netcoredbg").join("netcoredbg"));
    }
    // `--version` is enough to prove it runs; the DAP mode is a different flag.
    let found = first_that_runs("netcoredbg", extra, &["--version"]);

    AdapterStatus {
        language: "csharp".into(),
        label: "C#".into(),
        adapter: "netcoredbg".into(),
        transport: Transport::Stdio,
        available: found.is_some(),
        program: found
            .as_ref()
            .map(|(p, _)| format!("{} --interpreter=vscode", p.display()))
            .unwrap_or_default(),
        argv: found
            .as_ref()
            .map(|(p, _)| vec![p.display().to_string(), "--interpreter=vscode".into()])
            .unwrap_or_default(),
        version: found.as_ref().map(|(_, v)| v.clone()).unwrap_or_default(),
        problem: if found.is_some() {
            String::new()
        } else {
            "netcoredbg was not found. Microsoft's vsdbg is not used here: its licence allows it \
             only from Visual Studio and VS Code."
                .into()
        },
        install: "Download netcoredbg-win64.zip from github.com/Samsung/netcoredbg/releases                   and extract it to ~/.netcoredbg"
            .into(),
        install_command: String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every language this app scaffolds gets an answer, present or not — a
    /// missing entry would read as "this cannot be debugged" when the truth is
    /// "nobody looked".
    #[test]
    fn every_language_is_reported_on() {
        let found = discover();
        let languages: Vec<&str> = found.iter().map(|a| a.language.as_str()).collect();
        for wanted in ["typescript", "python", "go", "csharp"] {
            assert!(languages.contains(&wanted), "{wanted} was not reported on");
        }
        assert_eq!(found.len(), 4, "an extra adapter needs a test of its own");
    }

    /// **An unavailable adapter must say why and how to fix it.** "Not
    /// available" on its own sends somebody hunting through their own PATH.
    #[test]
    fn an_adapter_that_is_missing_says_why_and_what_to_install() {
        for adapter in discover() {
            if adapter.available {
                assert!(
                    adapter.problem.is_empty(),
                    "{} is available but still reports a problem",
                    adapter.language
                );
                assert!(
                    !adapter.program.is_empty(),
                    "{} is available but names nothing to run",
                    adapter.language
                );
            } else {
                assert!(
                    !adapter.problem.is_empty(),
                    "{} is unavailable and does not say why",
                    adapter.language
                );
            }
            // Always, either way: knowing how to install it is useful before
            // you need it too.
            assert!(
                !adapter.install.is_empty(),
                "{} does not say how to install it",
                adapter.language
            );
        }
    }

    /// **Half of these cannot be typed into a shell**, and the Install button
    /// is offered on exactly the half that can. Getting this wrong produces a
    /// button that runs "Download js-debug-dap from github.com/…" and reports
    /// `command not found`, which reads as a broken app rather than a manual
    /// step.
    #[test]
    fn only_the_adapters_installed_by_a_command_carry_one() {
        let found = discover();
        let command_for = |lang: &str| {
            found
                .iter()
                .find(|a| a.language == lang)
                .map(|a| a.install_command.clone())
                .expect("adapter")
        };

        // One command each, and the same one the prose names.
        assert_eq!(command_for("go"), "go install github.com/go-delve/delve/cmd/dlv@latest");
        assert_eq!(command_for("python"), "pip install debugpy");

        // A download and an unzip. No button, rather than one that fails.
        assert!(command_for("typescript").is_empty());
        assert!(command_for("csharp").is_empty());

        for adapter in &found {
            if adapter.install_command.is_empty() {
                continue;
            }
            assert!(
                adapter.install.contains(&adapter.install_command),
                "{}'s runnable command is not the one its prose names",
                adapter.language
            );
            assert!(
                !adapter.install_command.contains('\n'),
                "{}'s install command is more than one line",
                adapter.language
            );
        }
    }

    /// The transports really do differ, and the client has to honour both.
    #[test]
    fn the_transports_are_recorded_per_adapter() {
        let found = discover();
        let by = |lang: &str| {
            found
                .iter()
                .find(|a| a.language == lang)
                .expect("adapter")
                .transport
        };
        assert_eq!(by("go"), Transport::Tcp, "dlv dap listens on a port");
        assert_eq!(by("typescript"), Transport::Tcp, "js-debug listens on a port");
        assert_eq!(by("python"), Transport::Stdio);
        assert_eq!(by("csharp"), Transport::Stdio);
    }

    /// On Windows the extension has to be tried before the bare name: npm ships
    /// `dlv` (a shell script) and `dlv.exe` side by side, and the bare one gives
    /// "not a valid Win32 application".
    #[test]
    #[cfg(windows)]
    fn windows_candidates_try_extensions_before_the_bare_name() {
        let dir = PathBuf::from(r"C:\tools");
        let list = candidates("dlv", vec![dir.clone()]);
        let exe = list.iter().position(|p| p == &dir.join("dlv.exe"));
        let bare = list.iter().position(|p| p == &dir.join("dlv"));
        assert!(exe.is_some() && bare.is_some(), "both spellings should be tried");
        assert!(exe < bare, "the extension must be tried first on Windows");
    }

    /// A file that exists but cannot run must not count as found. This is the
    /// Store-stub case, written as a file that is not an executable at all.
    #[test]
    fn a_file_that_will_not_run_is_not_treated_as_found() {
        let dir = std::env::temp_dir().join(format!("coperativeai-dap-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let fake = dir.join("definitely-not-runnable.txt");
        std::fs::write(&fake, "I am not a program").expect("write");

        assert!(fake.is_file(), "the fixture must exist as a file");
        assert!(
            probe(&fake, &["--version"]).is_err(),
            "a file that cannot execute must not pass the probe"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
