//! The `Product` model — see
//! application/claude-only/CoperativeAIdb/Product-model.md.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct Product {
    pub id: i64,
    pub name: String,
    pub answers: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            answers TEXT NOT NULL DEFAULT '{}',
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

pub async fn create(conn: &Connection, name: &str, answers_json: &str) -> Result<i64> {
    if name.trim().is_empty() {
        return Err(DbError::Validation("a Product needs a name".into()));
    }
    serde_json::from_str::<serde_json::Value>(answers_json)
        .map_err(|e| DbError::Validation(format!("answers are not valid JSON: {e}")))?;
    let now = now_millis();
    conn.execute(
        "INSERT INTO products (name, answers, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4)",
        (name, answers_json, now, now),
    )
    .await?;
    last_insert_id(conn).await
}

/// Replaces a Product's answers.
///
/// The creation card asks only what is needed to start; the rest of the brief —
/// commercial model, roadmap, constraints, risks — is written in Strategy
/// afterwards, which is where thinking about a Product belongs. Both write to
/// this one JSON document, so the scaffolded `Project_brief.md` keeps rendering
/// from a single source.
pub async fn update_answers(conn: &Connection, id: i64, answers_json: &str) -> Result<()> {
    serde_json::from_str::<serde_json::Value>(answers_json)
        .map_err(|e| DbError::Validation(format!("answers are not valid JSON: {e}")))?;
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no Product with id {id}")));
    }
    conn.execute(
        "UPDATE products SET answers = ?1, updatedAt = ?2 WHERE id = ?3",
        (answers_json, now_millis(), id),
    )
    .await?;
    Ok(())
}

pub async fn list_all(conn: &Connection) -> Result<Vec<Product>> {
    let mut rows = conn
        .query(
            "SELECT id, name, answers, createdAt, updatedAt FROM products ORDER BY id",
            (),
        )
        .await?;
    let mut products = Vec::new();
    while let Some(row) = rows.next().await? {
        products.push(row_to_product(row)?);
    }
    Ok(products)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<Product>> {
    let mut rows = conn
        .query(
            "SELECT id, name, answers, createdAt, updatedAt FROM products WHERE id = ?1",
            (id,),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_product(row)?)),
        None => Ok(None),
    }
}

/// Deletes a Product and everything that belongs to it: its work items
/// (each cascading to policy + feature design), sprints, and solutions.
pub async fn delete(conn: &Connection, id: i64) -> Result<()> {
    let items = crate::db::work_item::list_by_product(conn, id).await?;
    for item in items {
        crate::db::work_item::delete(conn, item.id).await?;
    }
    conn.execute("DELETE FROM sprints WHERE productId = ?1", (id,))
        .await?;
    conn.execute("DELETE FROM solutions WHERE productId = ?1", (id,))
        .await?;
    conn.execute("DELETE FROM products WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

fn row_to_product(row: turso::Row) -> Result<Product> {
    Ok(Product {
        id: row.get(0)?,
        name: row.get(1)?,
        answers: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::{connect, create_all_tables};

    pub(crate) async fn db_with_product() -> (Connection, i64) {
        let conn = connect(":memory:").await.expect("open in-memory db");
        create_all_tables(&conn).await.expect("create tables");
        let id = create(&conn, "My Product", "{\"purpose\":\"demo\"}")
            .await
            .expect("create product");
        (conn, id)
    }

    #[tokio::test]
    async fn created_product_is_listed() {
        let (conn, id) = db_with_product().await;
        let products = list_all(&conn).await.expect("list");
        assert_eq!(products.len(), 1);
        assert_eq!(products[0].id, id);
        assert_eq!(products[0].name, "My Product");
    }

    /// The creation card asks a little; Strategy fills in the rest later.
    #[tokio::test]
    async fn answers_can_be_completed_after_creation() {
        let (conn, id) = db_with_product().await;
        let full = r#"{"purpose":"demo","commercialModel":"subscription","risks":"none yet"}"#;
        update_answers(&conn, id, full).await.expect("update");

        let stored = find_by_id(&conn, id).await.expect("q").expect("exists");
        assert!(stored.answers.contains("subscription"));
        assert!(stored.answers.contains("none yet"));
    }

    #[tokio::test]
    async fn answers_must_be_json_and_the_product_must_exist() {
        let (conn, id) = db_with_product().await;
        assert!(update_answers(&conn, id, "{not json").await.is_err());
        assert!(update_answers(&conn, 999, "{}").await.is_err());
    }

    #[tokio::test]
    async fn name_is_required_and_unique() {
        let (conn, _id) = db_with_product().await;
        assert!(create(&conn, "  ", "{}").await.is_err());
        assert!(create(&conn, "My Product", "{}").await.is_err());
    }

    #[tokio::test]
    async fn answers_must_be_valid_json() {
        let (conn, _id) = db_with_product().await;
        assert!(create(&conn, "Other", "{not json").await.is_err());
    }

    #[tokio::test]
    async fn delete_removes_the_product_and_its_belongings() {
        let (conn, id) = db_with_product().await;
        let item = crate::db::work_item::create(&conn, "Epic", "epic", id, None, None)
            .await
            .expect("create item");
        crate::db::sprint::create(&conn, id, "Sprint 1", None, None)
            .await
            .expect("create sprint");
        crate::db::solution::create(&conn, "API", id, "api", "{}")
            .await
            .expect("create solution");

        delete(&conn, id).await.expect("delete product");

        assert!(find_by_id(&conn, id).await.expect("find").is_none());
        assert!(crate::db::work_item::find_by_id(&conn, item)
            .await
            .expect("find item")
            .is_none());
        assert!(crate::db::sprint::list_by_product(&conn, id)
            .await
            .expect("sprints")
            .is_empty());
        assert!(crate::db::solution::list_by_product(&conn, id)
            .await
            .expect("solutions")
            .is_empty());
    }
}
