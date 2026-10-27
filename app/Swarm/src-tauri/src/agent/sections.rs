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
//! - **Paragraphs are the unit.** A blank line is the clearest thing an agent
//!   writes: it means "and now something else".
//! - **A paragraph of bullets is a list of points**, one each, with indented
//!   continuations belonging to the bullet above.
//! - **A paragraph of prose is one point** — unless it ends in a colon and a
//!   list follows, which makes it that list's lead-in and not a point at all.
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

    let blocks = split_blocks(text);

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

/// Splits a section into the points it makes, paragraph by paragraph.
///
/// **Found by running one real round rather than by thinking harder.** The
/// first version split the whole section wherever it found bullets and treated
/// everything before the first one as a lead-in. A real agent wrote "I could
/// not build, run, or test the change. Every invocation was refused." and
/// *then* listed the specifics — so the sentence that mattered was thrown away
/// and four fragments were raised in its place.
fn split_blocks(text: &str) -> Vec<String> {
    let paragraphs: Vec<&str> = text
        .split("\n\n")
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    let mut blocks: Vec<String> = Vec::new();
    // Whether what comes next is detail of the point already open, because a
    // lead-in said so.
    let mut detail = false;

    for (i, paragraph) in paragraphs.iter().enumerate() {
        let next = paragraphs.get(i + 1).copied();
        let listed = paragraph.lines().any(|l| bullet_body(l).is_some());

        // A fenced block is never a point. "```" on a list of things for a
        // person to answer is the app showing its own parsing.
        if is_fence(paragraph) {
            append(&mut blocks, paragraph);
            continue;
        }

        if listed {
            match (detail, blocks.last_mut()) {
                // Introduced under something: these are that thing's specifics,
                // not four more things to do.
                (true, Some(open)) => {
                    open.push_str("\n\n");
                    open.push_str(paragraph);
                }
                // A list with nothing above it is a list of points.
                _ => blocks.extend(bullets_of(paragraph)),
            }
            detail = false;
            continue;
        }

        if is_lead_in(paragraph, next) {
            // It introduces what follows, so it belongs to whatever it is
            // introducing — appended to the open point, or dropped when there
            // is none ("I took two shortcuts:" is not a shortcut).
            if !blocks.is_empty() {
                append(&mut blocks, paragraph);
                detail = true;
            }
            continue;
        }

        blocks.push((*paragraph).to_string());
        detail = false;
    }
    blocks
}

/// Adds a paragraph to the point already open, if there is one.
fn append(blocks: &mut [String], paragraph: &str) {
    if let Some(open) = blocks.last_mut() {
        open.push_str("\n\n");
        open.push_str(paragraph);
    }
}

/// Whether a paragraph is a fenced code block.
fn is_fence(paragraph: &str) -> bool {
    paragraph.trim_start().starts_with("```")
}

/// Whether a paragraph introduces what follows rather than saying something of
/// its own: it ends in a colon, and a list or a code block comes next. A
/// paragraph that ends in a full stop is a statement, whatever follows it.
fn is_lead_in(paragraph: &str, next: Option<&str>) -> bool {
    paragraph.trim_end().ends_with(':')
        && next.is_some_and(|n| n.lines().any(|l| bullet_body(l).is_some()) || is_fence(n))
}

