//! Which Python file to start, given a Solution's folder.
//!
//! **The launch shape's whole difficulty.** Go is handed a folder and Delve
//! builds it; C# is handed a built assembly, which either exists or does not.
//! Python has neither: a folder of `.py` files says nothing about which one is
//! the program, and debugpy launches exactly the file it is given.
//!
//! So this looks for the conventional entry points by name, in order, and
//! **refuses rather than guesses** when none of them is there. A debugger
//! pointed at the wrong file starts, runs something, and stops at none of the
//! breakpoints — which reads as a broken debugger rather than as a wrong file.

use std::path::{Path, PathBuf};

/// The files a Python project is started from, in the order they are tried.
///
/// Ordered by how strongly each *means* "this is the program": `main.py` is the
/// near-universal convention, `manage.py` is Django's and is unambiguous,
/// `app.py` is Flask's, and `run.py` and `__main__.py` are common enough to
/// beat refusing. A folder holding several is answered with the first — which
/// is why the caller says which one it picked.
pub const CANDIDATES: &[&str] = &[
    "main.py",
    "manage.py",
    "app.py",
    "__main__.py",
    "run.py",
    "src/main.py",
    "src/app.py",
];

/// The file to hand debugpy, or why there is not one.
///
/// The error is the whole list of what was looked for, because "no entry point
/// found" on its own leaves somebody guessing at this function's opinions.
pub fn entry_script(root: &Path) -> Result<PathBuf, String> {
    for name in CANDIDATES {
        // Written with forward slashes above; `join` on each segment so
        // `src/main.py` is a path rather than a filename containing a slash.
        let mut candidate = root.to_path_buf();
        for part in name.split('/') {
            candidate = candidate.join(part);
        }
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    // A package run with `python -m thing` keeps its entry in
    // `thing/__main__.py`. Only when there is exactly one: two of them is a
    // real choice, and picking the alphabetically first would be a coin toss
    // presented as a decision.
    let packages = packages_with_main(root);
    match packages.len() {
        1 => Ok(packages.into_iter().next().expect("one")),
        0 => Err(format!(
            "nothing in {} looks like the program to start. Python is debugged by running one \
             file, so this looked for {} — and for a single package with a __main__.py. Add one, \
             or rename the file you start.",
            root.display(),
            CANDIDATES.join(", ")
        )),
        _ => Err(format!(
            "{} holds more than one package with a __main__.py ({}), so which one is the program \
             is a real choice rather than something to guess at. Add a main.py at the top naming \
             the one you mean.",
            root.display(),
            packages
                .iter()
                .filter_map(|p| p.parent()?.file_name())
                .map(|n| n.to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}

/// Every `<package>/__main__.py` one level down, where the folder is a package.
///
/// One level only: a `__main__.py` four directories deep is somebody's
/// submodule, not the way the project is started.
fn packages_with_main(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            // Virtual environments and caches hold plenty of `__main__.py`
            // belonging to other people's code.
            !name.starts_with('.')
                && !matches!(
                    name.as_str(),
                    "venv" | ".venv" | "env" | "__pycache__" | "site-packages" | "node_modules"
                )
        })
        .map(|e| e.path())
        .filter(|dir| dir.join("__init__.py").is_file() && dir.join("__main__.py").is_file())
        .map(|dir| dir.join("__main__.py"))
        .collect();
    // Stable, so a folder with two of them names them the same way twice.
    found.sort();
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("coperativeai-py-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn write(root: &Path, rel: &str) {
        let mut path = root.to_path_buf();
        for part in rel.split('/') {
            path = path.join(part);
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("parent");
        }
        std::fs::write(&path, "print('hello')\n").expect("write");
    }

    #[test]
    fn the_conventional_names_are_found_in_order() {
        let root = temp("order");
        write(&root, "app.py");
        write(&root, "main.py");

        // Both are there; `main.py` means "this is the program" more strongly.
        assert_eq!(entry_script(&root).expect("found"), root.join("main.py"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_nested_conventional_name_counts() {
        let root = temp("nested");
        write(&root, "src/main.py");
        assert_eq!(
            entry_script(&root).expect("found"),
            root.join("src").join("main.py")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// `python -m thing` keeps its entry in `thing/__main__.py`, and that is a
    /// perfectly ordinary way to ship a Python program.
    #[test]
    fn a_single_package_with_a_main_is_the_program() {
        let root = temp("package");
        write(&root, "shop/__init__.py");
        write(&root, "shop/__main__.py");

        assert_eq!(
            entry_script(&root).expect("found"),
            root.join("shop").join("__main__.py")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A folder without `__init__.py` is not a package, and a `__main__.py` in
    /// it is not how anything is started.
    #[test]
    fn a_folder_that_is_not_a_package_does_not_count() {
        let root = temp("notpackage");
        write(&root, "scripts/__main__.py");
        assert!(entry_script(&root).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Two of them is a real choice. Picking the alphabetically first would be
    /// a coin toss presented as a decision.
    #[test]
    fn two_packages_are_named_rather_than_chosen_between() {
        let root = temp("two");
        for package in ["shop", "worker"] {
            write(&root, &format!("{package}/__init__.py"));
            write(&root, &format!("{package}/__main__.py"));
        }

        let err = entry_script(&root).expect_err("ambiguous");
        assert!(err.contains("shop"), "got: {err}");
        assert!(err.contains("worker"), "got: {err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A virtual environment is full of other people's `__main__.py`.
    #[test]
    fn a_virtualenv_is_not_the_program() {
        let root = temp("venv");
        write(&root, "venv/__init__.py");
        write(&root, "venv/__main__.py");
        assert!(entry_script(&root).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **The refusal has to be actionable.** "No entry point found" leaves
    /// somebody guessing at this function's opinions, so it lists them.
    #[test]
    fn nothing_found_says_what_was_looked_for() {
        let root = temp("empty");
        write(&root, "utils.py");

        let err = entry_script(&root).expect_err("nothing to start");
        for name in CANDIDATES {
            assert!(err.contains(name), "{name} is not named in: {err}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }
}
