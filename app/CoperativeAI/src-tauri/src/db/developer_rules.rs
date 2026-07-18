//! The `DeveloperRules` model — the constraints developers put on the AI.
//!
//! Structured columns rather than a free-text blob because these are **enforced,
//! not displayed**: `disallowedTech` is stated as a hard constraint in the
//! prompt and re-checked against what comes back, which needs a list the code
//! can read rather than a paragraph it has to interpret.

use crate::db::{now_millis, DbError, Result};
use turso::Connection;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct DeveloperRules {
    pub id: i64,
    pub product_id: i64,
    pub coding_standards: String,
    pub architecture_principles: String,
    pub maintainability: String,
    /// Comma-separated; free text is tolerated because people write lists.
    pub preferred_frameworks: String,
    pub allowed_tech: String,
    /// The one field with teeth — checked against the AI's output.
    pub disallowed_tech: String,
    pub ai_constraints: String,
    pub updated_at: i64,
}

const SELECT: &str = "SELECT id, productId, codingStandards, architecturePrinciples, maintainability, preferredFrameworks, allowedTech, disallowedTech, aiConstraints, updatedAt FROM developer_rules";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS developer_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            productId INTEGER NOT NULL UNIQUE,
            codingStandards TEXT NOT NULL DEFAULT '',
            architecturePrinciples TEXT NOT NULL DEFAULT '',
            maintainability TEXT NOT NULL DEFAULT '',
            preferredFrameworks TEXT NOT NULL DEFAULT '',
            allowedTech TEXT NOT NULL DEFAULT '',
            disallowedTech TEXT NOT NULL DEFAULT '',
            aiConstraints TEXT NOT NULL DEFAULT '',
            updatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn set_rules(
    conn: &Connection,
    product_id: i64,
    coding_standards: &str,
    architecture_principles: &str,
    maintainability: &str,
    preferred_frameworks: &str,
    allowed_tech: &str,
    disallowed_tech: &str,
    ai_constraints: &str,
) -> Result<()> {
    if crate::db::product::find_by_id(conn, product_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no Product with id {product_id}"
        )));
    }
    conn.execute("DELETE FROM developer_rules WHERE productId = ?1", (product_id,))
        .await?;
    conn.execute(
        "INSERT INTO developer_rules (productId, codingStandards, architecturePrinciples,
            maintainability, preferredFrameworks, allowedTech, disallowedTech, aiConstraints, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        (
            product_id,
            coding_standards,
            architecture_principles,
            maintainability,
            preferred_frameworks,
            allowed_tech,
            disallowed_tech,
            ai_constraints,
            now_millis(),
        ),
    )
    .await?;
    Ok(())
}

pub async fn get_for_product(conn: &Connection, product_id: i64) -> Result<Option<DeveloperRules>> {
    let mut rows = conn
        .query(&format!("{SELECT} WHERE productId = ?1"), (product_id,))
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(DeveloperRules {
            id: row.get(0)?,
            product_id: row.get(1)?,
            coding_standards: row.get(2)?,
            architecture_principles: row.get(3)?,
            maintainability: row.get(4)?,
            preferred_frameworks: row.get(5)?,
            allowed_tech: row.get(6)?,
            disallowed_tech: row.get(7)?,
            ai_constraints: row.get(8)?,
            updated_at: row.get(9)?,
        })),
        None => Ok(None),
    }
}

/// Splits a written list ("Java, PHP; Perl") into comparable terms.
pub fn split_terms(list: &str) -> Vec<String> {
    list.split([',', ';', '\n'])
        .map(|t| t.trim().to_lowercase())
        .filter(|t| !t.is_empty())
        .collect()
}

