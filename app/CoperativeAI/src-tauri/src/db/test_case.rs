//! The `TestCase` model — a plain-English test scenario QA designs in the Test
//! area. A test case belongs to a Product and may be associated with a
//! Deliverable, a Work Item, both, or neither (a test can exist before the work
//! that satisfies it does).

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

/// designed = written by QA; implemented = a real test exists at `test_path`.
pub const STATES: &[&str] = &["designed", "implemented"];

#[derive(Debug, Clone, PartialEq)]
pub struct TestCase {
    pub id: i64,
    pub product_id: i64,
    pub title: String,
    pub scenario: String,
    pub state: String,
    pub test_path: Option<String>,
    pub deliverable_id: Option<i64>,
    pub work_item_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

const SELECT: &str = "SELECT id, productId, title, scenario, state, testPath, deliverableId, workItemId, createdAt, updatedAt FROM test_cases";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS test_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            productId INTEGER NOT NULL,
            title TEXT NOT NULL,
            scenario TEXT NOT NULL DEFAULT '',
            state TEXT NOT NULL DEFAULT 'designed',
            testPath TEXT,
            deliverableId INTEGER,
            workItemId INTEGER,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Association targets are validated when supplied — a test case never points
/// at a Deliverable or Work Item that does not exist.
async fn check_links(
    conn: &Connection,
    deliverable_id: Option<i64>,
    work_item_id: Option<i64>,
) -> Result<()> {
    if let Some(d) = deliverable_id {
        if crate::db::deliverable::find_by_id(conn, d).await?.is_none() {
            return Err(DbError::Validation(format!("no Deliverable with id {d}")));
        }
    }
    if let Some(w) = work_item_id {
        if crate::db::work_item::find_by_id(conn, w).await?.is_none() {
            return Err(DbError::Validation(format!("no work item with id {w}")));
        }
    }
    Ok(())
}

pub async fn create(
    conn: &Connection,
    product_id: i64,
    title: &str,
    scenario: &str,
    deliverable_id: Option<i64>,
    work_item_id: Option<i64>,
) -> Result<i64> {
    if title.trim().is_empty() {
        return Err(DbError::Validation("a test case needs a title".into()));
    }
    if crate::db::product::find_by_id(conn, product_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no Product with id {product_id}"
        )));
    }
    check_links(conn, deliverable_id, work_item_id).await?;
    let now = now_millis();
    conn.execute(
        "INSERT INTO test_cases (productId, title, scenario, state, testPath, deliverableId, workItemId, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, 'designed', NULL, ?4, ?5, ?6, ?7)",
        (product_id, title, scenario, deliverable_id, work_item_id, now, now),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn list_by_product(conn: &Connection, product_id: i64) -> Result<Vec<TestCase>> {
    let mut rows = conn
        .query(&format!("{SELECT} WHERE productId = ?1 ORDER BY id"), (product_id,))
        .await?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().await? {
        items.push(row_to_test_case(row)?);
    }
    Ok(items)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<TestCase>> {
    let mut rows = conn.query(&format!("{SELECT} WHERE id = ?1"), (id,)).await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_test_case(row)?)),
        None => Ok(None),
    }
}

/// Updates the editable parts of a test case: its text, what it is associated
/// with, and whether it has been implemented (and where).
pub async fn update_case(
    conn: &Connection,
    id: i64,
    title: &str,
    scenario: &str,
    state: &str,
    test_path: Option<&str>,
    deliverable_id: Option<i64>,
    work_item_id: Option<i64>,
) -> Result<()> {
    if title.trim().is_empty() {
        return Err(DbError::Validation("a test case needs a title".into()));
    }
    if !STATES.contains(&state) {
        return Err(DbError::Validation(format!(
            "state must be one of {STATES:?}, got '{state}'"
        )));
    }
    // A read must be finished before the write below — see db::mod notes.
    let exists = find_by_id(conn, id).await?.is_some();
    if !exists {
        return Err(DbError::Validation(format!("no test case with id {id}")));
    }
    check_links(conn, deliverable_id, work_item_id).await?;
    conn.execute(
        "UPDATE test_cases SET title = ?1, scenario = ?2, state = ?3, testPath = ?4,
         deliverableId = ?5, workItemId = ?6, updatedAt = ?7 WHERE id = ?8",
        (
            title,
            scenario,
            state,
            test_path,
            deliverable_id,
            work_item_id,
            now_millis(),
            id,
        ),
    )
    .await?;
    Ok(())
}

pub async fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM test_cases WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

