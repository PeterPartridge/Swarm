//! Turning a section of an agent's round record into separate points.
//!
//! **A paragraph nobody can act on is not a record of anything.** The round
//! record brought the agent's own account back into the app, and it arrived as
//! prose on a panel: true, readable, and invisible to the board where work is
//! actually decided. Debt that is not on the board is debt that gets paid by
//! surprise, and a blocker nobody was asked to answer stays unanswered.
//!
//! So each thing the agent listed becomes a row of its own — a work item for
//! the debt it left behind, a question to answer for what it could not do. Both
//! start here, because both are the same job: splitting prose, which means
//! guessing. The guesses are made in one place, in the open, rather than twice
//! in two commands:
//!
//! - **Bullets win.** An agent that wrote a list meant a list, and each bullet
//!   is one thing to do. Indented continuations belong to the bullet above.
//! - **Otherwise, paragraphs.** Prose separated by blank lines is the next best
//!   evidence of "these are separate points".
//! - **"None" means none.** An agent that answered the question with "none" has
//!   answered it; filing that as a task to do would be filing the absence of
//!   work as work.
//!
//! What it never does is split a sentence. A wrong split makes two half-items
//! that each read as nonsense, which is worse than one item holding two points.

/// One point the agent made in a section.
#[derive(Debug, Clone, PartialEq)]
pub struct Point {
    /// A line that reads on a board.
    pub title: String,
    /// Everything the agent wrote about it, kept whole.
    pub body: String,
    /// A stable fingerprint of `body`, so filing the same record twice files
    /// nothing the second time.
    pub fingerprint: String,
}

/// How long a title may run before it is cut short.
///
/// Enough for a real sentence, short enough to read in a board column. The
/// whole text is kept in the body regardless, so cutting the title loses
/// nothing.
const TITLE_LIMIT: usize = 90;

/// Splits one section into the points it makes.
pub fn points(section: &str) -> Vec<Point> {
    let text = section.trim();
    if text.is_empty() || is_nothing(text) {
        return Vec::new();
    }

    let blocks = if text.lines().any(|l| bullet_body(l).is_some()) {
        by_bullet(text)
    } else {
        by_paragraph(text)
    };

    blocks
        .into_iter()
        .map(|b| b.trim().to_string())
        .filter(|b| !b.is_empty() && !is_nothing(b))
        .map(|body| Point {
            title: title_of(&body),
            fingerprint: fingerprint(&body),
            body,
        })
        .collect()
}

/// Whether a section is an answer of "there is none" rather than a list.
///
/// Deliberately narrow: only a short single line, and only the handful of ways
/// people write it. A long paragraph that happens to open with "None of the
/// shortcuts here are serious, but…" is a description of debt and is treated as
/// one.
fn is_nothing(text: &str) -> bool {
    let one_line = text.lines().filter(|l| !l.trim().is_empty()).count() == 1;
    if !one_line {
        return false;
    }
    let plain = text
        .trim()
        .trim_start_matches(['-', '*', '+', ' '])
        .trim_end_matches(['.', '!', ' '])
        .to_lowercase();
    matches!(
        plain.as_str(),
        "none"
            | "nothing"
            | "n/a"
            | "na"
            | "no debt"
            | "no technical debt"
            | "none that i know of"
            | "nothing to report"
            | "nothing outstanding"
    )
}

/// The text of a bullet, if the line starts one.
///
/// `-`, `*`, `+` and `1.` all count; an indented bullet does not start a new
/// item, because a nested list is detail about the one above it.
fn bullet_body(line: &str) -> Option<&str> {
    if line.starts_with([' ', '\t']) {
        return None;
    }
    let rest = line.trim();
    for marker in ["- ", "* ", "+ "] {
        if let Some(body) = rest.strip_prefix(marker) {
            return Some(body);
        }
    }
    // "1. " and friends: digits, then a dot or bracket, then a space.
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    if !digits.is_empty() {
        let after = &rest[digits.len()..];
        for marker in [". ", ") "] {
            if let Some(body) = after.strip_prefix(marker) {
                return Some(body);
            }
        }
    }
    None
}

fn by_bullet(text: &str) -> Vec<String> {
    let mut blocks: Vec<String> = Vec::new();
    for line in text.lines() {
        match bullet_body(line) {
            Some(body) => blocks.push(body.to_string()),
            // Anything before the first bullet is a lead-in to the list, not an
            // item — "I took three shortcuts:" is not a shortcut.
            None => {
                if let Some(current) = blocks.last_mut() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        current.push('\n');
                        current.push_str(trimmed);
                    }
                }
            }
        }
    }
    blocks
}

fn by_paragraph(text: &str) -> Vec<String> {
    text.split("\n\n").map(str::to_string).collect()
}

