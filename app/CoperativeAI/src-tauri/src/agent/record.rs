//! What the agent said when it finished, read back into the app.
//!
//! **The half of the round the app never had.** A brief went out, an agent did
//! the work, and its account of what it built, what it left behind and what it
//! could not do was spoken into a terminal that closes with it. Nobody outside
//! that terminal ever saw it — so "AI feedback" was an empty panel while the
//! feedback existed, written out in full, on the other side of the glass.
//!
//! The brief now asks for that account in a file with fixed headings
//! (`handover::RECORD_HEADINGS`). This reads it back.
//!
//! **Lenient about everything except the headings.** An agent writes prose, not
//! a form: the sections may arrive in any order, some may be missing, and there
//! may be a preamble or extra headings of its own. All of that is fine and kept
//! or ignored as it deserves. What is not guessed at is which section is which
//! — a heading that does not match is not silently filed under the nearest one,
//! because a technical debt paragraph shown as "what I built" is worse than one
//! not shown at all.

use super::handover::RECORD_HEADINGS;

/// An agent's account of one round.
///
/// Every section is optional: an agent that left no debt should write nothing
/// under that heading, and an empty section is honestly empty rather than
/// absent.
#[derive(Debug, Default, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRecord {
    pub what_i_built: String,
    pub tests: String,
    pub feedback: String,
    pub technical_debt: String,
    pub could_not_do: String,
    /// Anything written before the first known heading, or under a heading of
    /// the agent's own. Kept rather than dropped: an agent that answered in its
    /// own shape still answered, and a panel showing nothing at all would be
    /// the old bug wearing a new hat.
    pub other: String,
}

impl AgentRecord {
    /// Whether anything at all came back.
    pub fn is_empty(&self) -> bool {
        [
            &self.what_i_built,
            &self.tests,
            &self.feedback,
            &self.technical_debt,
            &self.could_not_do,
            &self.other,
        ]
        .iter()
        .all(|s| s.trim().is_empty())
    }
}

/// Reads a record out of the markdown the agent wrote.
///
/// Matching is on the heading text, case-insensitively and ignoring the `##`,
/// because an agent that writes `### Technical Debt` has still answered the
/// question. Anything else keeps its own heading and goes to `other`.
pub fn parse(markdown: &str) -> AgentRecord {
    let mut record = AgentRecord::default();
    // Which field the lines being read belong to. `None` is the preamble.
    let mut field: Option<usize> = None;
    let mut buffers: Vec<String> = vec![String::new(); RECORD_HEADINGS.len()];
    let mut other = String::new();

    for line in markdown.lines() {
        match heading_index(line) {
            Some(Match::Known(i)) => field = Some(i),
            Some(Match::Unknown) => {
                field = None;
                other.push_str(line);
                other.push('\n');
            }
            None => match field {
                Some(i) => {
                    buffers[i].push_str(line);
                    buffers[i].push('\n');
                }
                None => {
                    other.push_str(line);
                    other.push('\n');
                }
            },
        }
    }

    for (i, buffer) in buffers.into_iter().enumerate() {
        let text = buffer.trim().to_string();
        match i {
            0 => record.what_i_built = text,
            1 => record.tests = text,
            2 => record.feedback = text,
            3 => record.technical_debt = text,
            4 => record.could_not_do = text,
            _ => {}
        }
    }
    record.other = other.trim().to_string();
    record
}

enum Match {
    Known(usize),
    Unknown,
}

/// Which of the asked-for sections a line starts, if it starts one at all.
fn heading_index(line: &str) -> Option<Match> {
    let trimmed = line.trim_start();
    if !trimmed.starts_with('#') {
        return None;
    }
    let title = trimmed.trim_start_matches('#').trim().to_lowercase();
    for (i, heading) in RECORD_HEADINGS.iter().enumerate() {
        let known = heading.trim_start_matches('#').trim().to_lowercase();
        if title == known {
            return Some(Match::Known(i));
        }
    }
    Some(Match::Unknown)
}

#[cfg(test)]
mod tests {
    use super::*;

    const WRITTEN: &str = "\
# Add checkout

## What I built
A `NameGreeter` class and the console entry point that calls it.

## Tests
15 passed, 0 failed. `dotnet build` gave 0 warnings.

## Feedback
The brief said the same rule twice, which made it hard to read.

## Technical debt
No integration test for the console entry point — it is covered only through
the greeter. Half a day to add one.

## What I could not do
Nothing was blocked.
";

    #[test]
    fn each_section_is_read_back_under_its_own_heading() {
        let record = parse(WRITTEN);
        assert!(record.what_i_built.contains("NameGreeter"));
        assert!(record.tests.contains("15 passed"));
        assert!(record.feedback.contains("same rule twice"));
        assert!(record.technical_debt.contains("No integration test"));
        assert!(record.technical_debt.contains("Half a day"));
        assert!(record.could_not_do.contains("Nothing was blocked"));
        assert!(!record.is_empty());
    }

    /// **The point of reading it back.** Debt written into a section that the
    /// app dropped would be debt nobody ever sees — which is the bug this
    /// module exists to fix, so it is asserted on its own.
    #[test]
    fn technical_debt_survives_the_trip() {
        let record = parse(WRITTEN);
        assert_eq!(
            record.technical_debt,
            "No integration test for the console entry point — it is covered only through\n\
             the greeter. Half a day to add one."
        );
    }

    /// An agent writes prose. Sections in another order, with headings in its
    /// own casing and depth, have still answered the question.
    #[test]
    fn order_casing_and_depth_do_not_matter() {
        let record = parse("### technical debt\nNone.\n\n## WHAT I BUILT\nThe thing.\n");
        assert_eq!(record.technical_debt, "None.");
        assert_eq!(record.what_i_built, "The thing.");
    }

    /// A section that was never written is empty rather than filled with the
    /// next one's text — filing a paragraph under the wrong heading would make
    /// the panel lie about what the agent said.
    #[test]
    fn a_missing_section_stays_empty() {
        let record = parse("## Tests\nAll green.\n");
        assert_eq!(record.tests, "All green.");
        assert!(record.what_i_built.is_empty());
        assert!(record.technical_debt.is_empty());
    }

    /// An agent that answered in its own shape still answered. Its words are
    /// kept rather than dropped for arriving under the wrong heading.
    #[test]
    fn words_under_the_agents_own_headings_are_kept() {
        let record = parse("Some opening remarks.\n\n## Surprises\nThe SDK is not here.\n");
        assert!(record.other.contains("Some opening remarks"));
        assert!(record.other.contains("The SDK is not here"));
        assert!(!record.is_empty());
    }

    #[test]
    fn nothing_written_is_nothing_reported() {
        assert!(parse("").is_empty());
        assert!(parse("   \n\n").is_empty());
    }
}
