//! The `Sprint` model — see
//! application/claude-only/CoperativeAIdb/Sprint-model.md. Dates are optional:
//! teams that don't plan with times still get named sprints.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct Sprint {
    pub id: i64,
    pub product_id: i64,
    pub name: String,
    pub start_date: Option<i64>,
    pub end_date: Option<i64>,
    pub created_at: i64,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sprints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            productId INTEGER NOT NULL,
            name TEXT NOT NULL,
            startDate INTEGER,
            endDate INTEGER,
            createdAt INTEGER NOT NULL,
            UNIQUE(productId, name)
        )",
        (),
    )
    .await?;
    Ok(())
}

pub async fn create(
    conn: &Connection,
    product_id: i64,
    name: &str,
    start_date: Option<i64>,
    end_date: Option<i64>,
) -> Result<i64> {
    if name.trim().is_empty() {
        return Err(DbError::Validation("a sprint needs a name".into()));
    }
    if crate::db::product::find_by_id(conn, product_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no Product with id {product_id}"
        )));
    }
    if let (Some(start), Some(end)) = (start_date, end_date) {
        if end < start {
            return Err(DbError::Validation(
                "a sprint's end date can't be before its start date".into(),
            ));
        }
    }
    conn.execute(
        "INSERT INTO sprints (productId, name, startDate, endDate, createdAt)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (product_id, name, start_date, end_date, now_millis()),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn list_by_product(conn: &Connection, product_id: i64) -> Result<Vec<Sprint>> {
    let mut rows = conn
        .query(
            "SELECT id, productId, name, startDate, endDate, createdAt
             FROM sprints WHERE productId = ?1 ORDER BY id",
            (product_id,),
        )
        .await?;
    let mut sprints = Vec::new();
    while let Some(row) = rows.next().await? {
        sprints.push(row_to_sprint(row)?);
    }
    Ok(sprints)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<Sprint>> {
    let mut rows = conn
        .query(
            "SELECT id, productId, name, startDate, endDate, createdAt
             FROM sprints WHERE id = ?1",
            (id,),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_sprint(row)?)),
        None => Ok(None),
    }
}

/// Removes a sprint; its work items become unscheduled — never deleted
/// (Sprint invariant).
pub async fn remove(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE work_items SET sprintId = NULL WHERE sprintId = ?1",
        (id,),
    )
    .await?;
    conn.execute("DELETE FROM sprints WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

fn row_to_sprint(row: turso::Row) -> Result<Sprint> {
    Ok(Sprint {
        id: row.get(0)?,
        product_id: row.get(1)?,
        name: row.get(2)?,
        start_date: row.get(3)?,
        end_date: row.get(4)?,
        created_at: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;
    use crate::db::work_item;

    #[tokio::test]
    async fn sprints_can_have_no_dates_at_all() {
        let (conn, product_id) = db_with_product().await;
        create(&conn, product_id, "Sprint 1", None, None)
            .await
            .expect("dateless sprint");
        let sprints = list_by_product(&conn, product_id).await.expect("list");
        assert_eq!(sprints.len(), 1);
        assert_eq!(sprints[0].start_date, None);
    }

    #[tokio::test]
    async fn end_before_start_is_rejected() {
        let (conn, product_id) = db_with_product().await;
        assert!(create(&conn, product_id, "Bad", Some(200), Some(100))
            .await
            .is_err());
    }

    #[tokio::test]
    async fn sprint_needs_existing_product_and_unique_name() {
        let (conn, product_id) = db_with_product().await;
        assert!(create(&conn, 999, "Sprint 1", None, None).await.is_err());
        create(&conn, product_id, "Sprint 1", None, None).await.expect("first");
        assert!(create(&conn, product_id, "Sprint 1", None, None).await.is_err());
    }

    #[tokio::test]
    async fn removing_a_sprint_unschedules_items_without_deleting_them() {
        let (conn, product_id) = db_with_product().await;
        let sprint = create(&conn, product_id, "Sprint 1", None, None)
            .await
            .expect("create sprint");
        let item = work_item::create(&conn, "Feature", "feature", product_id, None, None)
            .await
            .expect("create item");
        work_item::update_item(&conn, item, None, Some(sprint), None, None)
            .await
            .expect("schedule");

        remove(&conn, sprint).await.expect("remove sprint");

        let reloaded = work_item::find_by_id(&conn, item)
            .await
            .expect("find")
            .expect("item survives");
        assert_eq!(reloaded.sprint_id, None);
    }
}