/// Names any disallowed technology that appears in the AI's output.
///
/// This is the check that makes `disallowedTech` a rule rather than a wish: the
/// model is told the constraint, and then the answer is verified against it
/// instead of being trusted. Matching is whole-word so "Go" does not fire on
/// "Google" and "R" does not fire on every other letter.
pub fn violations(disallowed: &str, text: &str) -> Vec<String> {
    let haystack = text.to_lowercase();
    split_terms(disallowed)
        .into_iter()
        .filter(|term| contains_word(&haystack, term))
        .collect()
}

fn contains_word(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    // A match must not sit against a letter or digit. Only the characters
    // *around* the match are tested, so punctuation inside a name (".NET",
    // "C++", "C#") is carried by the needle itself and needs no special case —
    // an earlier attempt to treat '.' as part of a token broke every term
    // followed by a full stop.
    let boundary = |c: char| !c.is_alphanumeric();
    haystack.match_indices(needle).any(|(index, matched)| {
        let before_ok = index == 0
            || haystack[..index].chars().next_back().is_some_and(boundary);
        let after = index + matched.len();
        let after_ok = after >= haystack.len()
            || haystack[after..].chars().next().is_some_and(boundary);
        before_ok && after_ok
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    #[tokio::test]
    async fn rules_round_trip_and_replace_rather_than_duplicate() {
        let (conn, product_id) = db_with_product().await;
        set_rules(&conn, product_id, "DRY", "hexagonal", "small changes", "React", "Rust, TS", "Java", "no new deps")
            .await
            .expect("set");
        set_rules(&conn, product_id, "DRY + SOLID", "hexagonal", "small changes", "React", "Rust, TS", "Java, PHP", "no new deps")
            .await
            .expect("replace");

        let rules = get_for_product(&conn, product_id).await.expect("get").expect("exists");
        assert_eq!(rules.coding_standards, "DRY + SOLID");
        assert_eq!(rules.disallowed_tech, "Java, PHP");
    }

    #[tokio::test]
    async fn a_product_without_rules_has_none_and_an_unknown_product_is_rejected() {
        let (conn, product_id) = db_with_product().await;
        assert_eq!(get_for_product(&conn, product_id).await.expect("get"), None);
        assert!(set_rules(&conn, 999, "", "", "", "", "", "", "").await.is_err());
    }

    #[test]
    fn lists_split_on_commas_semicolons_and_newlines() {
        assert_eq!(split_terms("Java, PHP; Perl\nCOBOL"), vec!["java", "php", "perl", "cobol"]);
        assert!(split_terms("  ,  ; ").is_empty());
    }

    #[test]
    fn a_disallowed_technology_in_the_output_is_caught() {
        let found = violations("Java, PHP", "We will build the API in Java with Spring Boot.");
        assert_eq!(found, vec!["java"]);
    }

    /// Substring matching would make "Go" fire on "Google" and ban half the
    /// language, so the check is whole-word.
    #[test]
    fn matching_is_whole_word_not_substring() {
        assert!(violations("Go", "Deploy to Google Cloud.").is_empty());
        assert_eq!(violations("Go", "Write the worker in Go."), vec!["go"]);
        assert!(violations("Java", "Use JavaScript on the front end.").is_empty());
    }

    /// Real technology names contain dots, pluses and hashes.
    #[test]
    fn names_with_punctuation_still_match() {
        assert_eq!(violations(".NET", "Host it on .NET 8."), vec![".net"]);
        assert_eq!(violations("C++", "The engine is written in C++."), vec!["c++"]);
        assert_eq!(violations("C#", "Use C# for the service."), vec!["c#"]);
    }

    #[test]
    fn nothing_disallowed_means_nothing_to_report() {
        assert!(violations("", "Anything at all, in Java.").is_empty());
        assert!(violations("Java", "A Rust service with a React front end.").is_empty());
    }

    #[test]
    fn several_violations_are_all_named() {
        let found = violations("Java, PHP, Perl", "A PHP front end calling a Java service.");
        assert!(found.contains(&"java".to_string()));
        assert!(found.contains(&"php".to_string()));
        assert!(!found.contains(&"perl".to_string()));
    }
}
