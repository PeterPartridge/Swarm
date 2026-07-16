//! The `TeamMember` model — see
//! application/claude-only/CoperativeAIdb/TeamMember-model.md. Names and
//! roles only — the app has no accounts.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

pub const ROLES: &[&str] = &["Developer", "QA", "Product", "Designer"];

#[derive(Debug, Clone, PartialEq)]
pub struct TeamMember {
    pub id: i64,
    pub name: String,
    pub role: String,
    pub created_at: i64,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS team_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL DEFAULT 'Developer',
            createdAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

pub async fn add(conn: &Connection, name: &str, role: &str) -> Result<i64> {
    if name.trim().is_empty() {
        return Err(DbError::Validation("a team member needs a name".into()));
    }
    if !ROLES.contains(&role) {
        return Err(DbError::Validation(format!(
            "role must be one of {ROLES:?}, got '{role}'"
        )));
    }
    conn.execute(
        "INSERT INTO team_members (name, role, createdAt) VALUES (?1, ?2, ?3)",
        (name, role, now_millis()),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn list_all(conn: &Connection) -> Result<Vec<TeamMember>> {
    let mut rows = conn
        .query(
            "SELECT id, name, role, createdAt FROM team_members ORDER BY name",
            (),
        )
        .await?;
    let mut members = Vec::new();
    while let Some(row) = rows.next().await? {
        members.push(TeamMember {
            id: row.get(0)?,
            name: row.get(1)?,
            role: row.get(2)?,
            created_at: row.get(3)?,
        });
    }
    Ok(members)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<TeamMember>> {
    let mut rows = conn
        .query(
            "SELECT id, name, role, createdAt FROM team_members WHERE id = ?1",
            (id,),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(TeamMember {
            id: row.get(0)?,
            name: row.get(1)?,
            role: row.get(2)?,
            created_at: row.get(3)?,
        })),
        None => Ok(None),
    }
}

/// Removes a member; their work items become unassigned — never deleted
/// (TeamMember invariant).
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;
    use crate::db::work_item;

    #[tokio::test]
    async fn added_member_is_listed_with_role() {
        let (conn, _pid) = db_with_product().await;
        add(&conn, "Ada", "Developer").await.expect("add");
        let members = list_all(&conn).await.expect("list");
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].name, "Ada");
        assert_eq!(members[0].role, "Developer");
    }

    #[tokio::test]
    async fn name_unique_and_role_validated() {
        let (conn, _pid) = db_with_product().await;
        add(&conn, "Ada", "QA").await.expect("add");
        assert!(add(&conn, "Ada", "Developer").await.is_err());
        assert!(add(&conn, "Bob", "Intern").await.is_err());
        assert!(add(&conn, "  ", "QA").await.is_err());
    }

    #[tokio::test]
    async fn removing_a_member_unassigns_their_items_without_deleting_them() {
        let (conn, product_id) = db_with_product().await;
        let member = add(&conn, "Ada", "Developer").await.expect("add");
        let item = work_item::create(&conn, "Feature", "feature", product_id, None, None)
            .await
            .expect("create item");
        work_item::update_item(&conn, item, Some(member), None, None, None)
            .await
            .expect("assign");

        remove(&conn, member).await.expect("remove member");

        let reloaded = work_item::find_by_id(&conn, item)
            .await
            .expect("find")
            .expect("item survives");
        assert_eq!(reloaded.assignee_id, None);
    }
}
