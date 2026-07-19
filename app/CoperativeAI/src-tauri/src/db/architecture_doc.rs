//! The `ArchitectureDoc` model — how a system is put together, as a diagram
//! the app can store, emit and show.
//!
//! Attached to a Product **or** a Solution: a system-interaction map spans
//! several Solutions, while an API contract belongs to exactly one. Rather than
//! two tables, `solutionId` is nullable and a null means "this is about the
//! whole Product".
//!
//! Every document is checked against its declared format before it is stored.
//! A diagram that does not render is worse than no diagram: it looks like
//! documentation, so nobody writes the documentation.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

pub const DOC_KINDS: &[&str] = &[
    "systemInteraction",
    "componentMap",
    "apiContract",
    "eventFlow",
    "infrastructure",
];

#[derive(Debug, Clone, PartialEq)]
pub struct ArchitectureDoc {
    pub id: i64,
    pub product_id: i64,
    /// Null when the document is about the Product as a whole.
    pub solution_id: Option<i64>,
    pub kind: String,
    pub name: String,
    pub content: String,
    pub format: String,
    pub created_at: i64,
    pub updated_at: i64,
}

const SELECT: &str = "SELECT id, productId, solutionId, kind, name, content, format, createdAt, updatedAt FROM architecture_docs";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS architecture_docs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            productId INTEGER NOT NULL,
            solutionId INTEGER,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            format TEXT NOT NULL DEFAULT 'mermaid',
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL,
            UNIQUE(productId, kind, name)
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Creates or replaces a document. Named documents are replaced in place so
/// regenerating "Checkout flow" updates it rather than leaving two.
pub async fn save(
    conn: &Connection,
    product_id: i64,
    solution_id: Option<i64>,
    kind: &str,
    name: &str,
    content: &str,
    format: &str,
) -> Result<i64> {
    if !DOC_KINDS.contains(&kind) {
        return Err(DbError::Validation(format!(
            "kind must be one of {DOC_KINDS:?}, got '{kind}'"
        )));
    }
    if name.trim().is_empty() {
        return Err(DbError::Validation(
            "an architecture document needs a name".into(),
        ));
    }
    if crate::db::product::find_by_id(conn, product_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no Product with id {product_id}"
        )));
    }
    if let Some(solution) = solution_id {
        match crate::db::solution::find_by_id(conn, solution).await? {
            Some(row) if row.product_id != product_id => {
                return Err(DbError::Validation(
                    "an architecture document can only describe a Solution of its own Product"
                        .into(),
                ));
            }
            None => {
                return Err(DbError::Validation(format!("no Solution with id {solution}")));
            }
            _ => {}
        }
    }
    // Validated before storing, not on the way out. A diagram that does not
    // render is worse than no diagram — it looks like documentation, so nobody
    // writes the documentation.
    crate::diagram::check(format, content).map_err(DbError::Validation)?;

    let now = now_millis();
    // Scoped so the read is finished before the write — an open statement
    // silently loses the write that follows it.
    let existing: Option<i64> = {
        let mut rows = conn
            .query(
                "SELECT id FROM architecture_docs WHERE productId = ?1 AND kind = ?2 AND name = ?3",
                (product_id, kind, name),
            )
            .await?;
        match rows.next().await? {
            Some(row) => Some(row.get(0)?),
            None => None,
        }
    };
    match existing {
        Some(id) => {
            conn.execute(
                "UPDATE architecture_docs SET solutionId = ?1, content = ?2, format = ?3, updatedAt = ?4 WHERE id = ?5",
                (solution_id, content, format, now, id),
            )
            .await?;
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO architecture_docs (productId, solutionId, kind, name, content, format, createdAt, updatedAt)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                (product_id, solution_id, kind, name, content, format, now, now),
            )
            .await?;
            last_insert_id(conn).await
        }
    }
}

pub async fn list_by_product(conn: &Connection, product_id: i64) -> Result<Vec<ArchitectureDoc>> {
    let mut rows = conn
        .query(
            &format!("{SELECT} WHERE productId = ?1 ORDER BY kind, name"),
            (product_id,),
        )
        .await?;
    let mut docs = Vec::new();
    while let Some(row) = rows.next().await? {
        docs.push(row_to_doc(row)?);
    }
    Ok(docs)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<ArchitectureDoc>> {
    let mut rows = conn.query(&format!("{SELECT} WHERE id = ?1"), (id,)).await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_doc(row)?)),
        None => Ok(None),
    }
}

pub async fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM architecture_docs WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

