//! The `Deliverable` model — a Product's strategy deliverables. Work items
//! attach to a deliverable so work can be grouped by what it delivers.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct Deliverable {
    pub id: i64,
    pub product_id: i64,
    pub name: String,
    pub description: String,
    pub created_at: i64,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS deliverables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            productId INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            createdAt INTEGER NOT NULL,
            UNIQUE(productId, name)
        )",
        (),
    )
    .await?;
    Ok(())
}

pub async fn create(conn: &Connection, product_id: i64, name: &str, description: &str) -> Result<i64> {
    if name.trim().is_empty() {
        return Err(DbError::Validation("a deliverable needs a name".into()));
    }
    if crate::db::product::find_by_id(conn, product_id).await?.is_none() {
        return Err(DbError::Validation(format!("no Product with id {product_id}")));
    }
    conn.execute(
        "INSERT INTO deliverables (productId, name, description, createdAt) VALUES (?1, ?2, ?3, ?4)",
        (product_id, name, description, now_millis()),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn list_by_product(conn: &Connection, product_id: i64) -> Result<Vec<Deliverable>> {
    let mut rows = conn
        .query(
            "SELECT id, productId, name, description, createdAt FROM deliverables WHERE productId = ?1 ORDER BY id",
            (product_id,),
        )
        .await?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().await? {
        items.push(row_to_deliverable(row)?);
    }
    Ok(items)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<Deliverable>> {
    let mut rows = conn
        .query("SELECT id, productId, name, description, createdAt FROM deliverables WHERE id = ?1", (id,))
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_deliverable(row)?)),
        None => Ok(None),
    }
}

/// Deleting a deliverable unlinks its work items (they are not deleted).
pub async fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("UPDATE work_items SET deliverableId = NULL WHERE deliverableId = ?1", (id,)).await?;
    conn.execute("DELETE FROM deliverables WHERE id = ?1", (id,)).await?;
    Ok(())
}

fn row_to_deliverable(row: turso::Row) -> Result<Deliverable> {
    Ok(Deliverable {
        id: row.get(0)?,
        product_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        created_at: row.get(4)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    #[tokio::test]
    async fn created_deliverable_is_listed_under_its_product() {
        let (conn, product_id) = db_with_product().await;
        create(&conn, product_id, "MVP", "the first release").await.expect("create");
        let list = list_by_product(&conn, product_id).await.expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "MVP");
    }

    #[tokio::test]
    async fn name_required_unique_per_product_and_product_must_exist() {
        let (conn, product_id) = db_with_product().await;
        assert!(create(&conn, product_id, " ", "").await.is_err());
        assert!(create(&conn, 999, "MVP", "").await.is_err());
        create(&conn, product_id, "MVP", "").await.expect("first");
        assert!(create(&conn, product_id, "MVP", "").await.is_err());
    }

    #[tokio::test]
    async fn delete_unlinks_work_items_without_deleting_them() {
        use crate::db::work_item::{self, WorkItemFields};
        let (conn, product_id) = db_with_product().await;
        let d = create(&conn, product_id, "MVP", "").await.expect("deliverable");
        let item = work_item::create(&conn, "Feature", "feature", product_id, None, None).await.expect("item");
        work_item::update_item(&conn, item, WorkItemFields { deliverable_id: Some(d), ..Default::default() }).await.expect("link");
        delete(&conn, d).await.expect("delete");
        assert_eq!(work_item::find_by_id(&conn, item).await.expect("q").unwrap().deliverable_id, None);
    }
}
