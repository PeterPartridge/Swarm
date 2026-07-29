//! Starting a new Solution from its language's own project generator.
//!
//! The platform does not write starter projects itself, and should not: every
//! one of these toolchains ships a generator that stays current with its own
//! conventions, and a hand-rolled template here would be out of date within a
//! release and wrong in ways nobody would notice until much later.
//!
//! Three rules make running someone else's command honest rather than magic:
//!
//! 1. **The command is shown before it runs.** It is a template with `{name}`
//!    in it, editable in the form, so the button press *is* the confirmation.
//!    Nothing is run that the person could not read first.
//! 2. **The folder must be empty.** Every one of these generators writes into
//!    the working directory, and running one over existing work is how a
//!    repository gets flattened. Refused here, before anything starts.
//! 3. **The output is reported whole.** These commands reach the network,
//!    depend on a toolchain being installed, and fail in their own words. The
//!    app repeats those words rather than translating them into a tidy failure
//!    that hides which toolchain is missing.
//!
//! Every template works **in place**, in a folder this module creates. The
//! alternative — letting each generator make its own subfolder — means half of
//! them take a name argument and half do not, and the target path depends on
//! which language was picked.

use std::path::Path;
use std::process::Command;

/// One language the platform can start a project in.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Starter {
    pub id: String,
    pub label: String,
    /// The command, with `{name}` where the Solution's name goes. Shown in the
    /// form and editable before anything runs.
    pub command: String,
    /// What someone needs installed for it to work, said plainly rather than
    /// discovered through a confusing error.
    pub needs: String,
}

fn starter(id: &str, label: &str, command: &str, needs: &str) -> Starter {
    Starter {
        id: id.into(),
        label: label.into(),
        command: command.into(),
        needs: needs.into(),
    }
}

/// The languages offered, each with its own toolchain's generator.
///
/// Every command is the **non-interactive** form. A generator that stops to ask
/// a question would hang with its prompt somewhere nobody can see it, so the
/// interactive spellings (`npm create vite@latest` with no template, `gradle
/// init` with no type) are deliberately not used.
pub fn starters() -> Vec<Starter> {
    vec![
        starter(
            "rust",
            "Rust (cargo)",
            "cargo init --name {name}",
            "the Rust toolchain (rustup)",
        ),
        starter(
            "react-ts",
            "TypeScript — React + Vite",
            "npm create vite@latest . -- --template react-ts",
            "Node.js and npm; downloads the template",
        ),
        starter(
            "node-ts",
            "TypeScript — plain Node",
            "npm init -y",
            "Node.js and npm",
        ),
        starter(
            "dotnet-api",
            ".NET — Web API",
            "dotnet new webapi",
            "the .NET SDK",
        ),
        starter(
            "dotnet-console",
            ".NET — console",
            "dotnet new console",
            "the .NET SDK",
        ),
        starter("go", "Go", "go mod init {name}", "the Go toolchain"),
        starter(
            "python",
            "Python",
            "python -m venv .venv",
            "Python 3; creates a virtual environment, not a full project",
        ),
        // The escape hatch, the same one the test runner has: a fixed list can
        // never cover every language, and one editable field is the difference
        // between "these eight" and "whatever you use".
        starter(
            "custom",
            "Something else — I'll type the command",
            "",
            "whatever the command needs",
        ),
    ]
}

pub fn find(id: &str) -> Option<Starter> {
    starters().into_iter().find(|s| s.id == id)
}

/// Fills `{name}` in a command template.
///
/// Names are slugged, not passed through: a Solution called "Shop API" would
/// give `cargo init --name Shop API` — two arguments, one of them nonsense —
/// and most of these toolchains reject spaces and capitals in a package name
/// anyway.
pub fn fill(template: &str, name: &str) -> String {
    template.replace("{name}", &slug(name))
}

/// A name a package manager will accept: lowercase, words joined by hyphens,
/// nothing else. Leading digits are kept — cargo dislikes them, but inventing a
/// prefix would produce a package named something the person never chose.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut last_dash = true; // no leading dash
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "project".into()
    } else {
        out
    }
}

/// What running the generator did.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarterRun {
    /// What was actually run, after `{name}` was filled in.
    pub command: String,
    pub directory: String,
    pub succeeded: bool,
    /// stdout and stderr together, whole. When a toolchain is missing this is
    /// the only thing that says which one.
    pub output: String,
}

