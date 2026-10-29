//! Reading a `swarm-extensions.json` — the one standard file that lists Hives
//! and Cells, whoever publishes it. See application/ai-only/Hives/extensions.md.
//!
//! **Pure.** Nothing here touches the network or the database, so every rule
//! the format has is a unit test. Fetching is `fetch`; installing is the
//! command layer's.
//!
//! **The file is data.** Nothing in it is run, and an entry that names code to
//! download (`entry`) is refused until there is a sandbox to run it in.

use serde::Serialize;
use serde_json::Value;

/// This repository's own file, read at build time: the list of what this
/// build of Swarm contains. One file, so "what Swarm contains" and "what this
/// repository offers" cannot drift.
pub const BUILT_IN: &str = include_str!("../../../../../swarm-extensions.json");

/// Larger than any honest list of extensions, small enough that a URL serving
/// something else entirely is refused before it is read.
pub const MAX_BYTES: usize = 256 * 1024;

pub const KINDS: &[&str] = &["hive", "cell"];

/// One entry as Admin shows it, with the reason it cannot be installed if
/// there is one. `problem: None` is the only installable state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub kind: String,
    pub id: String,
    pub name: String,
    pub version: String,
    pub publisher: String,
    pub description: String,
    pub problem: Option<String>,
}

/// What a whole file says, entry by entry.
///
/// **A whole-file problem is an `Err`; an entry's problem is on its `Offer`.**
/// A file that is not JSON, or in a format this Swarm does not know, cannot be
/// half-read; one bad entry in an otherwise good file should not hide the rest.
///
/// `contained` is what this build has the code for, as `(kind, id)`.
pub fn read(text: &str, swarm_version: &str, contained: &[(String, String)]) -> Result<Vec<Offer>, String> {
    if text.len() > MAX_BYTES {
        return Err(format!("The file is larger than {} KB.", MAX_BYTES / 1024));
    }
    let file: Value =
        serde_json::from_str(text).map_err(|e| format!("The file is not readable JSON: {e}"))?;
    match file.get("format").and_then(Value::as_u64) {
        Some(1) => {}
        Some(other) => return Err(format!("The file is format {other}; this Swarm reads format 1.")),
        None => return Err("The file has no \"format\", so it is not a swarm-extensions.json.".into()),
    }
    let Some(entries) = file.get("extensions").and_then(Value::as_array) else {
        return Err("The file has no \"extensions\" list.".into());
    };
    let swarm = parse_version(swarm_version)
        .ok_or_else(|| format!("This Swarm's own version '{swarm_version}' is not major.minor.patch."))?;

    let mut seen: Vec<(String, String)> = Vec::new();
    Ok(entries
        .iter()
        .map(|entry| {
            let mut offer = offer_for(entry, swarm, contained);
            let key = (offer.kind.clone(), offer.id.clone());
            if offer.problem.is_none() {
                if seen.contains(&key) {
                    offer.problem = Some("Listed twice in this file.".into());
                }
                seen.push(key);
            }
            offer
        })
        .collect())
}

/// What this build of Swarm has the code for, from its own file.
pub fn built_in() -> Vec<(String, String)> {
    let file: Value = serde_json::from_str(BUILT_IN).expect("swarm-extensions.json is JSON");
    file["extensions"]
        .as_array()
        .expect("swarm-extensions.json lists extensions")
        .iter()
        .map(|e| (text(e, "kind"), text(e, "id")))
        .collect()
}

fn offer_for(entry: &Value, swarm: (u32, u32, u32), contained: &[(String, String)]) -> Offer {
    let mut offer = Offer {
        kind: text(entry, "kind"),
        id: text(entry, "id"),
        name: text(entry, "name"),
        version: text(entry, "version"),
        publisher: text(entry, "publisher"),
        description: text(entry, "description"),
        problem: None,
    };
    offer.problem = problem(entry, &offer, swarm, contained);
    if offer.name.is_empty() {
        offer.name = if offer.id.is_empty() { "(unnamed)".into() } else { offer.id.clone() };
    }
    offer
}

