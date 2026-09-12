//! Every decision this server makes, as pure functions.
//!
//! **Separated from the listener so the refusals can be proved without one.**
//! The interesting part of an MCP server is not the transport — it is which
//! questions get answered, which get refused, and what a refusal gives away.
//! Those are decisions over data, so they live here and are tested with no
//! socket, no database and no client.
//!
//! **The rule this module exists to hold: refuse without disclosing.** Every
//! refusal is a chance to leak the shape of what is hidden — an item marked as
//! withheld tells you it exists, a wrong-token message that differs from a
//! missing-token message tells you the token was the problem, and a count of
//! things not shown tells you how much there is. So: absent rather than marked,
//! one wording for both token failures, and no counts.

use serde::{Deserialize, Serialize};

/// What this server is offering, as stored.
///
/// **Everything defaults to nothing.** A fresh install runs no server, offers
/// no Product and permits no write — so the failure mode of a setting that was
/// never opened is silence rather than disclosure.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Offering {
    pub enabled: bool,
    pub port: u16,
    /// Whether the one write tool may run at all.
    pub allow_write: bool,
    /// The Products offered. Empty means none, not all.
    #[serde(default)]
    pub product_ids: Vec<i64>,
    /// Where the bearer token lives in the OS credential store. Never the
    /// token itself — this struct is stored in the database.
    #[serde(default)]
    pub token_alias: String,
}

/// The tools this server offers, and whether each one writes.
///
/// **A fixed list, enumerated in one place.** The spec's promise that nothing
/// here reaches a repository is only as good as the guarantee that no seventh
/// tool appears quietly, so the set is a constant and a test asserts its shape.
#[allow(dead_code)] // Reached by the listener in the next round — see Refused.
pub const TOOLS: &[(&str, bool)] = &[
    ("list_products", false),
    ("list_work_items", false),
    ("get_work_item", false),
    ("read_brief", false),
    ("list_solutions", false),
    ("report_progress", true),
];

/// Why a request was refused.
///
/// **`Unauthorised` covers both a missing token and a wrong one**, and carries
/// no detail, because telling somebody which of the two they got is telling
/// them whether the name they guessed was real.
///
/// **Nothing constructs these outside the tests yet, and the compiler is right
/// to say so.** This round builds the setting, the token and every decision;
/// the listener that asks these questions of a real request is the next one.
/// The judgements are written and proved first deliberately — they are the part
/// worth getting right, and a transport built over undecided rules is how the
/// rules end up being whatever the transport found convenient.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refused {
    Unauthorised,
    NotLoopback,
    NotRunning,
    NoSuchTool,
    WritingNotAllowed,
    NotOffered,
}

#[allow(dead_code)] // Reached by the listener in the next round — see Refused.
impl Refused {
    /// What the client is told.
    ///
    /// Deliberately incurious wording for the two that could be probed: a
    /// caller learns that it may not, never what would have worked.
    pub fn says(self) -> &'static str {
        match self {
            Refused::Unauthorised => "not authorised",
            Refused::NotLoopback => "this server answers only on the loopback interface",
            Refused::NotRunning => "this server is not running",
            Refused::NoSuchTool => "no such tool",
            Refused::WritingNotAllowed => {
                "this server is offering reading only — writing is switched off in the app"
            }
            // The same words whether the Product does not exist or was simply
            // not offered. Telling them apart maps what the workspace holds.
            Refused::NotOffered => "not offered",
        }
    }
}

/// Whether a request may proceed at all, before any data is touched.
///
/// Ordered cheapest-first and by how much each answer gives away: whether the
/// server runs at all, then where the caller is, then the token. A caller who
/// is not on loopback never gets as far as having a token judged.
#[allow(dead_code)] // Reached by the listener in the next round — see Refused.
pub fn admit(
    offering: &Offering,
    from_loopback: bool,
    presented: Option<&str>,
    expected: &str,
) -> Result<(), Refused> {
    if !offering.enabled {
        return Err(Refused::NotRunning);
    }
    if !from_loopback {
        return Err(Refused::NotLoopback);
    }
    // Compared in constant time over the whole length rather than with `==`,
    // so the comparison cannot be timed to recover the token a byte at a time.
    match presented {
        Some(token) if constant_time_eq(token, expected) && !expected.is_empty() => Ok(()),
        _ => Err(Refused::Unauthorised),
    }
}