fn row_to_test_case(row: turso::Row) -> Result<TestCase> {
    Ok(TestCase {
        id: row.get(0)?,
        product_id: row.get(1)?,
        title: row.get(2)?,
        scenario: row.get(3)?,
        state: row.get(4)?,
        test_path: row.get(5)?,
        deliverable_id: row.get(6)?,
        work_item_id: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    #[tokio::test]
    async fn created_test_case_is_listed_under_its_product_as_designed() {
        let (conn, product_id) = db_with_product().await;
        create(&conn, product_id, "Login works", "Given a user…", None, None)
            .await
            .expect("create");
        let list = list_by_product(&conn, product_id).await.expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "Login works");
        assert_eq!(list[0].state, "designed");
        assert_eq!(list[0].test_path, None);
    }

    #[tokio::test]
    async fn title_and_product_are_required() {
        let (conn, product_id) = db_with_product().await;
        assert!(create(&conn, product_id, " ", "", None, None).await.is_err());
        assert!(create(&conn, 999, "T", "", None, None).await.is_err());
    }

    #[tokio::test]
    async fn a_test_case_associates_with_a_deliverable_or_a_work_item() {
        let (conn, product_id) = db_with_product().await;
        let deliverable = crate::db::deliverable::create(&conn, product_id, "MVP", "")
            .await
            .expect("deliverable");
        let item = crate::db::work_item::create(&conn, "Login", "feature", product_id, None, None)
            .await
            .expect("work item");

        let by_deliverable = create(&conn, product_id, "Ship MVP", "", Some(deliverable), None)
            .await
            .expect("by deliverable");
        let by_item = create(&conn, product_id, "Login works", "", None, Some(item))
            .await
            .expect("by work item");

        let list = list_by_product(&conn, product_id).await.expect("list");
        let d = list.iter().find(|t| t.id == by_deliverable).expect("found");
        let w = list.iter().find(|t| t.id == by_item).expect("found");
        assert_eq!(d.deliverable_id, Some(deliverable));
        assert_eq!(d.work_item_id, None);
        assert_eq!(w.work_item_id, Some(item));
    }

    #[tokio::test]
    async fn associations_must_point_at_rows_that_exist() {
        let (conn, product_id) = db_with_product().await;
        assert!(create(&conn, product_id, "T", "", Some(999), None).await.is_err());
        assert!(create(&conn, product_id, "T", "", None, Some(999)).await.is_err());
    }

    #[tokio::test]
    async fn marking_a_case_implemented_records_where_the_test_lives() {
        let (conn, product_id) = db_with_product().await;
        let id = create(&conn, product_id, "Login works", "…", None, None)
            .await
            .expect("create");
        update_case(
            &conn,
            id,
            "Login works",
            "…",
            "implemented",
            Some("src/__tests__/login.test.ts"),
            None,
            None,
        )
        .await
        .expect("update");
        let case = find_by_id(&conn, id).await.expect("find").expect("exists");
        assert_eq!(case.state, "implemented");
        assert_eq!(case.test_path.as_deref(), Some("src/__tests__/login.test.ts"));
    }

    #[tokio::test]
    async fn update_rejects_a_bad_state_empty_title_or_unknown_case() {
        let (conn, product_id) = db_with_product().await;
        let id = create(&conn, product_id, "T", "", None, None).await.expect("create");
        assert!(update_case(&conn, id, "T", "", "shipped", None, None, None).await.is_err());
        assert!(update_case(&conn, id, " ", "", "designed", None, None, None).await.is_err());
        assert!(update_case(&conn, 999, "T", "", "designed", None, None, None).await.is_err());
    }

    /// Deleting what a test case points at must not leave a dangling id — the
    /// case survives, unlinked, because the test is still worth running.
    #[tokio::test]
    async fn deleting_an_association_target_unlinks_the_case_without_deleting_it() {
        let (conn, product_id) = db_with_product().await;
        let deliverable = crate::db::deliverable::create(&conn, product_id, "MVP", "")
            .await
            .expect("deliverable");
        let item = crate::db::work_item::create(&conn, "Login", "feature", product_id, None, None)
            .await
            .expect("work item");
        let by_deliverable = create(&conn, product_id, "Ship MVP", "", Some(deliverable), None)
            .await
            .expect("case");
        let by_item = create(&conn, product_id, "Login works", "", None, Some(item))
            .await
            .expect("case");

        crate::db::deliverable::delete(&conn, deliverable).await.expect("delete deliverable");
        crate::db::work_item::delete(&conn, item).await.expect("delete work item");

        let d = find_by_id(&conn, by_deliverable).await.expect("q").expect("still there");
        let w = find_by_id(&conn, by_item).await.expect("q").expect("still there");
        assert_eq!(d.deliverable_id, None);
        assert_eq!(w.work_item_id, None);
    }

    #[tokio::test]
    async fn delete_removes_only_that_case() {
        let (conn, product_id) = db_with_product().await;
        let a = create(&conn, product_id, "A", "", None, None).await.expect("a");
        create(&conn, product_id, "B", "", None, None).await.expect("b");
        delete(&conn, a).await.expect("delete");
        let list = list_by_product(&conn, product_id).await.expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "B");
    }
}
