//! The `DesignAsset` model — what the design work actually produces.
//!
//! A strategy document says what the design should be; an asset is the thing
//! itself: the token set, the flow, the component list. They are stored rather
//! than only emitted so the app can show them, diff them, and know which ones
//! have been pushed to Figma.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

/// `tokens` — colours, type, spacing as a token document.
/// `uiFlow` / `componentDiagram` — Mermaid.
/// `wireframe` — a described layout, not a picture.
/// `brandGuidelines` — prose.
/// `campaign` / `launchPlan` / `messaging` — marketing's artefacts, prose. In
/// this table rather than one of their own because they are the same shape:
/// product-scoped, named, regenerated in place, emitted as files.
pub const ASSET_KINDS: &[&str] = &[
    "tokens",
    "uiFlow",
    "componentDiagram",
    "wireframe",
    "brandGuidelines",
    "campaign",
    "launchPlan",
    "messaging",
];

pub const FORMATS: &[&str] = &["json", "mermaid", "markdown"];

/// Which format each kind must be in. A tokens document that is not JSON, or a
/// flow that is not Mermaid, cannot be used by anything downstream — so the
/// pairing is enforced rather than left to whoever calls `save`.
fn required_format(kind: &str) -> &'static str {
    match kind {
        "tokens" => "json",
        "uiFlow" | "componentDiagram" => "mermaid",
        _ => "markdown",
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DesignAsset {
    pub id: i64,
    pub product_id: i64,
    pub kind: String,
    pub name: String,
    pub content: String,
    pub format: String,
    /// Set once this asset has been pushed into a Figma file.
    pub figma_file_key: Option<String>,
    pub figma_node_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

const SELECT: &str = "SELECT id, productId, kind, name, content, format, figmaFileKey, figmaNodeId, createdAt, updatedAt FROM design_assets";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS design_assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            productId INTEGER NOT NULL,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            format TEXT NOT NULL DEFAULT 'markdown',
            figmaFileKey TEXT,
            figmaNodeId TEXT,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL,
            UNIQUE(productId, kind, name)
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Creates or replaces an asset. Named assets are replaced in place so
/// regenerating "Primary flow" updates it rather than leaving two.
pub async fn save(
    conn: &Connection,
    product_id: i64,
    kind: &str,
    name: &str,
    content: &str,
) -> Result<i64> {
    if !ASSET_KINDS.contains(&kind) {
        return Err(DbError::Validation(format!(
            "kind must be one of {ASSET_KINDS:?}, got '{kind}'"
        )));
    }
    if name.trim().is_empty() {
        return Err(DbError::Validation("a design asset needs a name".into()));
    }
    if crate::db::product::find_by_id(conn, product_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no Product with id {product_id}"
        )));
    }
    let format = required_format(kind);
    // A token set that will not parse is worse than none: everything
    // downstream — the emitted file, the Figma push — assumes it is real JSON.
    if format == "json" {
        serde_json::from_str::<serde_json::Value>(content)
            .map_err(|e| DbError::Validation(format!("{kind} must be valid JSON: {e}")))?;
    }
    if format == "mermaid" {
        // The same check architecture documents use — one answer to "is this a
        // diagram", rather than two that drift apart.
        crate::diagram::check(format, content)
            .map_err(|e| DbError::Validation(format!("{kind}: {e}")))?;
    }

    let now = now_millis();
    // Scoped so the read is finished before the write — an open statement
    // silently loses the write that follows it.
    let existing: Option<i64> = {
        let mut rows = conn
            .query(
                "SELECT id FROM design_assets WHERE productId = ?1 AND kind = ?2 AND name = ?3",
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
                "UPDATE design_assets SET content = ?1, format = ?2, updatedAt = ?3 WHERE id = ?4",
                (content, format, now, id),
            )
            .await?;
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO design_assets (productId, kind, name, content, format, createdAt, updatedAt)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                (product_id, kind, name, content, format, now, now),
            )
            .await?;
            last_insert_id(conn).await
        }
    }
}

/// Records where an asset landed in Figma. Kept separate from `save` because
/// pushing does not change the asset — it records that a copy now exists
/// somewhere else.
pub async fn record_figma_location(
    conn: &Connection,
    id: i64,
    file_key: &str,
    node_id: Option<&str>,
) -> Result<()> {
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no design asset with id {id}")));
    }
    conn.execute(
        "UPDATE design_assets SET figmaFileKey = ?1, figmaNodeId = ?2, updatedAt = ?3 WHERE id = ?4",
        (file_key, node_id, now_millis(), id),
    )
    .await?;
    Ok(())
}

pub async fn list_by_product(conn: &Connection, product_id: i64) -> Result<Vec<DesignAsset>> {
    let mut rows = conn
        .query(
            &format!("{SELECT} WHERE productId = ?1 ORDER BY kind, name"),
            (product_id,),
        )
        .await?;
    let mut assets = Vec::new();
    while let Some(row) = rows.next().await? {
        assets.push(row_to_asset(row)?);
    }
    Ok(assets)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<DesignAsset>> {
    let mut rows = conn.query(&format!("{SELECT} WHERE id = ?1"), (id,)).await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_asset(row)?)),
        None => Ok(None),
    }
}

