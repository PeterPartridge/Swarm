//! The `RepoLink` model — how a Product's Solutions, and so its repositories,
//! depend on one another.
//!
//! Distinct from [`work_item_link`](super::work_item_link), which joins two
//! pieces of *work*. This joins two *systems*: it outlives any particular
//! sprint and answers "if we change the API, what else moves?"

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

/// `callsApi` — one calls the other's HTTP interface.
/// `sharesSchema` — both read or write the same data shape.
/// `publishesEvent` — one emits events the other consumes.
/// `buildsOn` — one is compiled or deployed against the other. **Ordering**, so
/// it must stay acyclic; the rest describe runtime, where mutual dependence is
/// a real and workable arrangement.
pub const LINK_KINDS: &[&str] = &["callsApi", "sharesSchema", "publishesEvent", "buildsOn"];

#[derive(Debug, Clone, PartialEq)]
pub struct RepoLink {
    pub id: i64,
    pub from_solution_id: i64,
    pub to_solution_id: i64,
    pub kind: String,
    pub notes: String,
    pub created_at: i64,
}

const SELECT: &str =
    "SELECT id, fromSolutionId, toSolutionId, kind, notes, createdAt FROM repo_links";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS repo_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fromSolutionId INTEGER NOT NULL,
            toSolutionId INTEGER NOT NULL,
            kind TEXT NOT NULL DEFAULT 'callsApi',
            notes TEXT NOT NULL DEFAULT '',
            createdAt INTEGER NOT NULL,
            UNIQUE(fromSolutionId, toSolutionId, kind)
        )",
        (),
    )
    .await?;
    Ok(())
}