/// Creates the folder and runs the generator in it.
///
/// Returns `Err` only when nothing was attempted — a bad path, or a folder with
/// something already in it. A generator that ran and failed comes back as a
/// `StarterRun` with `succeeded: false` and its own words in `output`, because
/// that is a result to read rather than an error to swallow.
pub fn run(parent: &str, folder_name: &str, command: &str) -> Result<StarterRun, String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("there is no command to run — choose a language or type one".into());
    }
    let parent_path = Path::new(parent);
    if !parent_path.is_dir() {
        return Err(format!("{parent} is not a folder to create the project in"));
    }
    let slugged = slug(folder_name);
    let target = parent_path.join(&slugged);

    // The folder must be empty. Every generator here writes into the working
    // directory, and running one over existing work is how a repository gets
    // flattened.
    if target.exists() {
        let empty = std::fs::read_dir(&target)
            .map_err(|e| format!("could not look inside {}: {e}", target.display()))?
            .next()
            .is_none();
        if !empty {
            return Err(format!(
                "{} already has something in it. Starter projects are only created in an empty \
                 folder — running one over existing files would overwrite them.",
                target.display()
            ));
        }
    } else {
        std::fs::create_dir_all(&target)
            .map_err(|e| format!("could not create {}: {e}", target.display()))?;
    }

    let mut shell = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command);
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c").arg(command);
        c
    };
    let output = shell
        .current_dir(&target)
        .output()
        .map_err(|e| format!("could not run `{command}`: {e}"))?;

    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() {
        text.push('\n');
        text.push_str(&stderr);
    }

    Ok(StarterRun {
        command: command.to_string(),
        directory: target.to_string_lossy().to_string(),
        succeeded: output.status.success(),
        output: text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "coperativeai-starter-{}-{name}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    #[test]
    fn a_name_becomes_something_a_package_manager_accepts() {
        assert_eq!(slug("Shop API"), "shop-api");
        assert_eq!(slug("  Shop   API  "), "shop-api");
        assert_eq!(slug("Basket/Checkout!"), "basket-checkout");
        assert_eq!(slug("café"), "caf");
        assert_eq!(slug("!!!"), "project", "something unusable still gets a name");
    }

    /// `cargo init --name Shop API` is two arguments, one of them nonsense.
    #[test]
    fn the_name_is_slugged_where_it_lands_in_the_command() {
        assert_eq!(
            fill("cargo init --name {name}", "Shop API"),
            "cargo init --name shop-api"
        );
        assert_eq!(
            fill("npm create vite@latest . -- --template react-ts", "Shop API"),
            "npm create vite@latest . -- --template react-ts",
            "a template with no placeholder is left alone"
        );
    }

    /// The rule that protects existing work. Every generator here writes into
    /// the working directory.
    #[test]
    fn a_folder_with_something_in_it_is_refused_before_anything_runs() {
        let parent = scratch("occupied");
        let existing = parent.join("shop-api");
        std::fs::create_dir_all(&existing).expect("dir");
        std::fs::write(existing.join("README.md"), "someone's work").expect("file");

        let err = run(parent.to_str().unwrap(), "Shop API", "echo hello")
            .expect_err("must refuse");
        assert!(err.contains("already has something in it"), "got: {err}");
        // and it really did not run
        assert_eq!(
            std::fs::read_to_string(existing.join("README.md")).expect("still there"),
            "someone's work"
        );
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn the_folder_is_created_and_the_command_runs_inside_it() {
        let parent = scratch("creates");
        let run = run(parent.to_str().unwrap(), "Shop API", "echo started here")
            .expect("should run");

        assert!(run.succeeded, "output was: {}", run.output);
        assert!(run.output.contains("started here"), "got: {}", run.output);
        assert!(run.directory.ends_with("shop-api"), "got: {}", run.directory);
        assert!(parent.join("shop-api").is_dir());
        let _ = std::fs::remove_dir_all(&parent);
    }

    /// A generator that ran and failed is a result to read, not an error to
    /// swallow — the output is the only thing that says which toolchain is
    /// missing.
    #[test]
    fn a_failing_generator_reports_rather_than_erroring() {
        let parent = scratch("failing");
        let outcome = run(
            parent.to_str().unwrap(),
            "Broken",
            "this-command-does-not-exist-9317",
        )
        .expect("the attempt itself is not an error");

        assert!(!outcome.succeeded);
        assert!(!outcome.output.trim().is_empty(), "the shell's words must survive");
        let _ = std::fs::remove_dir_all(&parent);
    }

    /// One offered starter, run for real. Every other test here drives `echo`,
    /// which proves the plumbing and nothing about whether the commands work.
    ///
    /// Skipped rather than failed when cargo is absent: this asserts that *our*
    /// template is right, not that every machine has Rust installed, and a test
    /// that fails on a machine without a toolchain is a test people learn to
    /// ignore.
    #[test]
    fn the_rust_starter_really_creates_a_project() {
        let available = Command::new("cargo")
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !available {
            eprintln!("skipped: cargo is not on PATH");
            return;
        }

        let parent = scratch("real-rust");
        let template = find("rust").expect("the rust starter").command;
        let outcome = run(
            parent.to_str().unwrap(),
            "Shop Core",
            &fill(&template, "Shop Core"),
        )
        .expect("should run");

        assert!(outcome.succeeded, "cargo said: {}", outcome.output);
        let manifest = parent.join("shop-core").join("Cargo.toml");
        assert!(manifest.is_file(), "no Cargo.toml at {}", manifest.display());
        let text = std::fs::read_to_string(&manifest).expect("read manifest");
        assert!(
            text.contains("shop-core"),
            "the slugged name should be the package name: {text}"
        );
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn an_empty_command_is_refused() {
        let parent = scratch("empty-command");
        assert!(run(parent.to_str().unwrap(), "X", "   ").is_err());
        let _ = std::fs::remove_dir_all(&parent);
    }

    /// Every offered command must be non-interactive: a generator that stops to
    /// ask a question would hang with its prompt where nobody can see it.
    #[test]
    fn every_starter_is_named_and_non_interactive() {
        let all = starters();
        assert!(all.iter().any(|s| s.id == "rust"));
        assert!(all.iter().any(|s| s.id == "custom"), "the escape hatch is always there");
        for s in &all {
            assert!(!s.label.is_empty(), "{} needs a label", s.id);
            assert!(!s.needs.is_empty(), "{} must say what it needs", s.id);
            if s.id != "custom" {
                assert!(!s.command.is_empty(), "{} needs a command", s.id);
            }
        }
        // the vite template is pinned to a template flag, which is what makes
        // it non-interactive
        let vite = find("react-ts").expect("react-ts");
        assert!(vite.command.contains("--template"), "got: {}", vite.command);
    }
}
