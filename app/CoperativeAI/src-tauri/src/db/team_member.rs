//! The `TeamMember` model (round 2) — a name plus an assigned Role. Not a
//! login: Roles gate visibility only. Managed in the Admin area.

use crate::db::{now_millis, solution_management::last_insert_id, role, DbError, Result};
use turso::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct TeamMember {
    pub id: i64,
    pub name: String,
    pub role_id: Option<i64>,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    // Round-2 migration: the round-1 table used a free `role` text column.
    // Pre-release data, so a legacy table (no `roleId`) is dropped and recreated.
    let mut legacy = false;
    let mut has_table = false;
    {
        let mut rows = conn
            .query("SELECT name FROM pragma_table_info('team_members')", ())
            .await?;
        while let Some(row) = rows.next().await? {
            has_table = true;
            let column: String = row.get(0)?;
            if column == "role" {
                legacy = true;
            }
        }
    }
    if has_table && legacy {
        conn.execute("DROP TABLE team_members", ()).await?;
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS team_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            roleId INTEGER,
            createdAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

pub async fn add(conn: &Connection, name: &str, role_id: Option<i64>) -> Result<i64> {
    if name.trim().is_empty() {
        return Err(DbError::Validation("a team member needs a name".into()));
    }
    if let Some(rid) = role_id {
        if role::find_by_id(conn, rid).await?.is_none() {
            return Err(DbError::Validation(format!("no role with id {rid}")));
        }
    }
    conn.execute(
        "INSERT INTO team_members (name, roleId, createdAt) VALUES (?1, ?2, ?3)",
        (name, role_id, now_millis()),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn set_role(conn: &Connection, id: i64, role_id: Option<i64>) -> Result<()> {
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no team member with id {id}")));
    }
    if let Some(rid) = role_id {
        if role::find_by_id(conn, rid).await?.is_none() {
            return Err(DbError::Validation(format!("no role with id {rid}")));
        }
    }
    conn.execute(
        "UPDATE team_members SET roleId = ?1 WHERE id = ?2",
        (role_id, id),
    )
    .await?;
    Ok(())
}

pub async fn list_all(conn: &Connection) -> Result<Vec<TeamMember>> {
    let mut rows = conn
        .query("SELECT id, name, roleId FROM team_members ORDER BY name", ())
        .await?;
    let mut members = Vec::new();
    while let Some(row) = rows.next().await? {
        members.push(row_to_member(row)?);
    }
    Ok(members)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<TeamMember>> {
    let mut rows = conn
        .query("SELECT id, name, roleId FROM team_members WHERE id = ?1", (id,))
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_member(row)?)),
        None => Ok(None),
    }
}

/// Removes a member; their assigned work items become unassigned — never
/// deleted (TeamMember invariant).
pub async fn remove(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE work_items SET assigneeId = NULL WHERE assigneeId = ?1",
        (id,),
    )
    .await?;
    conn.execute("DELETE FROM team_members WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

fn row_to_member(row: turso::Row) -> Result<TeamMember> {
    Ok(TeamMember {
        id: row.get(0)?,
        name: row.get(1)?,
        role_id: row.get(2)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;
    use crate::db::{role, work_item};

    #[tokio::test]
    async fn added_member_carries_its_role() {
        let (conn, _pid) = db_with_product().await;
        let dev = role::find_by_name(&conn, "Developer").await.expect("q").unwrap();
        let id = add(&conn, "Ada", Some(dev.id)).await.expect("add");
        let member = find_by_id(&conn, id).await.expect("q").unwrap();
        assert_eq!(member.role_id, Some(dev.id));
    }

    #[tokio::test]
    async fn name_unique_and_role_must_exist() {
        let (conn, _pid) = db_with_product().await;
        add(&conn, "Ada", None).await.expect("add");
        assert!(add(&conn, "Ada", None).await.is_err());
        assert!(add(&conn, "Bob", Some(999)).await.is_err());
    }

    #[tokio::test]
    async fn set_role_reassigns() {
        let (conn, _pid) = db_with_product().await;
        let id = add(&conn, "Ada", None).await.expect("add");
        let qa = role::find_by_name(&conn, "QA").await.expect("q").unwrap();
        set_role(&conn, id, Some(qa.id)).await.expect("set role");
        assert_eq!(find_by_id(&conn, id).await.expect("q").unwrap().role_id, Some(qa.id));
    }

    #[tokio::test]
    async fn removing_a_member_unassigns_their_items() {
        let (conn, product_id) = db_with_product().await;
        let member = add(&conn, "Ada", None).await.expect("add");
        let item = work_item::create(&conn, "Feature", "feature", product_id, None, None)
            .await
            .expect("create item");
        work_item::update_item(
            &conn,
            item,
            work_item::WorkItemFields { assignee_id: Some(member), ..Default::default() },
        )
        .await
        .expect("assign");
        remove(&conn, member).await.expect("remove");
        assert_eq!(
            work_item::find_by_id(&conn, item).await.expect("q").unwrap().assignee_id,
            None
        );
    }
}
