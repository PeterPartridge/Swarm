//! The `WorkItemLink` model — dependencies between pieces of work, including
//! work that lands in different repositories.
//!
//! A work item points at a Solution, and a Solution at a repository, so a link
//! between two items whose Solutions differ *is* a cross-repo dependency. That
//! is derived rather than stored: recording "this is cross-repo" separately
//! would be a second fact to keep in step with the first.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

/// `blocks` — the target cannot start until the source is done. Ordering, so
/// it must stay acyclic.
/// `relatesTo` — worth knowing about, implies no order, so loops are harmless.
pub const LINK_KINDS: &[&str] = &["blocks", "relatesTo"];

#[derive(Debug, Clone, PartialEq)]
pub struct WorkItemLink {
    pub id: i64,
    pub from_work_item_id: i64,
    pub to_work_item_id: i64,
    pub kind: String,
    pub created_at: i64,
}

const SELECT: &str =
    "SELECT id, fromWorkItemId, toWorkItemId, kind, createdAt FROM work_item_links";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS work_item_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fromWorkItemId INTEGER NOT NULL,
            toWorkItemId INTEGER NOT NULL,
            kind TEXT NOT NULL DEFAULT 'blocks',
            createdAt INTEGER NOT NULL,
            UNIQUE(fromWorkItemId, toWorkItemId, kind)
        )",
        (),
    )
    .await?;
    Ok(())
}

