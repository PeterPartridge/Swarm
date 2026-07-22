//! Running a Solution's unit tests, whatever language they are written in.
//!
//! The platform cannot know every test framework, so it does not pretend to.
//! Three things make "regardless of language" real without lying about it:
//!
//! 1. **Detection finds every suite, not the first one.** A Tauri Solution has
//!    a `package.json` at the root and a `Cargo.toml` in `src-tauri`; stopping
//!    at the first marker would silently run half the tests and report green.
//!    Detection therefore looks at the root *and* one level down, and returns
//!    every suite it recognises.
//! 2. **A per-Solution command overrides detection entirely**, so a language
//!    nobody here has heard of is one text field away from working.
//! 3. **Counts are only shown when they were actually read.** Each parser
//!    returns `None` when the output is not the shape it expects, and the run
//!    falls back to the exit code with `counted: false`. A test count the app
//!    invented would be worse than no test count — same rule as never showing
//!    a cost the app cannot see.
//!
//! Parsers are pure functions over captured output, so every one of them is
//! tested against a real capture without needing that language installed.

use std::path::{Path, PathBuf};
use std::process::Command;

/// One test suite found in (or configured for) a Solution.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suite {
    /// "cargo" | "vitest" | "jest" | "npm" | "pytest" | "dotnet" | "go" | "custom"
    pub kind: String,
    /// Directory relative to the Solution root ("." for the root itself).
    pub directory: String,
    /// What will be run, as a person would type it.
    pub command_line: String,
    /// Why this suite was picked — the file that gave it away.
    pub found_by: String,
}

/// One test's result.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestOutcome {
    pub name: String,
    /// "passed" | "failed" | "skipped"
    pub state: String,
}

/// What came back from running one suite.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuiteRun {
    pub suite: Suite,
    pub passed: i64,
    pub failed: i64,
    pub skipped: i64,
    /// **Whether the numbers above were read from the output.** False means the
    /// run is reported by exit code alone and the counts must not be shown.
    pub counted: bool,
    /// The process exit status — the one thing that is always true.
    pub exit_ok: bool,
    pub tests: Vec<TestOutcome>,
    /// stdout and stderr, kept whole. When parsing fails this is all there is,
    /// and it is what someone needs in order to fix the command.
    pub output: String,
    pub duration_ms: i64,
}

/// The counts a parser managed to read.
#[derive(Debug, Clone, PartialEq)]
pub struct Parsed {
    pub passed: i64,
    pub failed: i64,
    pub skipped: i64,
    pub tests: Vec<TestOutcome>,
}

/// Directories never worth descending into looking for test suites.
const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", ".git", "dist", "build", "vendor", ".venv", "venv",
    "__pycache__", "bin", "obj", ".next", "coverage",
];

/// Every test suite in a Solution: the root, then one level down.
///
/// One level is enough for the layouts this platform actually creates (a Tauri
/// app, an API beside a web front end) and stops well short of walking a whole
/// repository, which on a large checkout would be slow and would find other
/// people's fixtures.
pub fn detect(root: &Path) -> Vec<Suite> {
    let mut suites = Vec::new();
    suites.extend(detect_in(root, "."));
    let Ok(entries) = std::fs::read_dir(root) else {
        return suites;
    };
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| !n.starts_with('.') && !SKIP_DIRS.contains(&n))
                .unwrap_or(false)
        })
        .collect();
    dirs.sort();
    for dir in dirs {
        let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        suites.extend(detect_in(&dir, &name));
    }
    suites
}

/// The suites in exactly one directory.
fn detect_in(dir: &Path, label: &str) -> Vec<Suite> {
    let mut found = Vec::new();
    let has = |name: &str| dir.join(name).exists();
    let suite = |kind: &str, command_line: &str, found_by: &str| Suite {
        kind: kind.into(),
        directory: label.into(),
        command_line: command_line.into(),
        found_by: found_by.into(),
    };

    if has("Cargo.toml") {
        found.push(suite("cargo", "cargo test", "Cargo.toml"));
    }
    if has("go.mod") {
        found.push(suite("go", "go test -json ./...", "go.mod"));
    }
    if has("package.json") {
        let manifest = std::fs::read_to_string(dir.join("package.json")).unwrap_or_default();
        // Read the manifest rather than guessing: a project with both installed
        // still has one it actually runs, and the script is the evidence.
        found.push(if manifest.contains("\"vitest\"") {
            suite("vitest", "npx vitest run --reporter=json", "package.json")
        } else if manifest.contains("\"jest\"") {
            suite("jest", "npx jest --json", "package.json")
        } else {
            suite("npm", "npm test", "package.json")
        });
    }
    for marker in ["pyproject.toml", "pytest.ini", "tox.ini", "setup.cfg"] {
        if has(marker) {
            found.push(suite("pytest", "python -m pytest -v", marker));
            break;
        }
    }
    if dir.join("*.sln").exists() || has_extension(dir, "sln") || has_extension(dir, "csproj") {
        found.push(suite("dotnet", "dotnet test", "a .sln or .csproj"));
    }
    found
}