/// The first reason this entry cannot be installed, checked in the order a
/// person would want to hear them: unreadable first, then not for this Swarm.
fn problem(entry: &Value, offer: &Offer, swarm: (u32, u32, u32), contained: &[(String, String)]) -> Option<String> {
    for field in ["kind", "id", "name", "version", "publisher", "minSwarm"] {
        if text(entry, field).is_empty() {
            return Some(format!("Not readable: \"{field}\" is missing."));
        }
    }
    if !KINDS.contains(&offer.kind.as_str()) {
        return Some(format!("Not readable: \"{}\" is not a kind (hive or cell).", offer.kind));
    }
    if !is_id(&offer.id) {
        return Some(format!(
            "Not readable: \"{}\" is not an id (lower-case letters, digits and hyphens).",
            offer.id
        ));
    }
    if parse_version(&offer.version).is_none() {
        return Some(format!("Not readable: version \"{}\" is not major.minor.patch.", offer.version));
    }
    let Some(min) = parse_version(&text(entry, "minSwarm")) else {
        return Some("Not readable: \"minSwarm\" is not major.minor.patch.".into());
    };
    // Before "contained": an entry carrying code is refused for that reason
    // even when its id happens to match one this Swarm has.
    if entry.get("entry").is_some() {
        return Some("This Swarm can only install extensions it already contains.".into());
    }
    if min > swarm {
        return Some(format!(
            "Needs Swarm {} or later; this is {}.{}.{}.",
            text(entry, "minSwarm"),
            swarm.0,
            swarm.1,
            swarm.2
        ));
    }
    if !contained.iter().any(|(k, i)| *k == offer.kind && *i == offer.id) {
        return Some("This Swarm does not contain it, and can only install extensions it already contains.".into());
    }
    None
}

/// A field as a trimmed string, empty when missing or not a string.
fn text(entry: &Value, field: &str) -> String {
    entry.get(field).and_then(Value::as_str).unwrap_or("").trim().to_string()
}

