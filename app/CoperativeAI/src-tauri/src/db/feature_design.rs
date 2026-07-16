//! The `FeatureDesign` model — see
//! application/claude-only/CoperativeAIdb/FeatureDesign-model.md.
//!
//! Canvas JSON shape (app-defined):
//! `{ "blocks": [{ "type": "ui|endpoint|model", "name": "...",
//!    "description": "...", "x": 0, "y": 0 }],
//!    "connections": [{ "fromBlock": "<name>", "toBlock": "<name>" }] }`

use crate::db::{now_millis, DbError, Result};
use serde_json::Value;
use turso::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct FeatureDesign {
    pub id: i64,
    pub work_item_id: i64,
    pub canvas: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS feature_designs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workItemId INTEGER NOT NULL UNIQUE,
            canvas TEXT NOT NULL DEFAULT '{}',
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Saves (creates or replaces) a work item's design — one design per item.
pub async fn save(conn: &Connection, work_item_id: i64, canvas: &str) -> Result<()> {
    if crate::db::work_item::find_by_id(conn, work_item_id)
        .await?
        .is_none()
    {
        return Err(DbError::Validation(format!(
            "no work item with id {work_item_id}"
        )));
    }
    validate_canvas(canvas)?;

    let now = now_millis();
    let existing = get_for_item(conn, work_item_id).await?;
    match existing {
        Some(design) => {
            conn.execute(
                "UPDATE feature_designs SET canvas = ?1, updatedAt = ?2 WHERE id = ?3",
                (canvas, now, design.id),
            )
            .await?;
        }
        None => {
            conn.execute(
                "INSERT INTO feature_designs (workItemId, canvas, createdAt, updatedAt)
                 VALUES (?1, ?2, ?3, ?4)",
                (work_item_id, canvas, now, now),
            )
            .await?;
        }
    }
    Ok(())
}

pub async fn get_for_item(
    conn: &Connection,
    work_item_id: i64,
) -> Result<Option<FeatureDesign>> {
    let mut rows = conn
        .query(
            "SELECT id, workItemId, canvas, createdAt, updatedAt
             FROM feature_designs WHERE workItemId = ?1",
            (work_item_id,),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(FeatureDesign {
            id: row.get(0)?,
            work_item_id: row.get(1)?,
            canvas: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })),
        None => Ok(None),
    }
}

/// Invariants: the canvas always parses as JSON, and connections only
/// reference blocks that exist in the same design.
fn validate_canvas(canvas: &str) -> Result<()> {
    let value: Value = serde_json::from_str(canvas)
        .map_err(|e| DbError::Validation(format!("canvas is not valid JSON: {e}")))?;

    let block_names: Vec<&str> = value["blocks"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|b| b["name"].as_str())
                .collect()
        })
        .unwrap_or_default();

    if let Some(connections) = value["connections"].as_array() {
        for connection in connections {
            for end in ["fromBlock", "toBlock"] {
                let Some(name) = connection[end].as_str() else {
                    return Err(DbError::Validation(format!(
                        "a connection is missing its {end}"
                    )));
                };
                if !block_names.contains(&name) {
                    return Err(DbError::Validation(format!(
                        "connection references a block that doesn't exist: '{name}'"
                    )));
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;
    use crate::db::work_item;

    async fn db_with_item() -> (Connection, i64) {
        let (conn, product_id) = db_with_product().await;
        let item_id = work_item::create(&conn, "Login", "feature", product_id, None, None)
            .await
            .expect("create item");
        (conn, item_id)
    }

    const VALID_CANVAS: &str = r#"{
        "blocks": [
            {"type": "ui", "name": "Login form", "description": "", "x": 10, "y": 20},
            {"type": "endpoint", "name": "POST /login", "description": "", "x": 200, "y": 20}
        ],
        "connections": [{"fromBlock": "Login form", "toBlock": "POST /login"}]
    }"#;

    #[tokio::test]
    async fn saved_design_reloads_exactly_as_left() {
        let (conn, item_id) = db_with_item().await;
        save(&conn, item_id, VALID_CANVAS).await.expect("save");
        let design = get_for_item(&conn, item_id)
            .await
            .expect("get")
            .expect("exists");
        assert_eq!(design.canvas, VALID_CANVAS);
    }

    #[tokio::test]
    async fn invalid_json_is_rejected() {
        let (conn, item_id) = db_with_item().await;
        let result = save(&conn, item_id, "{not json").await;
        assert!(matches!(result, Err(DbError::Validation(_))));
    }

    #[tokio::test]
    async fn connection_to_a_missing_block_is_rejected() {
        let (conn, item_id) = db_with_item().await;
        let bad = r#"{
            "blocks": [{"type": "ui", "name": "Login form", "x": 0, "y": 0}],
            "connections": [{"fromBlock": "Login form", "toBlock": "Ghost"}]
        }"#;
        let result = save(&conn, item_id, bad).await;
        assert!(matches!(result, Err(DbError::Validation(_))));
    }

    #[tokio::test]
    async fn one_design_per_item_saving_twice_replaces() {
        let (conn, item_id) = db_with_item().await;
        save(&conn, item_id, "{}").await.expect("first save");
        save(&conn, item_id, VALID_CANVAS).await.expect("second save");
        let design = get_for_item(&conn, item_id)
            .await
            .expect("get")
            .expect("exists");
        assert_eq!(design.canvas, VALID_CANVAS);
    }

    #[tokio::test]
    async fn design_is_deleted_with_its_work_item() {
        let (conn, item_id) = db_with_item().await;
        save(&conn, item_id, VALID_CANVAS).await.expect("save");
        work_item::delete(&conn, item_id).await.expect("delete item");
        assert!(get_for_item(&conn, item_id).await.expect("get").is_none());
    }

    #[tokio::test]
    async fn design_needs_an_existing_work_item() {
        let (conn, _item_id) = db_with_item().await;
        let result = save(&conn, 999, VALID_CANVAS).await;
        assert!(matches!(result, Err(DbError::Validation(_))));
    }
}