fn has_extension(dir: &Path, ext: &str) -> bool {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries.filter_map(|e| e.ok()).any(|e| {
                e.path().extension().and_then(|x| x.to_str()) == Some(ext)
            })
        })
        .unwrap_or(false)
}

/// A Solution's own command, replacing detection.
pub fn custom_suite(command_line: &str) -> Suite {
    Suite {
        kind: "custom".into(),
        directory: ".".into(),
        command_line: command_line.trim().to_string(),
        found_by: "set on this Solution".into(),
    }
}

/// Runs one suite and reports what came back.
///
/// Never returns `Err` for a failing test run: tests that fail are an outcome,
/// not an error. Only a command that could not be started at all is an error,
/// and that is reported through `exit_ok` plus the output so the person can see
/// what the shell said.
pub fn run(root: &Path, suite: &Suite) -> SuiteRun {
    let dir = if suite.directory == "." {
        root.to_path_buf()
    } else {
        root.join(&suite.directory)
    };
    let started = std::time::Instant::now();

    let output = spawn(&dir, &suite.command_line);
    let duration_ms = started.elapsed().as_millis() as i64;

    let (exit_ok, text) = match output {
        Ok((ok, text)) => (ok, text),
        Err(message) => (false, message),
    };

    let parsed = parse(&suite.kind, &text);
    let counted = parsed.is_some();
    let parsed = parsed.unwrap_or(Parsed {
        passed: 0,
        failed: 0,
        skipped: 0,
        tests: Vec::new(),
    });

    SuiteRun {
        suite: suite.clone(),
        passed: parsed.passed,
        failed: parsed.failed,
        skipped: parsed.skipped,
        counted,
        exit_ok,
        tests: parsed.tests,
        output: text,
        duration_ms,
    }
}

/// Runs a command line in a directory, returning (succeeded, stdout+stderr).
///
/// Through the platform's shell rather than split on spaces: a command line is
/// what a person typed, and `npm test -- --run "my test"` does not survive
/// naive splitting. On Windows this also solves `npm`/`npx` being batch shims
/// that `CreateProcess` cannot start directly.
fn spawn(dir: &Path, command_line: &str) -> Result<(bool, String), String> {
    if command_line.trim().is_empty() {
        return Err("no test command to run".into());
    }
    let mut command = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command_line);
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c").arg(command_line);
        c
    };
    let output = command
        .current_dir(dir)
        .output()
        .map_err(|e| format!("could not run `{command_line}` in {}: {e}", dir.display()))?;

    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() {
        // Several runners report results on stderr (cargo does), so it is
        // appended rather than discarded — the parsers read the whole thing.
        text.push('\n');
        text.push_str(&stderr);
    }
    Ok((output.status.success(), text))
}

/// Reads a runner's output, or `None` when it is not the expected shape.
pub fn parse(kind: &str, text: &str) -> Option<Parsed> {
    match kind {
        "cargo" => parse_cargo(text),
        "vitest" | "jest" => parse_jest_json(text),
        "pytest" => parse_pytest(text),
        "dotnet" => parse_dotnet(text),
        "go" => parse_go_json(text),
        _ => None,
    }
}