pub async fn link(
    conn: &Connection,
    from_work_item_id: i64,
    to_work_item_id: i64,
    kind: &str,
) -> Result<i64> {
    if !LINK_KINDS.contains(&kind) {
        return Err(DbError::Validation(format!(
            "kind must be one of {LINK_KINDS:?}, got '{kind}'"
        )));
    }
    if from_work_item_id == to_work_item_id {
        return Err(DbError::Validation(
            "a work item cannot depend on itself".into(),
        ));
    }
    for id in [from_work_item_id, to_work_item_id] {
        if crate::db::work_item::find_by_id(conn, id).await?.is_none() {
            return Err(DbError::Validation(format!("no work item with id {id}")));
        }
    }
    // Only `blocks` orders work, so only `blocks` can deadlock. Two items that
    // merely relate to each other are fine in any arrangement.
    if kind == "blocks" && blocks_transitively(conn, to_work_item_id, from_work_item_id).await? {
        return Err(DbError::Validation(
            "that would make a blocking loop — neither item could start".into(),
        ));
    }
    conn.execute(
        "DELETE FROM work_item_links WHERE fromWorkItemId = ?1 AND toWorkItemId = ?2 AND kind = ?3",
        (from_work_item_id, to_work_item_id, kind),
    )
    .await?;
    conn.execute(
        "INSERT INTO work_item_links (fromWorkItemId, toWorkItemId, kind, createdAt)
         VALUES (?1, ?2, ?3, ?4)",
        (from_work_item_id, to_work_item_id, kind, now_millis()),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn unlink(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM work_item_links WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

/// Every link touching this item, in either direction — what it waits on and
/// what waits on it are both things a planner needs to see.
pub async fn list_for_item(conn: &Connection, work_item_id: i64) -> Result<Vec<WorkItemLink>> {
    let mut rows = conn
        .query(
            &format!("{SELECT} WHERE fromWorkItemId = ?1 OR toWorkItemId = ?1 ORDER BY id"),
            (work_item_id,),
        )
        .await?;
    let mut links = Vec::new();
    while let Some(row) = rows.next().await? {
        links.push(row_to_link(row)?);
    }
    Ok(links)
}

/// Every link whose *source* is in this Product. Scoped to one query so a
/// board of fifty items costs one round trip rather than fifty. A link out to
/// another Product's item still appears here — it is the source's dependency.
pub async fn list_for_product(conn: &Connection, product_id: i64) -> Result<Vec<WorkItemLink>> {
    let mut rows = conn
        .query(
            &format!(
                "{SELECT} WHERE fromWorkItemId IN
                 (SELECT id FROM work_items WHERE productId = ?1) ORDER BY id"
            ),
            (product_id,),
        )
        .await?;
    let mut links = Vec::new();
    while let Some(row) = rows.next().await? {
        links.push(row_to_link(row)?);
    }
    Ok(links)
}

/// Removes every link to or from an item — called when the item goes.
pub async fn remove_for_item(conn: &Connection, work_item_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM work_item_links WHERE fromWorkItemId = ?1 OR toWorkItemId = ?1",
        (work_item_id,),
    )
    .await?;
    Ok(())
}

/// Breadth-first walk of the `blocks` graph. A work item can block several
/// others, so unlike deliverables this is a graph rather than a chain.
async fn blocks_transitively(conn: &Connection, start: i64, target: i64) -> Result<bool> {
    let mut seen = vec![start];
    let mut queue = vec![start];
    while let Some(current) = queue.pop() {
        if current == target {
            return Ok(true);
        }
        let mut next: Vec<i64> = Vec::new();
        {
            let mut rows = conn
                .query(
                    "SELECT toWorkItemId FROM work_item_links
                     WHERE fromWorkItemId = ?1 AND kind = 'blocks'",
                    (current,),
                )
                .await?;
            while let Some(row) = rows.next().await? {
                next.push(row.get(0)?);
            }
        }
        for id in next {
            if !seen.contains(&id) {
                seen.push(id);
                queue.push(id);
            }
        }
    }
    Ok(false)
}

fn row_to_link(row: turso::Row) -> Result<WorkItemLink> {
    Ok(WorkItemLink {
        id: row.get(0)?,
        from_work_item_id: row.get(1)?,
        to_work_item_id: row.get(2)?,
        kind: row.get(3)?,
        created_at: row.get(4)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;
    use crate::db::work_item;

    async fn item(conn: &Connection, product_id: i64, title: &str) -> i64 {
        work_item::create(conn, title, "task", product_id, None, None)
            .await
            .expect("item")
    }

    #[tokio::test]
    async fn a_link_is_recorded_and_visible_from_both_ends() {
        let (conn, product_id) = db_with_product().await;
        let a = item(&conn, product_id, "A").await;
        let b = item(&conn, product_id, "B").await;

        link(&conn, a, b, "blocks").await.expect("link");

        assert_eq!(list_for_item(&conn, a).await.expect("q").len(), 1);
        assert_eq!(
            list_for_item(&conn, b).await.expect("q").len(),
            1,
            "what waits on you matters as much as what you wait on"
        );
    }

    /// Only `blocks` orders work, so only `blocks` can deadlock.
    #[tokio::test]
    async fn a_blocking_loop_is_refused_but_relates_to_may_go_both_ways() {
        let (conn, product_id) = db_with_product().await;
        let a = item(&conn, product_id, "A").await;
        let b = item(&conn, product_id, "B").await;
        let c = item(&conn, product_id, "C").await;

        link(&conn, a, b, "blocks").await.expect("a blocks b");
        link(&conn, b, c, "blocks").await.expect("b blocks c");
        let err = link(&conn, c, a, "blocks").await.expect_err("must refuse");
        assert!(format!("{err:?}").contains("loop"), "got: {err:?}");

        // relatesTo implies no order, so a ring of them is harmless
        link(&conn, a, b, "relatesTo").await.expect("a relates to b");
        link(&conn, b, a, "relatesTo").await.expect("and back again");
    }

    #[tokio::test]
    async fn links_are_validated() {
        let (conn, product_id) = db_with_product().await;
        let a = item(&conn, product_id, "A").await;
        assert!(link(&conn, a, a, "blocks").await.is_err(), "self-link");
        assert!(link(&conn, a, 999, "blocks").await.is_err());
        assert!(link(&conn, 999, a, "blocks").await.is_err());
        assert!(link(&conn, a, a, "vibes").await.is_err());
    }

    #[tokio::test]
    async fn linking_the_same_pair_twice_replaces_rather_than_duplicates() {
        let (conn, product_id) = db_with_product().await;
        let a = item(&conn, product_id, "A").await;
        let b = item(&conn, product_id, "B").await;

        link(&conn, a, b, "blocks").await.expect("first");
        link(&conn, a, b, "blocks").await.expect("again");
        assert_eq!(list_for_item(&conn, a).await.expect("q").len(), 1);
    }

    /// The cross-repo case: two items in different Solutions, and so different
    /// repositories, depending on one another.
    #[tokio::test]
    async fn work_in_different_solutions_can_depend_across_repositories() {
        use crate::db::{solution, work_item::WorkItemFields};
        let (conn, product_id) = db_with_product().await;
        let api = solution::create(&conn, "API", product_id, "api", "{}").await.expect("api");
        let web = solution::create(&conn, "Web", product_id, "website", "{}").await.expect("web");
        let a = item(&conn, product_id, "Add endpoint").await;
        let b = item(&conn, product_id, "Call endpoint").await;

        work_item::update_item(&conn, a, WorkItemFields { solution_id: Some(api), ..Default::default() })
            .await
            .expect("link a to the API");
        work_item::update_item(&conn, b, WorkItemFields { solution_id: Some(web), ..Default::default() })
            .await
            .expect("link b to the web app");
        link(&conn, a, b, "blocks").await.expect("cross-repo dependency");

        // Cross-repo is derived from the two Solutions differing, not stored.
        let first = work_item::find_by_id(&conn, a).await.expect("q").unwrap();
        let second = work_item::find_by_id(&conn, b).await.expect("q").unwrap();
        assert_ne!(first.solution_id, second.solution_id);
        assert_eq!(list_for_item(&conn, a).await.expect("q").len(), 1);
    }

    #[tokio::test]
    async fn deleting_an_item_takes_its_links_with_it() {
        let (conn, product_id) = db_with_product().await;
        let a = item(&conn, product_id, "A").await;
        let b = item(&conn, product_id, "B").await;
        link(&conn, a, b, "blocks").await.expect("link");

        work_item::delete(&conn, a).await.expect("delete");

        assert!(
            list_for_item(&conn, b).await.expect("q").is_empty(),
            "a link to a deleted item is not a dependency, it is a dangling row"
        );
    }
}