pub async fn link(
    conn: &Connection,
    from_solution_id: i64,
    to_solution_id: i64,
    kind: &str,
    notes: &str,
) -> Result<i64> {
    if !LINK_KINDS.contains(&kind) {
        return Err(DbError::Validation(format!(
            "kind must be one of {LINK_KINDS:?}, got '{kind}'"
        )));
    }
    if from_solution_id == to_solution_id {
        return Err(DbError::Validation(
            "a Solution cannot depend on itself".into(),
        ));
    }
    let from = crate::db::solution::find_by_id(conn, from_solution_id)
        .await?
        .ok_or_else(|| DbError::Validation(format!("no Solution with id {from_solution_id}")))?;
    let to = crate::db::solution::find_by_id(conn, to_solution_id)
        .await?
        .ok_or_else(|| DbError::Validation(format!("no Solution with id {to_solution_id}")))?;
    // Two Products' systems may genuinely integrate, but this map is drawn per
    // Product and a link reaching outside it would be invisible from both ends.
    if from.product_id != to.product_id {
        return Err(DbError::Validation(
            "these Solutions belong to different Products — this map only covers one Product's systems"
                .into(),
        ));
    }
    // Only `buildsOn` orders anything, so only `buildsOn` can deadlock. Two
    // services calling each other's APIs is a real arrangement that works;
    // refusing it would make the map lie about the system it describes.
    if kind == "buildsOn" && builds_on_transitively(conn, to_solution_id, from_solution_id).await? {
        return Err(DbError::Validation(
            "that would make a build cycle — neither Solution could be built first".into(),
        ));
    }
    conn.execute(
        "DELETE FROM repo_links WHERE fromSolutionId = ?1 AND toSolutionId = ?2 AND kind = ?3",
        (from_solution_id, to_solution_id, kind),
    )
    .await?;
    conn.execute(
        "INSERT INTO repo_links (fromSolutionId, toSolutionId, kind, notes, createdAt)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (from_solution_id, to_solution_id, kind, notes, now_millis()),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn unlink(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM repo_links WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

/// Every link between Solutions of this Product — the cross-repo map.
pub async fn list_for_product(conn: &Connection, product_id: i64) -> Result<Vec<RepoLink>> {
    let mut rows = conn
        .query(
            &format!(
                "{SELECT} WHERE fromSolutionId IN
                 (SELECT id FROM solutions WHERE productId = ?1) ORDER BY id"
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

/// Removes every link touching a Solution — called when it goes.
pub async fn remove_for_solution(conn: &Connection, solution_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM repo_links WHERE fromSolutionId = ?1 OR toSolutionId = ?1",
        (solution_id,),
    )
    .await?;
    Ok(())
}

/// What a change here would reach: everything this Solution depends on, at any
/// depth, by any kind of link.
///
/// This is the question the map exists to answer — "if we change the API, what
/// else moves?" — so it follows every kind, not just the ordering one.
pub async fn reaches(conn: &Connection, from_solution_id: i64) -> Result<Vec<i64>> {
    let mut seen = vec![from_solution_id];
    let mut queue = vec![from_solution_id];
    let mut reached = Vec::new();
    while let Some(current) = queue.pop() {
        let mut next: Vec<i64> = Vec::new();
        {
            let mut rows = conn
                .query(
                    "SELECT toSolutionId FROM repo_links WHERE fromSolutionId = ?1",
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
                reached.push(id);
            }
        }
    }
    reached.sort_unstable();
    Ok(reached)
}

/// Breadth-first walk of the `buildsOn` graph, with a step guard so a corrupted
/// chain errors rather than hanging the app.
async fn builds_on_transitively(conn: &Connection, start: i64, target: i64) -> Result<bool> {
    let mut seen = vec![start];
    let mut queue = vec![start];
    let mut steps = 0;
    while let Some(current) = queue.pop() {
        steps += 1;
        if steps > 1000 {
            return Err(DbError::Validation(
                "this dependency chain is too long to check — it is probably already circular".into(),
            ));
        }
        if current == target {
            return Ok(true);
        }
        let mut next: Vec<i64> = Vec::new();
        {
            let mut rows = conn
                .query(
                    "SELECT toSolutionId FROM repo_links
                     WHERE fromSolutionId = ?1 AND kind = 'buildsOn'",
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

fn row_to_link(row: turso::Row) -> Result<RepoLink> {
    Ok(RepoLink {
        id: row.get(0)?,
        from_solution_id: row.get(1)?,
        to_solution_id: row.get(2)?,
        kind: row.get(3)?,
        notes: row.get(4)?,
        created_at: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;
    use crate::db::solution;

    async fn sol(conn: &Connection, product_id: i64, name: &str) -> i64 {
        solution::create(conn, name, product_id, "api", "{}").await.expect("solution")
    }

    #[tokio::test]
    async fn a_link_is_recorded_with_its_kind_and_notes() {
        let (conn, product_id) = db_with_product().await;
        let web = sol(&conn, product_id, "Web").await;
        let api = sol(&conn, product_id, "API").await;

        link(&conn, web, api, "callsApi", "for the basket").await.expect("link");

        let links = list_for_product(&conn, product_id).await.expect("list");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].kind, "callsApi");
        assert_eq!(links[0].notes, "for the basket");
    }

    /// Only `buildsOn` orders anything. Two services calling each other's APIs
    /// is a real arrangement that works, and refusing it would make the map lie
    /// about the system it describes.
    #[tokio::test]
    async fn a_build_cycle_is_refused_but_services_may_call_each_other() {
        let (conn, product_id) = db_with_product().await;
        let a = sol(&conn, product_id, "A").await;
        let b = sol(&conn, product_id, "B").await;
        let c = sol(&conn, product_id, "C").await;

        link(&conn, a, b, "buildsOn", "").await.expect("a builds on b");
        link(&conn, b, c, "buildsOn", "").await.expect("b builds on c");
        let err = link(&conn, c, a, "buildsOn", "").await.expect_err("must refuse");
        assert!(format!("{err:?}").contains("build cycle"), "got: {err:?}");

        // runtime calls both ways are fine
        link(&conn, a, b, "callsApi", "").await.expect("a calls b");
        link(&conn, b, a, "callsApi", "webhook back").await.expect("and b calls a");
    }

    /// The question the map exists to answer: change this, what moves?
    #[tokio::test]
    async fn reaches_follows_every_kind_of_link_to_any_depth() {
        let (conn, product_id) = db_with_product().await;
        let web = sol(&conn, product_id, "Web").await;
        let api = sol(&conn, product_id, "API").await;
        let db = sol(&conn, product_id, "Db").await;
        let unrelated = sol(&conn, product_id, "Marketing site").await;

        link(&conn, web, api, "callsApi", "").await.expect("l1");
        link(&conn, api, db, "sharesSchema", "").await.expect("l2");

        let mut expected = vec![api, db];
        expected.sort_unstable();
        assert_eq!(reaches(&conn, web).await.expect("reaches"), expected);
        assert!(reaches(&conn, unrelated).await.expect("reaches").is_empty());
        // and it does not run backwards — Db does not depend on Web
        assert!(reaches(&conn, db).await.expect("reaches").is_empty());
    }

    /// A cycle of runtime links is legal, so the walk must terminate on one.
    #[tokio::test]
    async fn reaches_terminates_on_a_legal_runtime_cycle() {
        let (conn, product_id) = db_with_product().await;
        let a = sol(&conn, product_id, "A").await;
        let b = sol(&conn, product_id, "B").await;
        link(&conn, a, b, "callsApi", "").await.expect("l1");
        link(&conn, b, a, "callsApi", "").await.expect("l2");

        assert_eq!(reaches(&conn, a).await.expect("reaches"), vec![b]);
    }

    #[tokio::test]
    async fn links_are_validated() {
        let (conn, product_id) = db_with_product().await;
        let a = sol(&conn, product_id, "A").await;
        assert!(link(&conn, a, a, "callsApi", "").await.is_err(), "self-link");
        assert!(link(&conn, a, 999, "callsApi", "").await.is_err());
        assert!(link(&conn, a, a, "vibes", "").await.is_err());

        let other = crate::db::product::create(&conn, "Other", "{}").await.expect("p2");
        let theirs = sol(&conn, other, "Theirs").await;
        let err = link(&conn, a, theirs, "callsApi", "").await.expect_err("cross-product");
        assert!(format!("{err:?}").contains("different Products"), "got: {err:?}");
    }

    #[tokio::test]
    async fn deleting_a_solution_takes_its_links_with_it() {
        let (conn, product_id) = db_with_product().await;
        let web = sol(&conn, product_id, "Web").await;
        let api = sol(&conn, product_id, "API").await;
        link(&conn, web, api, "callsApi", "").await.expect("link");

        solution::delete(&conn, api).await.expect("delete");

        assert!(
            list_for_product(&conn, product_id).await.expect("list").is_empty(),
            "a link to a deleted Solution is not a dependency, it is a dangling row"
        );
    }
}
