//! Finding the assembly a .NET Solution has actually built.
//!
//! **netcoredbg debugs a built `.dll`, not source.** Delve is given a folder and
//! compiles it; js-debug is given a `.js` file and runs it; netcoredbg is given
//! the output of a build that has to have happened already. So "what do I
//! launch?" is a real question for C# and a trivial one for the other two.
//!
//! The answer is under `bin/<configuration>/<target framework>/`, and picking
//! the right file out of it is less obvious than it looks:
//!
//! - `obj/` holds `.dll`s too — intermediate ones, and `ref/` and `refint/`
//!   hold reference assemblies that contain no code at all. Launching one of
//!   those starts a debugger against a program that cannot run.
//! - The output folder also holds every dependency's `.dll`.
//!
//! The thing that separates the program from its dependencies is a sibling
//! **`.runtimeconfig.json`** — the .NET SDK writes one only for an assembly
//! that is meant to be executed. That is the signal used here, rather than
//! matching on the folder's name, which breaks the moment a project is named
//! differently from its directory.

use std::path::{Path, PathBuf};

/// A runnable assembly built under `root`, and which configuration it came
/// from.
///
/// **Debug wins over anything newer.** Picking the most recent build sounds
/// right and is not: somebody who ran `dotnet build -c Release` after a Debug
/// build would then be debugging optimised code, where the compiler has moved
/// lines around, inlined calls and dropped locals altogether. That presents as
/// a debugger that stops on the wrong line and cannot see variables that are
/// plainly in the source — which reads as this app being broken.
///
/// So a Debug build is preferred however old it is, and the configuration is
/// handed back so the caller can say plainly when there was only a Release one.
pub fn built_assembly(root: &Path) -> Option<(PathBuf, String)> {
    let bin = root.join("bin");
    if !bin.is_dir() {
        return None;
    }

    // Newest within a configuration, but never across one: a stale Debug build
    // is still a better thing to debug than a fresh Release one.
    let mut best: Option<(bool, std::time::SystemTime, PathBuf, String)> = None;
    // bin/<configuration>/<target framework>/ — two levels, and no deeper:
    // `publish/` and `ref/` below that are not what a debugger wants.
    for configuration in read_dirs(&bin) {
        let name = configuration
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        let debuggable = name.eq_ignore_ascii_case("debug");
        for framework in read_dirs(&configuration) {
            for entry in std::fs::read_dir(&framework).into_iter().flatten().flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("dll") {
                    continue;
                }
                // The marker that this is the program rather than one of the
                // libraries sitting beside it.
                if !path.with_extension("runtimeconfig.json").is_file() {
                    continue;
                }
                let when = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(std::time::UNIX_EPOCH);
                // Debug first, then newest. Ordering the tuple this way is the
                // whole rule: a Debug build only ever loses to another Debug
                // build, and a Release one only ever wins when nothing else is
                // there.
                let better = best
                    .as_ref()
                    .is_none_or(|(was_debug, newest, _, _)| match (debuggable, was_debug) {
                        (true, false) => true,
                        (false, true) => false,
                        _ => when > *newest,
                    });
                if better {
                    best = Some((debuggable, when, path, name.clone()));
                }
            }
        }
    }
    best.map(|(_, _, path, configuration)| (path, configuration))
}