/// Unlinks documents from a deleted Solution rather than deleting them. An
/// architecture document usually outlives the Solution it was drawn for —
/// often it is the only record of why the thing was shaped that way.
pub async fn unlink_solution(conn: &Connection, solution_id: i64) -> Result<()> {
    conn.execute(
        "UPDATE architecture_docs SET solutionId = NULL WHERE solutionId = ?1",
        (solution_id,),
    )
    .await?;
    Ok(())
}

fn row_to_doc(row: turso::Row) -> Result<ArchitectureDoc> {
    Ok(ArchitectureDoc {
        id: row.get(0)?,
        product_id: row.get(1)?,
        solution_id: row.get(2)?,
        kind: row.get(3)?,
        name: row.get(4)?,
        content: row.get(5)?,
        format: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    const FLOW: &str = "flowchart TD\n  Web --> Api";

    #[tokio::test]
    async fn a_document_round_trips_and_may_describe_the_whole_product() {
        let (conn, product_id) = db_with_product().await;
        let id = save(&conn, product_id, None, "systemInteraction", "How it fits", FLOW, "mermaid")
            .await
            .expect("save");

        let stored = find_by_id(&conn, id).await.expect("q").expect("exists");
        assert_eq!(stored.solution_id, None, "null means the whole Product");
        assert_eq!(stored.content, FLOW);
    }

    /// A diagram that does not render is worse than none: it looks like
    /// documentation, so nobody writes the documentation.
    #[tokio::test]
    async fn an_unrenderable_diagram_is_refused_before_it_is_stored() {
        let (conn, product_id) = db_with_product().await;
        let err = save(&conn, product_id, None, "componentMap", "Map", "It talks to the API.", "mermaid")
            .await
            .expect_err("must refuse");
        assert!(format!("{err:?}").contains("Mermaid"), "got: {err:?}");
        assert!(list_by_product(&conn, product_id).await.expect("list").is_empty());
    }

    #[tokio::test]
    async fn each_format_is_checked_as_itself() {
        let (conn, product_id) = db_with_product().await;
        save(&conn, product_id, None, "infrastructure", "Infra", "@startuml\nA -> B\n@enduml", "plantuml")
            .await
            .expect("plantuml");
        save(
            &conn, product_id, None, "componentMap", "Graph",
            r#"{"nodes":[{"id":"a"}],"edges":[]}"#, "jsonGraph",
        )
        .await
        .expect("json graph");
        // right notation, wrong declared format
        assert!(save(&conn, product_id, None, "eventFlow", "X", FLOW, "plantuml").await.is_err());
    }

    #[tokio::test]
    async fn a_solution_document_must_belong_to_the_same_product() {
        let (conn, product_id) = db_with_product().await;
        let own = crate::db::solution::create(&conn, "API", product_id, "api", "{}").await.expect("s");
        save(&conn, product_id, Some(own), "apiContract", "Orders", FLOW, "mermaid")
            .await
            .expect("own solution");

        let other = crate::db::product::create(&conn, "Other", "{}").await.expect("p2");
        let foreign = crate::db::solution::create(&conn, "Theirs", other, "api", "{}").await.expect("s2");
        assert!(save(&conn, product_id, Some(foreign), "apiContract", "X", FLOW, "mermaid").await.is_err());
        assert!(save(&conn, product_id, Some(999), "apiContract", "Y", FLOW, "mermaid").await.is_err());
    }

    #[tokio::test]
    async fn regenerating_a_named_document_replaces_it() {
        let (conn, product_id) = db_with_product().await;
        let first = save(&conn, product_id, None, "eventFlow", "Orders", FLOW, "mermaid").await.expect("a");
        let second = save(
            &conn, product_id, None, "eventFlow", "Orders",
            &format!("{FLOW}\n  Api --> Db"), "mermaid",
        )
        .await
        .expect("b");

        assert_eq!(first, second);
        assert_eq!(list_by_product(&conn, product_id).await.expect("list").len(), 1);
        assert!(find_by_id(&conn, first).await.expect("q").unwrap().content.contains("Db"));
    }

    /// The document usually outlives the Solution — often it is the only
    /// record of why the thing was shaped that way.
    #[tokio::test]
    async fn deleting_a_solution_unlinks_its_documents_rather_than_deleting_them() {
        let (conn, product_id) = db_with_product().await;
        let solution = crate::db::solution::create(&conn, "API", product_id, "api", "{}").await.expect("s");
        let id = save(&conn, product_id, Some(solution), "apiContract", "Orders", FLOW, "mermaid")
            .await
            .expect("save");

        crate::db::solution::delete(&conn, solution).await.expect("delete");

        let survivor = find_by_id(&conn, id).await.expect("q").expect("still there");
        assert_eq!(survivor.solution_id, None);
        assert_eq!(survivor.content, FLOW);
    }
}