/// `cargo test` prints one summary per test binary, so they are summed rather
/// than the last one winning — a crate with unit *and* integration tests would
/// otherwise report only the last binary's results.
fn parse_cargo(text: &str) -> Option<Parsed> {
    let mut parsed = Parsed { passed: 0, failed: 0, skipped: 0, tests: Vec::new() };
    let mut saw_summary = false;

    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("test result:") {
            saw_summary = true;
            // Scanned as number-then-label pairs rather than positionally: the
            // first clause carries the verdict too ("ok. 3 passed" /
            // "FAILED. 1 passed"), and reading the fields in order would take
            // the verdict as the number and lose that clause entirely.
            for part in rest.split(';') {
                let words: Vec<&str> = part.split_whitespace().collect();
                for pair in words.windows(2) {
                    let Ok(n) = pair[0].parse::<i64>() else { continue };
                    match pair[1] {
                        "passed" => parsed.passed += n,
                        "failed" => parsed.failed += n,
                        "ignored" => parsed.skipped += n,
                        _ => {}
                    }
                }
            }
        } else if let Some(rest) = line.strip_prefix("test ") {
            // "test module::name ... ok" — the running list, not the summary.
            if let Some((name, result)) = rest.rsplit_once(" ... ") {
                let state = match result.trim() {
                    "ok" => "passed",
                    "FAILED" => "failed",
                    r if r.starts_with("ignored") => "skipped",
                    _ => continue,
                };
                parsed.tests.push(TestOutcome {
                    name: name.trim().to_string(),
                    state: state.into(),
                });
            }
        }
    }
    saw_summary.then_some(parsed)
}

/// vitest `--reporter=json` and jest `--json` share these field names.
///
/// The JSON is located rather than assumed to be the whole output, because both
/// tools happily print warnings above it and `serde_json` on the raw text would
/// fail on a run that actually worked.
fn parse_jest_json(text: &str) -> Option<Parsed> {
    let start = text.find('{')?;
    let value: serde_json::Value = serde_json::from_str(text[start..].trim_end()).ok()?;
    let num = |key: &str| value.get(key).and_then(|v| v.as_i64());
    let passed = num("numPassedTests")?;

    let mut tests = Vec::new();
    if let Some(files) = value.get("testResults").and_then(|v| v.as_array()) {
        for file in files {
            let inner = file
                .get("assertionResults")
                .or_else(|| file.get("testResults"))
                .and_then(|v| v.as_array());
            for case in inner.unwrap_or(&Vec::new()) {
                let Some(name) = case.get("fullName").or_else(|| case.get("title")).and_then(|v| v.as_str()) else {
                    continue;
                };
                let state = match case.get("status").and_then(|v| v.as_str()) {
                    Some("passed") => "passed",
                    Some("failed") => "failed",
                    _ => "skipped",
                };
                tests.push(TestOutcome { name: name.to_string(), state: state.into() });
            }
        }
    }
    Some(Parsed {
        passed,
        failed: num("numFailedTests").unwrap_or(0),
        skipped: num("numPendingTests").unwrap_or(0) + num("numTodoTests").unwrap_or(0),
        tests,
    })
}

/// pytest's `-v` output: per-test `path::name PASSED`, then a summary line.
fn parse_pytest(text: &str) -> Option<Parsed> {
    let mut parsed = Parsed { passed: 0, failed: 0, skipped: 0, tests: Vec::new() };
    let mut saw_summary = false;

    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('=') && (line.contains(" passed") || line.contains(" failed") || line.contains(" error")) {
            saw_summary = true;
            let cleaned = line.trim_matches('=').trim();
            for part in cleaned.split(',') {
                let mut words = part.split_whitespace();
                let (Some(n), Some(label)) = (words.next(), words.next()) else { continue };
                let Ok(n) = n.parse::<i64>() else { continue };
                match label.trim_end_matches(',') {
                    "passed" => parsed.passed += n,
                    "failed" | "error" | "errors" => parsed.failed += n,
                    "skipped" | "deselected" | "xfailed" => parsed.skipped += n,
                    _ => {}
                }
            }
        } else if let Some((name, rest)) = line.split_once(" PASSED") {
            let _ = rest;
            parsed.tests.push(TestOutcome { name: name.trim().into(), state: "passed".into() });
        } else if let Some((name, _)) = line.split_once(" FAILED") {
            parsed.tests.push(TestOutcome { name: name.trim().into(), state: "failed".into() });
        } else if let Some((name, _)) = line.split_once(" SKIPPED") {
            parsed.tests.push(TestOutcome { name: name.trim().into(), state: "skipped".into() });
        }
    }
    saw_summary.then_some(parsed)
}