fn read_dirs(at: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(at)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        crate::testing::scratch("dotnet", name)
    }

    /// A dll with a runtimeconfig beside it is the program.
    #[test]
    fn the_built_program_is_found_under_bin() {
        let root = scratch("found");
        let out = root.join("bin").join("Debug").join("net8.0");
        std::fs::create_dir_all(&out).expect("out");
        std::fs::write(out.join("Shop.dll"), "x").expect("dll");
        std::fs::write(out.join("Shop.runtimeconfig.json"), "{}").expect("config");

        assert_eq!(built_assembly(&root), Some((out.join("Shop.dll"), "Debug".into())));
    }

    /// **The one that would launch something unrunnable.** `obj/` holds
    /// intermediate assemblies and `ref/` holds reference assemblies with no
    /// code in them at all.
    #[test]
    fn intermediate_and_reference_assemblies_are_ignored() {
        let root = scratch("obj");
        let obj = root.join("obj").join("Debug").join("net8.0");
        std::fs::create_dir_all(obj.join("ref")).expect("obj");
        std::fs::write(obj.join("Shop.dll"), "x").expect("dll");
        std::fs::write(obj.join("Shop.runtimeconfig.json"), "{}").expect("config");
        std::fs::write(obj.join("ref").join("Shop.dll"), "x").expect("ref dll");

        // Nothing under bin/, so nothing to launch — obj/ is not an answer.
        assert_eq!(built_assembly(&root), None);
    }

    /// The output folder is full of dependencies. Only the program has a
    /// runtimeconfig.
    #[test]
    fn dependencies_beside_the_program_are_not_mistaken_for_it() {
        let root = scratch("deps");
        let out = root.join("bin").join("Debug").join("net8.0");
        std::fs::create_dir_all(&out).expect("out");
        std::fs::write(out.join("Newtonsoft.Json.dll"), "x").expect("dep");
        std::fs::write(out.join("Serilog.dll"), "x").expect("dep");
        std::fs::write(out.join("Shop.dll"), "x").expect("dll");
        std::fs::write(out.join("Shop.runtimeconfig.json"), "{}").expect("config");

        assert_eq!(built_assembly(&root), Some((out.join("Shop.dll"), "Debug".into())));
    }

    /// Nothing built is a real state, and the caller has to be able to say
    /// "build it first" rather than launch a stale or absent file.
    #[test]
    fn a_project_that_has_not_been_built_finds_nothing() {
        let root = scratch("unbuilt");
        std::fs::write(root.join("Shop.csproj"), "<Project />").expect("csproj");
        assert_eq!(built_assembly(&root), None);
    }

    /// **Debug wins over anything newer, and that is the rule.** Picking the
    /// most recent build sounds right and is not: somebody who ran
    /// `dotnet build -c Release` after a Debug build would be debugging
    /// optimised code, where lines have moved, calls have been inlined and
    /// locals are simply gone. That looks exactly like a broken debugger.
    #[test]
    fn a_debug_build_is_preferred_over_a_newer_release_one() {
        let root = scratch("prefers-debug");
        let debug = root.join("bin").join("Debug").join("net8.0");
        let release = root.join("bin").join("Release").join("net8.0");
        for dir in [&debug, &release] {
            std::fs::create_dir_all(dir).expect("out");
            std::fs::write(dir.join("Shop.dll"), "x").expect("dll");
            std::fs::write(dir.join("Shop.runtimeconfig.json"), "{}").expect("config");
        }
        // Release built *after* Debug, which is the case that used to lose.
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(release.join("Shop.dll"), "xx").expect("touch");

        assert_eq!(
            built_assembly(&root),
            Some((debug.join("Shop.dll"), "Debug".into())),
            "a stale Debug build still beats a fresh Release one"
        );
    }

    /// Only a Release build is a real situation, and it is used — but the
    /// configuration comes back so the caller can say so rather than leaving
    /// somebody to work out why the debugger keeps stopping in odd places.
    #[test]
    fn only_a_release_build_is_used_and_named() {
        let root = scratch("release-only");
        let release = root.join("bin").join("Release").join("net8.0");
        std::fs::create_dir_all(&release).expect("out");
        std::fs::write(release.join("Shop.dll"), "x").expect("dll");
        std::fs::write(release.join("Shop.runtimeconfig.json"), "{}").expect("config");

        assert_eq!(
            built_assembly(&root),
            Some((release.join("Shop.dll"), "Release".into()))
        );
    }

    /// Rebuilding into a second target framework must not send the debugger at
    /// yesterday's output.
    #[test]
    fn the_newest_build_wins() {
        let root = scratch("newest");
        let old = root.join("bin").join("Debug").join("net6.0");
        let new = root.join("bin").join("Debug").join("net8.0");
        for dir in [&old, &new] {
            std::fs::create_dir_all(dir).expect("out");
            std::fs::write(dir.join("Shop.dll"), "x").expect("dll");
            std::fs::write(dir.join("Shop.runtimeconfig.json"), "{}").expect("config");
        }
        // Make the net8.0 one unambiguously newer.
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(new.join("Shop.dll"), "xx").expect("touch");

        assert_eq!(built_assembly(&root), Some((new.join("Shop.dll"), "Debug".into())));
    }
}
