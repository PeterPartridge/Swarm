//! The `Solution` model — see
//! application/claude-only/CoperativeAIdb/Solution-model.md. The planning-level
//! Solution a developer links to a Product (distinct from SolutionManagement,
//! which tracks generated solution files on disk).

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

pub const SOLUTION_TYPES: &[&str] = &["website", "api", "database", "application"];

#[derive(Debug, Clone, PartialEq)]
pub struct Solution {
    pub id: i64,
    pub name: String,
    pub product_id: i64,
    pub solution_type: String,
    pub answers: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS solutions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            productId INTEGER NOT NULL,
            solutionType TEXT NOT NULL DEFAULT 'application',
            answers TEXT NOT NULL DEFAULT '{}',
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL,
            UNIQUE(productId, name)
        )",
        (),
    )
    .await?;
    Ok(())
}

pub async fn create(
    conn: &Connection,
    name: &str,
    product_id: i64,
    solution_type: &str,
    answers_json: &str,
) -> Result<i64> {
    if name.trim().is_empty() {
        return Err(DbError::Validation("a Solution needs a name".into()));
    }
    if !SOLUTION_TYPES.contains(&solution_type) {
        return Err(DbError::Validation(format!(
            "solutionType must be one of {SOLUTION_TYPES:?}, got '{solution_type}'"
        )));
    }
    if crate::db::product::find_by_id(conn, product_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no Product with id {product_id}"
        )));
    }
    serde_json::from_str::<serde_json::Value>(answers_json)
        .map_err(|e| DbError::Validation(format!("answers are not valid JSON: {e}")))?;
    let now = now_millis();
    conn.execute(
        "INSERT INTO solutions (name, productId, solutionType, answers, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (name, product_id, solution_type, answers_json, now, now),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn list_all(conn: &Connection) -> Result<Vec<Solution>> {
    query_solutions(conn, "SELECT id, name, productId, solutionType, answers, createdAt, updatedAt FROM solutions ORDER BY productId, id", None).await
}

pub async fn list_by_product(conn: &Connection, product_id: i64) -> Result<Vec<Solution>> {
    query_solutions(
        conn,
        "SELECT id, name, productId, solutionType, answers, createdAt, updatedAt FROM solutions WHERE productId = ?1 ORDER BY id",
        Some(product_id),
    )
    .await
}

pub async fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM solutions WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

async fn query_solutions(
    conn: &Connection,
    sql: &str,
    product_id: Option<i64>,
) -> Result<Vec<Solution>> {
    let mut rows = match product_id {
        Some(pid) => conn.query(sql, (pid,)).await?,
        None => conn.query(sql, ()).await?,
    };
    let mut solutions = Vec::new();
    while let Some(row) = rows.next().await? {
        solutions.push(Solution {
            id: row.get(0)?,
            name: row.get(1)?,
            product_id: row.get(2)?,
            solution_type: row.get(3)?,
            answers: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        });
    }
    Ok(solutions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    #[tokio::test]
    async fn created_solution_is_listed_under_its_product() {
        let (conn, product_id) = db_with_product().await;
        create(&conn, "Website", product_id, "website", "{\"language\":\"TS\"}")
            .await
            .expect("create");
        let solutions = list_by_product(&conn, product_id).await.expect("list");
        assert_eq!(solutions.len(), 1);
        assert_eq!(solutions[0].name, "Website");
        assert_eq!(solutions[0].solution_type, "website");
    }

    #[tokio::test]
    async fn solution_requires_existing_product_valid_type_and_name() {
        let (conn, product_id) = db_with_product().await;
        assert!(create(&conn, " ", product_id, "api", "{}").await.is_err());
        assert!(create(&conn, "X", product_id, "desktop", "{}").await.is_err());
        assert!(create(&conn, "X", 999, "api", "{}").await.is_err());
        assert!(create(&conn, "X", product_id, "api", "{bad").await.is_err());
    }

    #[tokio::test]
    async fn name_is_unique_within_a_product() {
        let (conn, product_id) = db_with_product().await;
        create(&conn, "API", product_id, "api", "{}").await.expect("first");
        assert!(create(&conn, "API", product_id, "api", "{}").await.is_err());
        let other = crate::db::product::create(&conn, "Other Product", "{}")
            .await
            .expect("second product");
        create(&conn, "API", other, "api", "{}")
            .await
            .expect("same name under another product is fine");
    }

    #[tokio::test]
    async fn delete_removes_only_the_solution() {
        let (conn, product_id) = db_with_product().await;
        let id = create(&conn, "API", product_id, "api", "{}").await.expect("create");
        delete(&conn, id).await.expect("delete");
        assert!(list_by_product(&conn, product_id).await.expect("list").is_empty());
        assert!(crate::db::product::find_by_id(&conn, product_id)
            .await
            .expect("product")
            .is_some());
    }
}