/// `dotnet test` ends with `Passed!  - Failed: 0, Passed: 12, Skipped: 0, ...`
fn parse_dotnet(text: &str) -> Option<Parsed> {
    let line = text
        .lines()
        .rev()
        .find(|l| l.contains("Failed:") && l.contains("Passed:"))?;
    let mut parsed = Parsed { passed: 0, failed: 0, skipped: 0, tests: Vec::new() };
    for part in line.split(',') {
        let Some((label, n)) = part.split_once(':') else { continue };
        let Ok(n) = n.split_whitespace().next().unwrap_or("").parse::<i64>() else {
            continue;
        };
        match label.trim().trim_start_matches(|c: char| !c.is_alphabetic()) {
            "Passed" => parsed.passed = n,
            "Failed" => parsed.failed = n,
            "Skipped" => parsed.skipped = n,
            _ => {}
        }
    }
    Some(parsed)
}

/// `go test -json` emits one JSON object per line; the ones carrying a `Test`
/// name and a terminal action are the results.
fn parse_go_json(text: &str) -> Option<Parsed> {
    let mut parsed = Parsed { passed: 0, failed: 0, skipped: 0, tests: Vec::new() };
    let mut saw_any = false;

    for line in text.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
            continue;
        };
        let Some(action) = value.get("Action").and_then(|v| v.as_str()) else { continue };
        saw_any = true;
        // Package-level results have no "Test" and would double every count.
        let Some(name) = value.get("Test").and_then(|v| v.as_str()) else { continue };
        let state = match action {
            "pass" => "passed",
            "fail" => "failed",
            "skip" => "skipped",
            _ => continue,
        };
        match state {
            "passed" => parsed.passed += 1,
            "failed" => parsed.failed += 1,
            _ => parsed.skipped += 1,
        }
        parsed.tests.push(TestOutcome { name: name.to_string(), state: state.into() });
    }
    saw_any.then_some(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cargo_output_is_read_including_every_binarys_summary() {
        let text = "\
running 2 tests
test db::product::tests::created_product_is_listed ... ok
test db::product::tests::name_is_required ... FAILED

test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out

running 1 test
test integration::end_to_end ... ok

test result: ok. 1 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out
";
        let p = parse("cargo", text).expect("cargo output should parse");
        assert_eq!(p.passed, 2, "both binaries' passes are summed");
        assert_eq!(p.failed, 1);
        assert_eq!(p.skipped, 2);
        assert_eq!(p.tests.len(), 3);
        assert_eq!(p.tests[1].state, "failed");
    }

    #[test]
    fn vitest_json_is_read_with_its_test_names() {
        let text = r#"some warning on the way out
{"numTotalTests":3,"numPassedTests":2,"numFailedTests":1,"numPendingTests":0,
 "testResults":[{"assertionResults":[
   {"fullName":"adds a product","status":"passed"},
   {"fullName":"rejects a blank name","status":"failed"}]}]}"#;
        let p = parse("vitest", text).expect("vitest json should parse");
        assert_eq!((p.passed, p.failed), (2, 1));
        assert_eq!(p.tests[1].name, "rejects a blank name");
        assert_eq!(p.tests[1].state, "failed");
    }

    #[test]
    fn pytest_output_is_read() {
        let text = "\
tests/test_shop.py::test_checkout PASSED                        [ 50%]
tests/test_shop.py::test_refund FAILED                          [100%]

=================== 1 failed, 1 passed, 2 skipped in 0.42s ===================
";
        let p = parse("pytest", text).expect("pytest output should parse");
        assert_eq!((p.passed, p.failed, p.skipped), (1, 1, 2));
        assert_eq!(p.tests.len(), 2);
        assert_eq!(p.tests[0].name, "tests/test_shop.py::test_checkout");
    }

    #[test]
    fn dotnet_summary_is_read() {
        let text = "\
Determining projects to restore...
Passed!  - Failed:     0, Passed:    12, Skipped:     1, Total:    13, Duration: 2 s
";
        let p = parse("dotnet", text).expect("dotnet output should parse");
        assert_eq!((p.passed, p.failed, p.skipped), (12, 0, 1));
    }

    /// Package-level lines carry no `Test` and must not be counted, or every
    /// package would inflate the totals.
    #[test]
    fn go_json_counts_tests_and_not_packages() {
        let text = r#"{"Action":"run","Test":"TestCheckout"}
{"Action":"pass","Test":"TestCheckout","Elapsed":0.01}
{"Action":"fail","Test":"TestRefund","Elapsed":0.02}
{"Action":"pass","Package":"shop/api","Elapsed":0.5}
"#;
        let p = parse("go", text).expect("go json should parse");
        assert_eq!((p.passed, p.failed), (1, 1));
        assert_eq!(p.tests.len(), 2);
    }

    /// The honesty rule. Output a parser does not recognise yields no counts,
    /// so the run is reported by its exit code and the UI shows no numbers.
    #[test]
    fn output_that_is_not_the_expected_shape_yields_no_counts() {
        assert!(parse("cargo", "error: could not compile").is_none());
        assert!(parse("vitest", "command not found").is_none());
        assert!(parse("pytest", "ImportError: no module named pytest").is_none());
        assert!(parse("dotnet", "MSBUILD : error MSB1003").is_none());
        assert!(parse("go", "no Go files").is_none());
        assert!(parse("custom", "42 tests passed").is_none(), "a custom command has no known shape");
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "coperativeai-detect-{}-{name}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    /// The case this platform actually creates: a Tauri Solution, with the web
    /// tests at the root and the Rust tests one level down. Stopping at the
    /// first marker would run half the tests and call the Solution green.
    #[test]
    fn both_halves_of_a_tauri_solution_are_found() {
        let dir = scratch("tauri");
        std::fs::write(dir.join("package.json"), r#"{"devDependencies":{"vitest":"3"}}"#)
            .expect("manifest");
        std::fs::create_dir_all(dir.join("src-tauri")).expect("subdir");
        std::fs::write(dir.join("src-tauri/Cargo.toml"), "[package]\nname=\"x\"").expect("cargo");

        let suites = detect(&dir);
        let kinds: Vec<&str> = suites.iter().map(|s| s.kind.as_str()).collect();
        assert!(kinds.contains(&"vitest"), "got {kinds:?}");
        assert!(kinds.contains(&"cargo"), "got {kinds:?}");
        let cargo = suites.iter().find(|s| s.kind == "cargo").unwrap();
        assert_eq!(cargo.directory, "src-tauri");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_manifest_decides_between_vitest_and_jest() {
        let dir = scratch("jest");
        std::fs::write(dir.join("package.json"), r#"{"devDependencies":{"jest":"29"}}"#)
            .expect("manifest");
        assert_eq!(detect(&dir)[0].kind, "jest");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A package.json naming neither falls back to `npm test`, which is what a
    /// person would run — better than refusing because we did not recognise it.
    #[test]
    fn an_unrecognised_manifest_still_gets_npm_test() {
        let dir = scratch("plain");
        std::fs::write(dir.join("package.json"), r#"{"scripts":{"test":"mocha"}}"#)
            .expect("manifest");
        let suites = detect(&dir);
        assert_eq!(suites[0].kind, "npm");
        assert_eq!(suites[0].command_line, "npm test");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn generated_directories_are_never_searched() {
        let dir = scratch("noise");
        std::fs::create_dir_all(dir.join("node_modules/some-package")).expect("nm");
        std::fs::write(dir.join("node_modules/package.json"), "{}").expect("manifest");
        std::fs::create_dir_all(dir.join("target")).expect("target");
        std::fs::write(dir.join("target/Cargo.toml"), "[package]").expect("cargo");
        assert!(detect(&dir).is_empty(), "node_modules and target are not suites");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_folder_with_nothing_recognisable_offers_no_suites() {
        let dir = scratch("empty");
        std::fs::write(dir.join("README.md"), "# hi").expect("readme");
        assert!(detect(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A failing test run is an outcome, not an error: the run still reports,
    /// with the exit code telling the truth.
    #[test]
    fn a_command_that_fails_still_reports_rather_than_erroring() {
        let dir = scratch("failing");
        let suite = custom_suite(if cfg!(windows) { "exit /b 1" } else { "exit 1" });
        let run = run(&dir, &suite);
        assert!(!run.exit_ok);
        assert!(!run.counted, "a custom command's output has no known shape");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_custom_command_runs_and_keeps_its_output() {
        let dir = scratch("custom");
        let suite = custom_suite("echo hello from the suite");
        let run = run(&dir, &suite);
        assert!(run.exit_ok);
        assert!(run.output.contains("hello from the suite"), "got: {}", run.output);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
