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
    /// The deliverable this one cannot start without. Kept acyclic by
    /// `set_dependency` — a dependency loop is not a plan.
    pub depends_on_deliverable_id: Option<i64>,
    pub created_at: i64,
}

const SELECT: &str = "SELECT id, productId, name, description, dependsOnDeliverableId, createdAt FROM deliverables";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS deliverables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            productId INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            dependsOnDeliverableId INTEGER,
            createdAt INTEGER NOT NULL,
            UNIQUE(productId, name)
        )",
        (),
    )
    .await?;

    // Adds `dependsOnDeliverableId` to an existing table **without dropping
    // it**. Every other migration here drops and recreates, which is fine for
    // rows the app regenerates — but deliverables are written by a person and
    // cannot be recovered, so this one preserves them.
    let columns = crate::db::table_columns(conn, "deliverables").await?;
    if !columns.iter().any(|c| c == "dependsOnDeliverableId") {
        conn.execute(
            "ALTER TABLE deliverables ADD COLUMN dependsOnDeliverableId INTEGER",
            (),
        )
        .await?;
    }
    Ok(())
}

/// Sets (or clears, with `None`) what this deliverable waits on.
///
/// Refuses anything that would make the plan circular — itself, or a
/// deliverable that already depends on it however far back the chain runs.
pub async fn set_dependency(
    conn: &Connection,
    id: i64,
    depends_on: Option<i64>,
) -> Result<()> {
    let Some(deliverable) = find_by_id(conn, id).await? else {
        return Err(DbError::Validation(format!("no Deliverable with id {id}")));
    };
    if let Some(target) = depends_on {
        if target == id {
            return Err(DbError::Validation(
                "a deliverable cannot depend on itself".into(),
            ));
        }
        let Some(other) = find_by_id(conn, target).await? else {
            return Err(DbError::Validation(format!(
                "no Deliverable with id {target}"
            )));
        };
        if other.product_id != deliverable.product_id {
            return Err(DbError::Validation(
                "a deliverable can only depend on one from the same Product".into(),
            ));
        }
        if depends_on_transitively(conn, target, id).await? {
            return Err(DbError::Validation(format!(
                "'{}' already depends on '{}', so this would make a loop",
                other.name, deliverable.name
            )));
        }
    }
    conn.execute(
        "UPDATE deliverables SET dependsOnDeliverableId = ?1 WHERE id = ?2",
        (depends_on, id),
    )
    .await?;
    Ok(())
}

/// Walks the dependency chain from `start` looking for `target`.
///
/// The step counter is a guard, not a feature: `set_dependency` should make
/// cycles unreachable, but a corrupted row must not hang the app.
async fn depends_on_transitively(
    conn: &Connection,
    start: i64,
    target: i64,
) -> Result<bool> {
    let mut current = Some(start);
    let mut steps = 0;
    while let Some(id) = current {
        if id == target {
            return Ok(true);
        }
        if steps > 1_000 {
            return Ok(true); // treat an unwalkable chain as circular
        }
        steps += 1;
        current = find_by_id(conn, id).await?.and_then(|d| d.depends_on_deliverable_id);
    }
    Ok(false)
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
        .query(&format!("{SELECT} WHERE productId = ?1 ORDER BY id"), (product_id,))
        .await?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().await? {
        items.push(row_to_deliverable(row)?);
    }
    Ok(items)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<Deliverable>> {
    let mut rows = conn.query(&format!("{SELECT} WHERE id = ?1"), (id,)).await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_deliverable(row)?)),
        None => Ok(None),
    }
}

/// Deleting a deliverable unlinks its work items and test cases (neither is
/// deleted — the work and the tests outlive the grouping).
pub async fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("UPDATE work_items SET deliverableId = NULL WHERE deliverableId = ?1", (id,)).await?;
    conn.execute("UPDATE test_cases SET deliverableId = NULL WHERE deliverableId = ?1", (id,)).await?;
    // Anything waiting on this one is no longer waiting on anything, rather
    // than left pointing at a row that has gone.
    conn.execute(
        "UPDATE deliverables SET dependsOnDeliverableId = NULL WHERE dependsOnDeliverableId = ?1",
        (id,),
    )
    .await?;
    conn.execute("DELETE FROM deliverables WHERE id = ?1", (id,)).await?;
    Ok(())
}

fn row_to_deliverable(row: turso::Row) -> Result<Deliverable> {
    Ok(Deliverable {
        id: row.get(0)?,
        product_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        depends_on_deliverable_id: row.get(4)?,
        created_at: row.get(5)?,
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
    async fn a_dependency_is_recorded_and_can_be_cleared() {
        let (conn, product_id) = db_with_product().await;
        let first = create(&conn, product_id, "Foundations", "").await.expect("a");
        let second = create(&conn, product_id, "MVP", "").await.expect("b");

        set_dependency(&conn, second, Some(first)).await.expect("set");
        assert_eq!(
            find_by_id(&conn, second).await.expect("q").unwrap().depends_on_deliverable_id,
            Some(first)
        );

        set_dependency(&conn, second, None).await.expect("clear");
        assert_eq!(
            find_by_id(&conn, second).await.expect("q").unwrap().depends_on_deliverable_id,
            None
        );
    }

    /// A dependency loop is not a plan — nothing in it could ever start.
    #[tokio::test]
    async fn a_deliverable_cannot_depend_on_itself_or_close_a_loop() {
        let (conn, product_id) = db_with_product().await;
        let a = create(&conn, product_id, "A", "").await.expect("a");
        let b = create(&conn, product_id, "B", "").await.expect("b");
        let c = create(&conn, product_id, "C", "").await.expect("c");

        assert!(set_dependency(&conn, a, Some(a)).await.is_err(), "self-dependency");

        // A → B → C, then C → A would close the ring.
        set_dependency(&conn, a, Some(b)).await.expect("a on b");
        set_dependency(&conn, b, Some(c)).await.expect("b on c");
        let err = set_dependency(&conn, c, Some(a)).await.expect_err("must refuse");
        assert!(format!("{err:?}").contains("loop"), "got: {err:?}");

        // and the direct two-step case
        assert!(set_dependency(&conn, b, Some(a)).await.is_err());
    }

    #[tokio::test]
    async fn a_dependency_must_exist_and_share_the_product() {
        let (conn, product_id) = db_with_product().await;
        let mine = create(&conn, product_id, "Mine", "").await.expect("a");
        let other_product = crate::db::product::create(&conn, "Other", "{}").await.expect("p");
        let theirs = create(&conn, other_product, "Theirs", "").await.expect("b");

        assert!(set_dependency(&conn, mine, Some(999)).await.is_err());
        assert!(set_dependency(&conn, 999, Some(mine)).await.is_err());
        assert!(
            set_dependency(&conn, mine, Some(theirs)).await.is_err(),
            "depending across Products would make a plan nobody owns"
        );
    }

    /// Deleting what something waits on must not leave it pointing at nothing.
    #[tokio::test]
    async fn deleting_a_dependency_clears_it_from_whatever_waited_on_it() {
        let (conn, product_id) = db_with_product().await;
        let first = create(&conn, product_id, "Foundations", "").await.expect("a");
        let second = create(&conn, product_id, "MVP", "").await.expect("b");
        set_dependency(&conn, second, Some(first)).await.expect("set");

        delete(&conn, first).await.expect("delete");

        let remaining = find_by_id(&conn, second).await.expect("q").expect("still there");
        assert_eq!(remaining.depends_on_deliverable_id, None);
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