/// A board-legible line for one item.
///
/// The first sentence, cut at a word boundary if it runs long. Cutting mid-word
/// makes a title that reads like a typo.
fn title_of(body: &str) -> String {
    let first_line = body.lines().next().unwrap_or_default().trim();
    let sentence = match first_line.find(". ") {
        Some(at) => &first_line[..at + 1],
        None => first_line,
    };
    let sentence = sentence.trim();
    if sentence.chars().count() <= TITLE_LIMIT {
        return sentence.to_string();
    }
    let cut: String = sentence.chars().take(TITLE_LIMIT).collect();
    let at = cut.rfind(' ').unwrap_or(cut.len());
    format!("{}…", cut[..at].trim_end_matches([',', ';', ':', ' ']))
}

/// A stable fingerprint of one item's text.
///
/// **FNV-1a rather than the standard library's hasher**, whose output is not
/// promised to stay the same between Rust versions. This one is stored in the
/// database and compared against on every read, so a value that quietly changed
/// under an upgrade would re-file every piece of debt ever recorded.
fn fingerprint(body: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    // Whitespace-insensitive: a record reflowed by an editor is the same debt.
    for byte in body.split_whitespace().collect::<Vec<_>>().join(" ").bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_bullet_is_its_own_item() {
        let items = points(
            "- No integration test for the console entry point.\n\
             - The greeter takes a string and returns one; it should take a writer.\n",
        );
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "No integration test for the console entry point.");
        assert!(items[1].body.contains("should take a writer"));
    }

    /// A nested line is detail about the bullet above it, not a fifth thing to
    /// do — splitting on it would file "half a day" as a piece of work.
    #[test]
    fn an_indented_line_belongs_to_the_bullet_above_it() {
        let items = points("- No integration test.\n  - Half a day to add one.\n- Naming is off.\n");
        assert_eq!(items.len(), 2);
        assert!(items[0].body.contains("Half a day"));
    }

    #[test]
    fn numbered_lists_count_as_bullets() {
        let items = points("1. First shortcut.\n2. Second shortcut.\n");
        assert_eq!(items.len(), 2);
        assert_eq!(items[1].title, "Second shortcut.");
    }

    /// Prose with no list still describes separate points, and a blank line is
    /// the only honest evidence of where one ends.
    #[test]
    fn paragraphs_split_when_there_are_no_bullets() {
        let items = points("The parser is quadratic.\n\nThe config is read twice.\n");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "The parser is quadratic.");
    }

    /// A sentence is never split. Two half-items that each read as nonsense are
    /// worse than one item holding two points.
    #[test]
    fn a_wrapped_sentence_stays_one_item() {
        let items = points("The parser is quadratic in the number of\nfields, which will bite.\n");
        assert_eq!(items.len(), 1);
        assert!(items[0].body.contains("fields, which will bite"));
    }

    /// **"None" is an answer, not a job.** An agent that reported no debt has
    /// answered the question, and filing that as a task would put the absence
    /// of work on the board.
    #[test]
    fn an_agent_reporting_no_debt_files_nothing() {
        for said in ["None.", "none", "Nothing to report", "N/A", "- None", "  \n"] {
            assert!(points(said).is_empty(), "{said:?} should file nothing");
        }
    }

    /// Only a bare "none" is nothing. A paragraph that happens to start with
    /// the word is a description of debt.
    #[test]
    fn none_inside_a_real_answer_is_still_debt() {
        let items = points("None of these are urgent, but the config is read twice.");
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn a_long_item_gets_a_title_that_fits_and_a_body_that_does_not_lose_anything() {
        let long = "The retry loop backs off exponentially but has no ceiling, so a provider \
                    that is down for an hour leaves a job sleeping for most of it.";
        let items = points(long);
        assert_eq!(items.len(), 1);
        assert!(items[0].title.chars().count() <= TITLE_LIMIT + 1);
        assert!(items[0].title.ends_with('…'));
        // Cut at a word boundary, and the whole thing kept underneath.
        assert!(!items[0].title.contains("expon…"));
        assert_eq!(items[0].body, long);
    }

    /// The first sentence is the title when there is one, ellipsis or not.
    #[test]
    fn the_title_is_the_first_sentence() {
        let items = points("Config is read twice. Harmless now, expensive later.");
        assert_eq!(items[0].title, "Config is read twice.");
        assert!(items[0].body.contains("expensive later"));
    }

    /// **The fingerprint is why filing twice files nothing.** It has to survive
    /// a reflow — the same debt wrapped differently is the same debt — and it
    /// has to differ when the words do.
    #[test]
    fn the_fingerprint_survives_a_reflow_and_notices_a_rewrite() {
        let one = points("- The parser is quadratic in the\n  number of fields.");
        let same = points("- The parser is quadratic in the number of fields.");
        let other = points("- The parser is quadratic in the number of columns.");
        assert_eq!(one[0].fingerprint, same[0].fingerprint);
        assert_ne!(one[0].fingerprint, other[0].fingerprint);
    }

    /// A lead-in sentence introduces the list; it is not an item in it.
    #[test]
    fn a_line_before_the_first_bullet_is_not_an_item() {
        let items = points("I took two shortcuts:\n\n- No integration test.\n- Naming is off.\n");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "No integration test.");
    }
}
