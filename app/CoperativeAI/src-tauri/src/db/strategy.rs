//! The `Strategy` model — one structured strategy document per (Product, area).
//! `area` is product / develop / test / marketing / design; `content` is JSON of
//! that section's named fields (the shape is app-defined, validated as JSON here).

use crate::db::{now_millis, DbError, Result};
use turso::Connection;

pub const AREAS: &[&str] = &["product", "develop", "test", "marketing", "design"];

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS strategies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            productId INTEGER NOT NULL,
            area TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '{}',
            updatedAt INTEGER NOT NULL,
            UNIQUE(productId, area)
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Returns the strategy content JSON for a (product, area), or "{}" if none.
pub async fn get(conn: &Connection, product_id: i64, area: &str) -> Result<String> {
    if !AREAS.contains(&area) {
        return Err(DbError::Validation(format!("area must be one of {AREAS:?}")));
    }
    let mut rows = conn
        .query(
            "SELECT content FROM strategies WHERE productId = ?1 AND area = ?2",
            (product_id, area),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(row.get(0)?),
        None => Ok("{}".to_string()),
    }
}

/// Creates or replaces the strategy for a (product, area).
pub async fn save(conn: &Connection, product_id: i64, area: &str, content_json: &str) -> Result<()> {
    if !AREAS.contains(&area) {
        return Err(DbError::Validation(format!("area must be one of {AREAS:?}")));
    }
    if crate::db::product::find_by_id(conn, product_id).await?.is_none() {
        return Err(DbError::Validation(format!("no Product with id {product_id}")));
    }
    serde_json::from_str::<serde_json::Value>(content_json)
        .map_err(|e| DbError::Validation(format!("strategy content is not valid JSON: {e}")))?;
    conn.execute(
        "DELETE FROM strategies WHERE productId = ?1 AND area = ?2",
        (product_id, area),
    )
    .await?;
    conn.execute(
        "INSERT INTO strategies (productId, area, content, updatedAt) VALUES (?1, ?2, ?3, ?4)",
        (product_id, area, content_json, now_millis()),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    #[tokio::test]
    async fn unset_strategy_returns_empty_object() {
        let (conn, product_id) = db_with_product().await;
        assert_eq!(get(&conn, product_id, "product").await.expect("get"), "{}");
    }

    #[tokio::test]
    async fn save_then_get_round_trips_per_area() {
        let (conn, product_id) = db_with_product().await;
        save(&conn, product_id, "develop", r#"{"infrastructure":"AWS"}"#).await.expect("save");
        save(&conn, product_id, "test", r#"{"tooling":"Vitest"}"#).await.expect("save");
        assert!(get(&conn, product_id, "develop").await.expect("g").contains("AWS"));
        assert!(get(&conn, product_id, "test").await.expect("g").contains("Vitest"));
        assert_eq!(get(&conn, product_id, "product").await.expect("g"), "{}");
    }

    #[tokio::test]
    async fn rejects_bad_area_and_non_json() {
        let (conn, product_id) = db_with_product().await;
        assert!(get(&conn, product_id, "sales").await.is_err());
        assert!(save(&conn, product_id, "product", "{bad").await.is_err());
    }

    /// Marketing and design are strategy areas like any other — the section
    /// pattern was already right, they were simply missing from it.
    #[tokio::test]
    async fn marketing_and_design_are_areas_of_their_own() {
        let (conn, product_id) = db_with_product().await;
        save(&conn, product_id, "marketing", r#"{"positioning":"for small teams"}"#).await.expect("m");
        save(&conn, product_id, "design", r#"{"branding":"warm, plain"}"#).await.expect("d");
        assert!(get(&conn, product_id, "marketing").await.expect("g").contains("small teams"));
        assert!(get(&conn, product_id, "design").await.expect("g").contains("warm"));
        // and they do not bleed into one another
        assert!(!get(&conn, product_id, "design").await.expect("g").contains("small teams"));
    }

    #[tokio::test]
    async fn save_replaces_the_existing_area_document() {
        let (conn, product_id) = db_with_product().await;
        save(&conn, product_id, "product", r#"{"v":1}"#).await.expect("save1");
        save(&conn, product_id, "product", r#"{"v":2}"#).await.expect("save2");
        assert!(get(&conn, product_id, "product").await.expect("g").contains("\"v\":2"));
    }
}