pub async fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM design_assets WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

fn row_to_asset(row: turso::Row) -> Result<DesignAsset> {
    Ok(DesignAsset {
        id: row.get(0)?,
        product_id: row.get(1)?,
        kind: row.get(2)?,
        name: row.get(3)?,
        content: row.get(4)?,
        format: row.get(5)?,
        figma_file_key: row.get(6)?,
        figma_node_id: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    const FLOW: &str = "flowchart TD\n  A[Sign up] --> B[Verify email]";

    #[tokio::test]
    async fn an_asset_round_trips_with_the_format_its_kind_requires() {
        let (conn, product_id) = db_with_product().await;
        // r##"…"## because a hex colour contains `"#`, which would close r#"…"#
        let id = save(&conn, product_id, "tokens", "Core", r##"{"colour":{"primary":"#1f6feb"}}"##)
            .await
            .expect("save");
        let stored = find_by_id(&conn, id).await.expect("q").expect("exists");
        assert_eq!(stored.format, "json", "the kind decides the format, not the caller");
        assert!(stored.content.contains("1f6feb"));

        let flow = save(&conn, product_id, "uiFlow", "Sign-up", FLOW).await.expect("flow");
        assert_eq!(find_by_id(&conn, flow).await.expect("q").unwrap().format, "mermaid");
    }

    /// Everything downstream assumes a token set is real JSON.
    #[tokio::test]
    async fn a_token_set_that_will_not_parse_is_refused() {
        let (conn, product_id) = db_with_product().await;
        assert!(save(&conn, product_id, "tokens", "Core", "{not json").await.is_err());
    }

    /// The common AI failure: prose where a diagram was asked for.
    #[tokio::test]
    async fn prose_offered_as_a_diagram_is_refused() {
        let (conn, product_id) = db_with_product().await;
        let err = save(&conn, product_id, "uiFlow", "Sign-up", "First the user signs up, then...")
            .await
            .expect_err("must refuse");
        assert!(format!("{err:?}").contains("Mermaid"), "got: {err:?}");

        // a leading comment or blank lines are fine — the diagram still starts
        save(&conn, product_id, "uiFlow", "Sign-up", &format!("\n%% generated\n{FLOW}"))
            .await
            .expect("comments are allowed");
    }

    #[tokio::test]
    async fn regenerating_a_named_asset_replaces_it() {
        let (conn, product_id) = db_with_product().await;
        let first = save(&conn, product_id, "uiFlow", "Sign-up", FLOW).await.expect("a");
        let second = save(&conn, product_id, "uiFlow", "Sign-up", &format!("{FLOW}\n  B --> C[Done]"))
            .await
            .expect("b");
        assert_eq!(first, second, "same name, same asset");
        assert_eq!(list_by_product(&conn, product_id).await.expect("list").len(), 1);
        assert!(find_by_id(&conn, first).await.expect("q").unwrap().content.contains("Done"));
    }

    /// Marketing's artefacts live here too — same shape, same rules, prose
    /// format decided by the kind.
    #[tokio::test]
    async fn marketing_kinds_store_as_markdown() {
        let (conn, product_id) = db_with_product().await;
        for kind in ["campaign", "launchPlan", "messaging"] {
            let id = save(&conn, product_id, kind, "One", "Post where the users are.")
                .await
                .expect(kind);
            assert_eq!(find_by_id(&conn, id).await.expect("q").unwrap().format, "markdown");
        }
        // an invented kind from a model is rejected by name
        assert!(save(&conn, product_id, "viralStunt", "X", "hi").await.is_err());
    }

    #[tokio::test]
    async fn assets_are_validated() {
        let (conn, product_id) = db_with_product().await;
        assert!(save(&conn, product_id, "mood board", "X", "hi").await.is_err());
        assert!(save(&conn, product_id, "brandGuidelines", "  ", "hi").await.is_err());
        assert!(save(&conn, 999, "brandGuidelines", "X", "hi").await.is_err());
    }

    /// Pushing to Figma does not change the asset — it records that a copy of
    /// it now exists somewhere else.
    #[tokio::test]
    async fn a_figma_location_is_recorded_without_touching_the_content() {
        let (conn, product_id) = db_with_product().await;
        let id = save(&conn, product_id, "tokens", "Core", "{}").await.expect("save");
        record_figma_location(&conn, id, "abc123", Some("4:17")).await.expect("record");

        let stored = find_by_id(&conn, id).await.expect("q").unwrap();
        assert_eq!(stored.figma_file_key.as_deref(), Some("abc123"));
        assert_eq!(stored.figma_node_id.as_deref(), Some("4:17"));
        assert_eq!(stored.content, "{}");
        assert!(record_figma_location(&conn, 999, "abc123", None).await.is_err());
    }
}