/// Whether two strings match, taking the same time whichever way they differ.
#[allow(dead_code)] // Reached by the listener in the next round — see Refused.
fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    // The lengths are not secret; the contents are. Different lengths cannot
    // match, and returning early on that leaks only what a caller already knows.
    if a.len() != b.len() {
        return false;
    }
    let mut differences = 0u8;
    for (x, y) in a.iter().zip(b) {
        differences |= x ^ y;
    }
    differences == 0
}

/// Whether a named tool exists, and whether it is allowed to run here.
#[allow(dead_code)] // Reached by the listener in the next round — see Refused.
pub fn allow_tool(offering: &Offering, tool: &str) -> Result<(), Refused> {
    let Some((_, writes)) = TOOLS.iter().find(|(name, _)| *name == tool) else {
        return Err(Refused::NoSuchTool);
    };
    if *writes && !offering.allow_write {
        return Err(Refused::WritingNotAllowed);
    }
    Ok(())
}

/// Whether a Product is one this server is offering.
///
/// **A Product not offered does not exist here**, including when its id is
/// named directly — otherwise the scope control is only a filter on listings
/// and anyone who guesses an integer walks round it.
#[allow(dead_code)] // Reached by the listener in the next round — see Refused.
pub fn offers_product(offering: &Offering, product_id: i64) -> Result<(), Refused> {
    if offering.product_ids.contains(&product_id) {
        Ok(())
    } else {
        Err(Refused::NotOffered)
    }
}

/// One work item, as far as this server is concerned.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: i64,
    pub product_id: i64,
    pub title: String,
    pub state: String,
    pub kind: String,
}

/// The items this server may return, given each one's read permission.
///
/// **Absent, never marked.** A list that says "and three you may not see" has
/// disclosed that three exist, which is most of what the refusal was for. The
/// count is not returned either, for the same reason.
#[allow(dead_code)] // Reached by the listener in the next round — see Refused.
pub fn visible<'a>(
    items: &'a [Item],
    offering: &Offering,
    may_read: impl Fn(i64) -> bool,
) -> Vec<&'a Item> {
    items
        .iter()
        .filter(|item| offering.product_ids.contains(&item.product_id))
        .filter(|item| may_read(item.id))
        .collect()
}

