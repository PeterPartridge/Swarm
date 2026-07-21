//! Change review: what came back, checked against the Developer Rules.
//!
//! This is the layer that makes an agent's output reviewable rather than
//! merely accepted. It works on any change in a working copy — written by
//! Claude Code, by another tool, or by a person — because the check is about
//! the diff, not about who produced it.
//!
//! **What it checks is the code that was added, never the code that was
//! removed.** A diff that deletes the last Java file mentions Java on every
//! removed line; flagging that would be reporting the fix as the fault. This is
//! the same lesson the solution-strategy check learned the expensive way, where
//! a model was flagged for writing "No Java or PHP anywhere" in obedience.

use crate::db::developer_rules::{self, DeveloperRules};
use crate::workspace::FileChange;

/// Test files, by the conventions that actually appear in repositories.
const TEST_MARKERS: &[&str] = &[
    "test", "tests", "spec", "specs", "__tests__", "_test.", ".test.", ".spec.",
];

/// Extensions that are source rather than lockfiles, assets or generated noise.
const SOURCE_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "cs", "rb", "php", "kt", "swift", "c",
    "cpp", "h", "hpp", "scala", "ex", "exs",
];

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFinding {
    /// "disallowedTech" | "noTests".
    ///
    /// Deliberately no "unlistedTech", which the solution-strategy check does
    /// have: that one compares the technologies a proposal **declares** against
    /// the allow list, and a diff declares nothing. Inferring the technologies
    /// from source text would be guesswork, and a guess in a rules report is
    /// how people learn to ignore the report.
    pub kind: String,
    /// Empty when the finding is about the change as a whole.
    pub path: String,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewReport {
    /// A rule was broken. These block.
    pub violations: Vec<ReviewFinding>,
    /// Worth a person's attention, but not a breach.
    pub notices: Vec<ReviewFinding>,
    pub files_changed: i64,
    pub added_lines: i64,
    pub removed_lines: i64,
}

/// Reviews a set of changes against a Product's developer rules.
pub fn review(changes: &[FileChange], rules: &DeveloperRules) -> ReviewReport {
    let mut report = ReviewReport {
        files_changed: changes.len() as i64,
        ..Default::default()
    };

    for change in changes {
        report.added_lines += change.added_lines;
        report.removed_lines += change.removed_lines;

        // Only what the change *introduces*. A deletion that removes a
        // forbidden technology is the rule being obeyed, not broken.
        let introduced = added_text(change);
        if introduced.trim().is_empty() {
            continue;
        }
        for term in developer_rules::violations(&rules.disallowed_tech, &introduced) {
            report.violations.push(ReviewFinding {
                kind: "disallowedTech".into(),
                path: change.path.clone(),
                detail: format!("this change introduces {term}, which the developer rules forbid"),
            });
        }
    }

    // Tests are judged across the whole change, not per file: a new module and
    // its test usually arrive as two separate files.
    if let Some(finding) = missing_tests(changes) {
        report.notices.push(finding);
    }

    report.violations.sort_by(|a, b| a.path.cmp(&b.path).then(a.detail.cmp(&b.detail)));
    report.violations.dedup();
    report
}

/// The lines a change adds — the `+` side of a diff, or the whole file when it
/// is new. The diff markers themselves are stripped so a `+` in the source is
/// not confused with a `+` that means "added".
fn added_text(change: &FileChange) -> String {
    if change.status == "added" {
        return change.diff.clone();
    }
    change
        .diff
        .lines()
        .filter(|l| l.starts_with('+') && !l.starts_with("+++"))
        .map(|l| &l[1..])
        .collect::<Vec<_>>()
        .join("\n")
}

/// Source changed with no test touched anywhere in the set.
///
/// A **notice**, not a violation: plenty of legitimate changes have no test —
/// a config tweak, a rename, a comment. Blocking those would teach people to
/// ignore the report, which is how a check stops working.
fn missing_tests(changes: &[FileChange]) -> Option<ReviewFinding> {
    let touched_source = changes.iter().any(|c| is_source(&c.path) && !is_test(&c.path));
    let touched_test = changes.iter().any(|c| is_test(&c.path));
    if touched_source && !touched_test {
        return Some(ReviewFinding {
            kind: "noTests".into(),
            path: String::new(),
            detail: "source changed but no test file was touched".into(),
        });
    }
    None
}

fn is_source(path: &str) -> bool {
    path.rsplit('.')
        .next()
        .is_some_and(|ext| SOURCE_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
}

fn is_test(path: &str) -> bool {
    let lowered = path.to_lowercase();
    // Checked per path segment so "src/latest/x.rs" is not read as a test on
    // account of containing "test".
    lowered.split(['/', '\\']).any(|segment| {
        TEST_MARKERS.iter().any(|marker| {
            if let Some(stripped) = marker.strip_prefix('.') {
                segment.contains(&format!(".{stripped}")) || segment.starts_with(stripped)
            } else if marker.ends_with('.') {
                segment.contains(marker)
            } else {
                segment == *marker
            }
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules(disallowed: &str, allowed: &str) -> DeveloperRules {
        DeveloperRules {
            disallowed_tech: disallowed.to_string(),
            allowed_tech: allowed.to_string(),
            ..Default::default()
        }
    }

    fn change(path: &str, status: &str, diff: &str) -> FileChange {
        FileChange {
            path: path.into(),
            status: status.into(),
            added_lines: 1,
            removed_lines: 0,
            diff: diff.into(),
        }
    }

    #[test]
    fn a_forbidden_technology_introduced_by_the_change_is_a_violation() {
        let changes = vec![change(
            "src/main.rs",
            "modified",
            "--- a/src/main.rs\n+++ b/src/main.rs\n+use jquery::thing;\n context line",
        )];
        let report = review(&changes, &rules("jQuery", ""));

        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].kind, "disallowedTech");
        assert_eq!(report.violations[0].path, "src/main.rs");
    }

    /// The lesson the strategy check learned expensively: a diff that removes
    /// the last jQuery mentions jQuery on every removed line. Flagging that
    /// reports the fix as the fault.
    #[test]
    fn removing_a_forbidden_technology_is_obedience_not_a_violation() {
        let changes = vec![change(
            "src/main.rs",
            "modified",
            "--- a/src/main.rs\n+++ b/src/main.rs\n-import jquery from 'jquery';\n-jquery.ajax();\n+import { get } from './http';",
        )];
        let report = review(&changes, &rules("jQuery", ""));

        assert!(
            report.violations.is_empty(),
            "deleting the forbidden thing is the rule working: {:?}",
            report.violations
        );
    }

    /// Context lines are the code as it already was — not what this change
    /// introduces, and not this change's fault.
    #[test]
    fn untouched_context_lines_are_not_the_changes_fault() {
        let changes = vec![change(
            "src/main.rs",
            "modified",
            "--- a/src/main.rs\n+++ b/src/main.rs\n jquery.ajax();\n+const x = 1;",
        )];
        assert!(review(&changes, &rules("jQuery", "")).violations.is_empty());
    }

    #[test]
    fn a_new_file_is_checked_in_full() {
        let changes = vec![change("src/new.js", "added", "import jquery from 'jquery';")];
        assert_eq!(review(&changes, &rules("jQuery", "")).violations.len(), 1);
    }

    /// A notice, not a violation — plenty of legitimate changes have no test,
    /// and blocking those teaches people to ignore the report.
    #[test]
    fn source_without_a_test_is_a_notice_and_a_test_in_the_set_clears_it() {
        let source_only = vec![change("src/main.rs", "modified", "+let x = 1;")];
        let report = review(&source_only, &rules("", ""));
        assert!(report.violations.is_empty());
        assert_eq!(report.notices.len(), 1);
        assert_eq!(report.notices[0].kind, "noTests");

        // the test usually arrives as a separate file
        let with_test = vec![
            change("src/main.rs", "modified", "+let x = 1;"),
            change("tests/main_test.rs", "added", "assert!(true);"),
        ];
        assert!(review(&with_test, &rules("", "")).notices.is_empty());
    }

    #[test]
    fn a_change_with_no_source_in_it_is_not_asked_for_tests() {
        let changes = vec![
            change("README.md", "modified", "+docs"),
            change("package-lock.json", "modified", "+{}"),
        ];
        assert!(review(&changes, &rules("", "")).notices.is_empty());
    }

    /// "src/latest/x.rs" is not a test because a folder happens to contain
    /// "test" inside a longer word.
    #[test]
    fn test_detection_reads_whole_path_segments() {
        assert!(is_test("tests/main.rs"));
        assert!(is_test("src/__tests__/app.tsx"));
        assert!(is_test("src/app.test.tsx"));
        assert!(is_test("src/app_test.go"));
        assert!(!is_test("src/latest/x.rs"), "'latest' contains 'test'");
        assert!(!is_test("src/contested/y.rs"));
    }

    #[test]
    fn totals_are_summed_across_the_change() {
        let changes = vec![
            FileChange { path: "a.rs".into(), status: "modified".into(), added_lines: 3, removed_lines: 1, diff: String::new() },
            FileChange { path: "b.rs".into(), status: "added".into(), added_lines: 10, removed_lines: 0, diff: String::new() },
        ];
        let report = review(&changes, &rules("", ""));
        assert_eq!((report.files_changed, report.added_lines, report.removed_lines), (2, 13, 1));
    }
}