/// One paragraph of bullets, as one string per bullet.
fn bullets_of(paragraph: &str) -> Vec<String> {
    let mut blocks: Vec<String> = Vec::new();
    for line in paragraph.lines() {
        match bullet_body(line) {
            Some(body) => blocks.push(body.to_string()),
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

/// A board-legible line for one item.
///
/// The first sentence, cut at a word boundary if it runs long. Cutting mid-word
/// makes a title that reads like a typo.
///
/// **Plain text, because a board is not a markdown renderer.** A real record
/// opened each piece of debt with `**Nothing exercises Program.cs itself.**`
/// and the asterisks went into the work item's title verbatim. The body keeps
/// every mark the agent wrote — that is its account, and tidying it would be
/// editing what it said.
fn title_of(body: &str) -> String {
    let first_line = plain(body.lines().next().unwrap_or_default().trim());
    let first_line = first_line.as_str();
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
/// Markdown emphasis removed, so a title reads as a line rather than as source.
///
/// Only the marks that wrap words — `**`, `__`, and single `*`/`_` — and only
/// where they are not carrying meaning: a backtick keeps its code, because
/// `Program.cs` reads better as code than as prose.
fn plain(line: &str) -> String {
    let mut out = line.replace("**", "").replace("__", "");
    // Single marks, left alone inside words (`snake_case` is not emphasis).
    out = out
        .split(' ')
        .map(|word| {
            let trimmed = word.trim_matches(['*', '_']);
            if trimmed.is_empty() { word } else { trimmed }
        })
        .collect::<Vec<_>>()
        .join(" ");
    out.trim().to_string()
}

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

    /// **What a real agent wrote, and what this made of it.** Driving one round
    /// end to end found this: the agent's "what I could not do" opened with the
    /// paragraph that mattered — *every build was refused, so nothing was
    /// verified* — and then listed the specifics as bullets. Splitting on
    /// bullets threw the paragraph away as a lead-in and raised four sentence
    /// fragments in its place.
    ///
    /// Paragraphs are the unit; a paragraph of bullets is a list of points, and
    /// a paragraph of prose is a point.
    #[test]
    fn a_paragraph_before_a_list_is_kept_when_it_is_not_a_lead_in() {
        let items = points(
            "I could not build, run, or test the change. Every invocation was refused.\n\n\
             - the two projects compile\n\
             - the packages restore\n",
        );
        assert_eq!(items.len(), 3);
        assert!(items[0].body.contains("could not build"));
        assert!(items[1].body.contains("two projects compile"));
    }

    /// A lead-in is the short line that introduces the list — it ends in a
    /// colon and the list follows it. That is not a thing to do, and filing it
    /// would put "I took two shortcuts:" on somebody's board.
    #[test]
    fn a_colon_lead_in_is_still_dropped() {
        let items = points("I took two shortcuts:\n\n- No integration test.\n- Naming is off.\n");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "No integration test.");
    }

    /// **A title is read on a board, not rendered as markdown.** The real
    /// record opened each piece of debt with `**Nothing exercises Program.cs
    /// itself.**`, and the asterisks went into the work item's title verbatim.
    #[test]
    fn a_title_is_plain_text() {
        let items = points("- **Nothing exercises `Program.cs` itself.** The tests cover the rest.");
        assert_eq!(items[0].title, "Nothing exercises `Program.cs` itself.");
        // The body keeps what the agent wrote, marks and all — that is its
        // account, and reformatting it would be editing what it said.
        assert!(items[0].body.starts_with("**Nothing"));
    }

    /// **A fence is not a thing to do.** The real record ended "someone should
    /// run:" and a fenced command, and the fence line became a question of its
    /// own — three backticks, on a list of things for a person to answer.
    #[test]
    fn a_code_block_belongs_to_the_point_above_it() {
        let items = points(
            "The tests are written but unproven.\n\n\
             Run them with:\n\n\
             ```\ndotnet test\n```\n",
        );
        assert_eq!(items.len(), 1);
        assert!(items[0].body.contains("dotnet test"));
        assert!(!items[0].title.contains("```"));
    }

    /// **A list under a statement is that statement's detail.** The record said
    /// "I could not build, run, or test the change", then "Concretely, these
    /// remain unverified:", then four bullets — and the four became four
    /// questions, each a sentence fragment, beside the one that mattered.
    ///
    /// A lead-in with something before it introduces *that* thing's detail. A
    /// lead-in with nothing before it introduces a list of its own points,
    /// which is the "I took two shortcuts:" case.
    #[test]
    fn a_list_introduced_under_a_statement_stays_with_it() {
        let items = points(
            "I could not build or test the change. Every invocation was refused.\n\n\
             Concretely, these remain unverified:\n\n\
             - that the projects compile\n\
             - that the packages restore\n",
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "I could not build or test the change.");
        assert!(items[0].body.contains("that the projects compile"));
        assert!(items[0].body.contains("that the packages restore"));
    }

    /// **A record a real agent really wrote**, kept as it arrived.
    ///
    /// Every other case in this file is my idea of what an agent writes, and
    /// running one round for real broke three of them at once. This is the
    /// guard against that happening quietly again: the actual output of the
    /// actual loop, asserted on. It is not tidied — the paragraphs, the bold
    /// leaders, the sub-lists and the closing caveat are exactly what came back.
    const REAL_RECORD: &str = include_str!("testdata/hello-world-record.md");

    #[test]
    fn a_real_agents_debt_becomes_four_readable_items() {
        let record = crate::agent::record::parse(REAL_RECORD);
        let debt = points(&record.technical_debt);

        assert_eq!(debt.len(), 4, "{:#?}", debt.iter().map(|p| &p.title).collect::<Vec<_>>());
        assert_eq!(debt[0].title, "Build output is committed to the repository.");
        assert_eq!(debt[1].title, "No solution file.");
        assert_eq!(debt[2].title, "No CI.");
        // The marks are gone from the titles and kept in the bodies.
        assert!(debt.iter().all(|p| !p.title.contains('*')));
        assert!(debt[0].body.starts_with("**Build output"));
        // The whole paragraph travels, so the fix and its cost arrive with it.
        assert!(debt[0].body.contains("git rm -r --cached bin obj"));
    }

    #[test]
    fn a_real_agents_blockers_stay_whole() {
        let record = crate::agent::record::parse(REAL_RECORD);
        let blocked = points(&record.could_not_do);

        // Four paragraphs, four points: nothing blocked, the two things it
        // chose not to do, and the one it could not. No fragments, no fences.
        assert!(blocked.iter().all(|p| !p.title.starts_with("```")));
        assert!(blocked.iter().any(|p| p.title.contains("Nothing in the brief was blocked")));
        assert!(blocked
            .iter()
            .any(|p| p.body.contains("did not run the app interactively")));
    }

    /// The record parses into all five sections — the headings the brief asks
    /// for are the headings a real agent used.
    #[test]
    fn a_real_agent_answered_every_heading() {
        let record = crate::agent::record::parse(REAL_RECORD);
        assert!(record.what_i_built.contains("console app"));
        assert!(record.tests.contains("15 tests"));
        assert!(record.feedback.contains("developer rules"));
        assert!(!record.technical_debt.is_empty());
        assert!(!record.could_not_do.is_empty());
        // Nothing landed in "also said": it used the headings it was given.
        assert_eq!(record.other, "");
    }
}