/// A token worth using.
///
/// 32 bytes of the operating system's own randomness, hex-encoded.
///
/// **Through `getrandom`, not by reading `/dev/urandom`.** The first draft of
/// this opened that file directly, which is a panic on Windows — the platform
/// this app mostly runs on. The crate was already in the dependency tree, so
/// asking it costs nothing and works on both targets.
///
/// **Never silently weak.** If the OS source cannot be read, this fails rather
/// than falling back to something guessable: a predictable bearer token is
/// worse than no server at all, because it still looks like a control.
pub fn new_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|e| format!("the operating system would not provide randomness for a token: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offering() -> Offering {
        Offering {
            enabled: true,
            port: 8765,
            allow_write: false,
            product_ids: vec![1, 2],
            token_alias: "coperativeai/mcp".into(),
        }
    }

    /// **A fresh install offers nothing.** The failure mode of a setting nobody
    /// has opened must be silence, not disclosure.
    #[test]
    fn nothing_is_offered_by_default() {
        let fresh = Offering::default();
        assert!(!fresh.enabled);
        assert!(!fresh.allow_write);
        assert!(fresh.product_ids.is_empty(), "no Products, and empty means none rather than all");
        assert_eq!(admit(&fresh, true, Some("anything"), "anything"), Err(Refused::NotRunning));
    }

    /// **The one that would leak the most.** A caller must not be able to tell
    /// a missing token from a wrong one, or the refusal becomes an oracle.
    #[test]
    fn a_missing_token_and_a_wrong_one_are_refused_identically() {
        let o = offering();
        let missing = admit(&o, true, None, "right").expect_err("no token");
        let wrong = admit(&o, true, Some("nope"), "right").expect_err("wrong token");
        assert_eq!(missing, wrong);
        assert_eq!(missing.says(), wrong.says());
        // And the wording gives nothing away about which.
        assert_eq!(missing.says(), "not authorised");
    }

    /// Loopback is judged before the token, so an outside caller never gets a
    /// token verdict to learn from.
    #[test]
    fn a_caller_from_outside_is_refused_before_its_token_is_judged() {
        let o = offering();
        assert_eq!(admit(&o, false, Some("right"), "right"), Err(Refused::NotLoopback));
        // Even with no token at all, the answer is about where it came from.
        assert_eq!(admit(&o, false, None, "right"), Err(Refused::NotLoopback));
    }

    #[test]
    fn a_correct_token_on_loopback_is_admitted() {
        assert_eq!(admit(&offering(), true, Some("right"), "right"), Ok(()));
    }

    /// An empty expected token would otherwise admit an empty presented one,
    /// which is what a half-configured server would have.
    #[test]
    fn an_unset_token_admits_nobody() {
        let mut o = offering();
        o.token_alias = String::new();
        assert_eq!(admit(&o, true, Some(""), ""), Err(Refused::Unauthorised));
        assert_eq!(admit(&o, true, None, ""), Err(Refused::Unauthorised));
    }

    /// **The promise that nothing here reaches a repository is only as good as
    /// the guarantee that no seventh tool appears quietly.**
    #[test]
    fn the_tool_list_is_exactly_what_was_specified() {
        let names: Vec<&str> = TOOLS.iter().map(|(n, _)| *n).collect();
        assert_eq!(
            names,
            vec![
                "list_products",
                "list_work_items",
                "get_work_item",
                "read_brief",
                "list_solutions",
                "report_progress",
            ]
        );
        // Exactly one writes, and it is the progress note.
        let writers: Vec<&str> = TOOLS.iter().filter(|(_, w)| *w).map(|(n, _)| *n).collect();
        assert_eq!(writers, vec!["report_progress"]);
        // And nothing here is named for touching code, a file, or git — the
        // shape of a tool that should never be added without an argument.
        for (name, _) in TOOLS {
            for forbidden in ["write_file", "commit", "push", "run", "exec", "branch"] {
                assert!(!name.contains(forbidden), "{name} looks like it reaches code");
            }
        }
    }

    #[test]
    fn writing_is_refused_while_the_switch_is_off() {
        let mut o = offering();
        assert_eq!(allow_tool(&o, "report_progress"), Err(Refused::WritingNotAllowed));
        assert_eq!(allow_tool(&o, "list_products"), Ok(()));
        o.allow_write = true;
        assert_eq!(allow_tool(&o, "report_progress"), Ok(()));
    }

    #[test]
    fn a_tool_that_does_not_exist_is_refused_as_such() {
        assert_eq!(allow_tool(&offering(), "write_file"), Err(Refused::NoSuchTool));
    }

    /// **Naming an id directly must not walk round the scope control**, or the
    /// Product list is a filter on listings rather than a boundary.
    #[test]
    fn a_product_that_was_not_offered_is_refused_even_when_named() {
        let o = offering();
        assert_eq!(offers_product(&o, 1), Ok(()));
        assert_eq!(offers_product(&o, 99), Err(Refused::NotOffered));
        // And the refusal does not distinguish "no such Product" from "not
        // offered", which would otherwise map what the workspace holds.
        assert_eq!(Refused::NotOffered.says(), "not offered");
    }

    /// **Absent, never marked.** A list saying "and three you may not see" has
    /// disclosed that three exist.
    #[test]
    fn items_that_may_not_be_read_are_absent_rather_than_withheld() {
        let items = vec![
            Item { id: 10, product_id: 1, title: "Open".into(), state: "todo".into(), kind: "feature".into() },
            Item { id: 11, product_id: 1, title: "Secret".into(), state: "todo".into(), kind: "feature".into() },
            Item { id: 12, product_id: 9, title: "Elsewhere".into(), state: "todo".into(), kind: "bug".into() },
        ];
        let shown = visible(&items, &offering(), |id| id != 11);

        let ids: Vec<i64> = shown.iter().map(|i| i.id).collect();
        assert_eq!(ids, vec![10], "the unreadable item and the unoffered Product are both gone");
        // Nothing in what is returned hints at what is not.
        let rendered = serde_json::to_string(&shown).expect("json");
        assert!(!rendered.contains("Secret"), "{rendered}");
        assert!(!rendered.contains("Elsewhere"), "{rendered}");
        assert!(!rendered.contains("11"), "not even the id: {rendered}");
    }

    /// A token is worth having only if it is the operating system's randomness
    /// and long enough to be worth guessing at.
    #[test]
    fn a_token_is_random_and_long() {
        let a = new_token().expect("the OS has randomness");
        let b = new_token().expect("the OS has randomness");
        assert_eq!(a.len(), 64, "32 bytes as hex");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b, "two tokens must not match");
    }

    /// The comparison must not leak the token's contents through how long it
    /// takes — so it is length-checked once and then compared whole.
    #[test]
    fn tokens_are_compared_whole() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "ab"));
        assert!(!constant_time_eq("", "a"));
        assert!(constant_time_eq("", ""));
    }
}
