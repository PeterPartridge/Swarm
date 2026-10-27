//! The `SprintCapacity` model — how much each person has available in a sprint.
//!
//! Deliberately crude: one number per member per sprint, in whatever unit the
//! team already uses (points, hours, days). No calendar, no holidays, no
//! part-time handling. A capacity model that demands all of that before it says
//! anything useful is one nobody fills in.
//!
//! Capacity is compared against **the number of work items assigned**, not
//! against estimated effort — work items carry no estimate, and inventing one
//! would be a guess dressed as arithmetic. Item count is a weak signal, and the
//! UI says so rather than implying precision it does not have.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct SprintCapacity {
    pub id: i64,
    pub sprint_id: i64,
    pub team_member_id: i64,
    /// The team's own unit — the app does not care which, only that it is used
    /// consistently.
    pub capacity: i64,
    pub updated_at: i64,
}

/// A member's declared capacity next to what they have actually been given.
#[derive(Debug, Clone, PartialEq)]
pub struct MemberLoad {
    pub team_member_id: i64,
    pub capacity: i64,
    pub assigned_items: i64,
}

const SELECT: &str =
    "SELECT id, sprintId, teamMemberId, capacity, updatedAt FROM sprint_capacities";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sprint_capacities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sprintId INTEGER NOT NULL,
            teamMemberId INTEGER NOT NULL,
            capacity INTEGER NOT NULL DEFAULT 0,
            updatedAt INTEGER NOT NULL,
            UNIQUE(sprintId, teamMemberId)
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Records (or replaces) what one person has available in one sprint.
pub async fn set_capacity(
    conn: &Connection,
    sprint_id: i64,
    team_member_id: i64,
    capacity: i64,
) -> Result<i64> {
    if capacity < 0 {
        return Err(DbError::Validation(
            "capacity cannot be negative — use zero for someone who is unavailable".into(),
        ));
    }
    if crate::db::sprint::find_by_id(conn, sprint_id).await?.is_none() {
        return Err(DbError::Validation(format!("no sprint with id {sprint_id}")));
    }
    if crate::db::team_member::find_by_id(conn, team_member_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no team member with id {team_member_id}"
        )));
    }
    conn.execute(
        "DELETE FROM sprint_capacities WHERE sprintId = ?1 AND teamMemberId = ?2",
        (sprint_id, team_member_id),
    )
    .await?;
    conn.execute(
        "INSERT INTO sprint_capacities (sprintId, teamMemberId, capacity, updatedAt)
         VALUES (?1, ?2, ?3, ?4)",
        (sprint_id, team_member_id, capacity, now_millis()),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn list_for_sprint(conn: &Connection, sprint_id: i64) -> Result<Vec<SprintCapacity>> {
    let mut rows = conn
        .query(&format!("{SELECT} WHERE sprintId = ?1 ORDER BY teamMemberId"), (sprint_id,))
        .await?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().await? {
        items.push(SprintCapacity {
            id: row.get(0)?,
            sprint_id: row.get(1)?,
            team_member_id: row.get(2)?,
            capacity: row.get(3)?,
            updated_at: row.get(4)?,
        });
    }
    Ok(items)
}

/// Declared capacity beside assigned work, for everyone with either.
///
/// Someone with work but no declared capacity still appears — a person carrying
/// items nobody planned for is exactly what this is meant to surface.
pub async fn load_for_sprint(conn: &Connection, sprint_id: i64) -> Result<Vec<MemberLoad>> {
    let declared = list_for_sprint(conn, sprint_id).await?;

    let mut assigned: Vec<(i64, i64)> = Vec::new();
    {
        let mut rows = conn
            .query(
                "SELECT assigneeId, COUNT(*) FROM work_items
                 WHERE sprintId = ?1 AND assigneeId IS NOT NULL
                 GROUP BY assigneeId",
                (sprint_id,),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            assigned.push((row.get(0)?, row.get(1)?));
        }
    }

    let mut loads: Vec<MemberLoad> = declared
        .iter()
        .map(|c| MemberLoad {
            team_member_id: c.team_member_id,
            capacity: c.capacity,
            assigned_items: assigned
                .iter()
                .find(|(id, _)| *id == c.team_member_id)
                .map(|(_, n)| *n)
                .unwrap_or(0),
        })
        .collect();

    for (member_id, count) in assigned {
        if !loads.iter().any(|l| l.team_member_id == member_id) {
            loads.push(MemberLoad {
                team_member_id: member_id,
                capacity: 0,
                assigned_items: count,
            });
        }
    }
    loads.sort_by_key(|l| l.team_member_id);
    Ok(loads)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    async fn sprint(conn: &Connection, product_id: i64) -> i64 {
        crate::db::sprint::create(conn, product_id, "Sprint 1", None, None)
            .await
            .expect("sprint")
    }

    async fn member(conn: &Connection, name: &str) -> i64 {
        crate::db::team_member::add(conn, name, None).await.expect("member")
    }

    #[tokio::test]
    async fn capacity_round_trips_and_replaces_rather_than_duplicating() {
        let (conn, product_id) = db_with_product().await;
        let s = sprint(&conn, product_id).await;
        let ada = member(&conn, "Ada").await;

        set_capacity(&conn, s, ada, 8).await.expect("set");
        set_capacity(&conn, s, ada, 5).await.expect("replace");

        let all = list_for_sprint(&conn, s).await.expect("list");
        assert_eq!(all.len(), 1, "one row per member per sprint");
        assert_eq!(all[0].capacity, 5);
    }

    #[tokio::test]
    async fn capacity_is_validated() {
        let (conn, product_id) = db_with_product().await;
        let s = sprint(&conn, product_id).await;
        let ada = member(&conn, "Ada").await;

        assert!(set_capacity(&conn, s, ada, -1).await.is_err());
        assert!(set_capacity(&conn, 999, ada, 5).await.is_err());
        assert!(set_capacity(&conn, s, 999, 5).await.is_err());
        set_capacity(&conn, s, ada, 0).await.expect("zero means unavailable, not invalid");
    }

    #[tokio::test]
    async fn load_counts_the_items_actually_assigned_in_that_sprint() {
        use crate::db::work_item::{self, WorkItemFields};
        let (conn, product_id) = db_with_product().await;
        let s = sprint(&conn, product_id).await;
        let other = crate::db::sprint::create(&conn, product_id, "Sprint 2", None, None)
            .await
            .expect("sprint");
        let ada = member(&conn, "Ada").await;
        set_capacity(&conn, s, ada, 8).await.expect("set");

        for (title, sprint_id) in [("A", s), ("B", s), ("C", other)] {
            let id = work_item::create(&conn, title, "task", product_id, None, None)
                .await
                .expect("item");
            work_item::update_item(
                &conn,
                id,
                WorkItemFields {
                    assignee_id: Some(ada),
                    sprint_id: Some(sprint_id),
                    ..Default::default()
                },
            )
            .await
            .expect("assign");
        }

        let loads = load_for_sprint(&conn, s).await.expect("load");
        assert_eq!(loads.len(), 1);
        assert_eq!(loads[0].capacity, 8);
        assert_eq!(loads[0].assigned_items, 2, "the third item is in another sprint");
    }

    /// Someone carrying work nobody planned for is exactly what this should
    /// surface, so they appear with zero capacity rather than not at all.
    #[tokio::test]
    async fn someone_with_work_but_no_declared_capacity_still_appears() {
        use crate::db::work_item::{self, WorkItemFields};
        let (conn, product_id) = db_with_product().await;
        let s = sprint(&conn, product_id).await;
        let bob = member(&conn, "Bob").await;

        let id = work_item::create(&conn, "Unplanned", "task", product_id, None, None)
            .await
            .expect("item");
        work_item::update_item(
            &conn,
            id,
            WorkItemFields {
                assignee_id: Some(bob),
                sprint_id: Some(s),
                ..Default::default()
            },
        )
        .await
        .expect("assign");

        let loads = load_for_sprint(&conn, s).await.expect("load");
        assert_eq!(loads.len(), 1);
        assert_eq!(loads[0].team_member_id, bob);
        assert_eq!(loads[0].capacity, 0);
        assert_eq!(loads[0].assigned_items, 1);
    }

    #[tokio::test]
    async fn an_empty_sprint_has_no_load() {
        let (conn, product_id) = db_with_product().await;
        let s = sprint(&conn, product_id).await;
        assert!(load_for_sprint(&conn, s).await.expect("load").is_empty());
    }
}