/// The id rule `role_hive` already holds Hive ids to.
pub fn is_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn parse_version(v: &str) -> Option<(u32, u32, u32)> {
    let mut parts = v.split('.').map(|p| {
        if p.is_empty() || !p.chars().all(|c| c.is_ascii_digit()) {
            None
        } else {
            p.parse::<u32>().ok()
        }
    });
    let version = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contained() -> Vec<(String, String)> {
        vec![("hive".into(), "product".into()), ("cell".into(), "docker".into())]
    }

    fn entry(extra: &str) -> String {
        format!(
            r#"{{"kind":"hive","id":"product","name":"Product","version":"0.1.0",
               "publisher":"PeterPartridge/Swarm","minSwarm":"0.1.0"{extra}}}"#
        )
    }

    fn file(entries: &[String]) -> String {
        format!(r#"{{"format":1,"extensions":[{}]}}"#, entries.join(","))
    }

    fn only_problem(text: &str) -> Option<String> {
        let offers = read(text, "0.1.0", &contained()).expect("file reads");
        assert_eq!(offers.len(), 1);
        offers[0].problem.clone()
    }

    #[test]
    fn a_valid_entry_is_installable() {
        let offers = read(&file(&[entry(r#","description":"Plan""#)]), "0.1.0", &contained()).unwrap();
        assert_eq!(
            offers,
            [Offer {
                kind: "hive".into(),
                id: "product".into(),
                name: "Product".into(),
                version: "0.1.0".into(),
                publisher: "PeterPartridge/Swarm".into(),
                description: "Plan".into(),
                problem: None,
            }]
        );
    }

    /// A later format could mean anything; reading it as format 1 would be a
    /// guess. Not JSON, and no list, are refused for the whole file too.
    #[test]
    fn the_whole_file_is_refused_when_it_cannot_be_read() {
        for bad in [
            r#"{"format":2,"extensions":[]}"#,
            r#"{"extensions":[]}"#,
            r#"{"format":1}"#,
            "<html>not found</html>",
        ] {
            assert!(read(bad, "0.1.0", &contained()).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn a_file_over_the_limit_is_refused() {
        let big = format!(r#"{{"format":1,"extensions":[],"pad":"{}"}}"#, "x".repeat(MAX_BYTES));
        assert!(read(&big, "0.1.0", &contained()).unwrap_err().contains("larger"));
    }

    #[test]
    fn each_missing_required_field_is_named() {
        for field in ["kind", "id", "name", "version", "publisher", "minSwarm"] {
            let mut value: Value = serde_json::from_str(&entry("")).unwrap();
            value.as_object_mut().unwrap().remove(field);
            let problem = only_problem(&file(&[value.to_string()])).expect("refused");
            assert!(problem.contains(field), "{field}: {problem}");
        }
    }

    #[test]
    fn a_bad_kind_id_or_version_is_refused() {
        let bad_kind = entry("").replace(r#""kind":"hive""#, r#""kind":"theme""#);
        assert!(only_problem(&file(&[bad_kind])).unwrap().contains("kind"));
        for id in ["Product", "two words", "../etc"] {
            let bad_id = entry("").replace(r#""id":"product""#, &format!(r#""id":"{id}""#));
            assert!(only_problem(&file(&[bad_id])).unwrap().contains("not an id"), "{id}");
        }
        for version in ["1", "1.0", "1.0.0.0", "v1.0.0", "1.x.0"] {
            let bad = entry("").replace(r#""version":"0.1.0""#, &format!(r#""version":"{version}""#));
            assert!(only_problem(&file(&[bad])).unwrap().contains("version"), "{version}");
        }
    }

    #[test]
    fn an_entry_needing_a_newer_swarm_says_which() {
        let newer = entry("").replace(r#""minSwarm":"0.1.0""#, r#""minSwarm":"0.10.0""#);
        let problem = only_problem(&file(&[newer])).unwrap();
        assert!(problem.contains("0.10.0") && problem.contains("0.1.0"), "{problem}");
    }

    #[test]
    fn an_entry_this_swarm_does_not_contain_is_refused() {
        let other = entry("").replace(r#""id":"product""#, r#""id":"design-studio""#);
        assert!(only_problem(&file(&[other])).unwrap().contains("does not contain"));
        // the same id under the other kind is not the same extension
        let as_cell = entry("").replace(r#""kind":"hive""#, r#""kind":"cell""#);
        assert!(only_problem(&file(&[as_cell])).unwrap().contains("does not contain"));
    }

    /// Code from a URL is Round 2. Until then an entry carrying it is refused,
    /// even when its id is one this Swarm has.
    #[test]
    fn an_entry_carrying_code_is_refused() {
        let with_code = entry(r#","entry":"https://example.com/hive.js""#);
        assert_eq!(
            only_problem(&file(&[with_code])).unwrap(),
            "This Swarm can only install extensions it already contains."
        );
    }

    #[test]
    fn unknown_fields_are_ignored() {
        assert_eq!(only_problem(&file(&[entry(r#","homepage":"https://example.com""#)])), None);
    }

    #[test]
    fn the_second_of_two_identical_entries_is_refused() {
        let offers = read(&file(&[entry(""), entry("")]), "0.1.0", &contained()).unwrap();
        assert_eq!(offers[0].problem, None);
        assert_eq!(offers[1].problem.as_deref(), Some("Listed twice in this file."));
    }

    /// One bad entry does not hide the good ones beside it.
    #[test]
    fn a_bad_entry_leaves_the_rest_readable() {
        let offers = read(&file(&["{}".into(), entry("")]), "0.1.0", &contained()).unwrap();
        assert!(offers[0].problem.is_some());
        assert_eq!(offers[0].name, "(unnamed)");
        assert_eq!(offers[1].problem, None);
    }

    /// The repository's own file is valid, and everything in it is installable
    /// by the Swarm built from it.
    #[test]
    fn this_repositorys_file_is_all_installable() {
        let offers = read(BUILT_IN, env!("CARGO_PKG_VERSION"), &built_in()).expect("reads");
        assert!(!offers.is_empty());
        for offer in offers {
            assert_eq!(offer.problem, None, "{}/{}", offer.kind, offer.id);
        }
    }

    /// The Cells it lists are exactly the places agents can run other than
    /// this machine. A Cell added to Cells without a line here could never be
    /// installed, and a line here without a Cell would install nothing.
    #[test]
    fn its_cells_are_the_sandboxes_other_than_off() {
        let mut listed: Vec<String> =
            built_in().into_iter().filter(|(k, _)| k == "cell").map(|(_, id)| id).collect();
        let mut sandboxes: Vec<String> = crate::tooling::sandbox::SANDBOXES
            .iter()
            .map(|(id, _)| id.to_string())
            .filter(|id| id != "off")
            .collect();
        listed.sort();
        sandboxes.sort();
        assert_eq!(listed, sandboxes);
    }
}
