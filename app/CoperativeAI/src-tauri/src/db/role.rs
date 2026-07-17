//! The `Role` model — permission-bearing roles. In a no-login app these gate
//! *visibility* (which areas/fields the active user sees), not security.
//! Seeded with sensible defaults on first run; editable in the Admin area.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct Role {
    pub id: i64,
    pub name: String,
    pub can_product: bool,
    pub can_develop: bool,
    pub can_test: bool,
    pub can_admin: bool,
    pub see_cost: bool,
    pub see_profit: bool,
    pub see_chargeable: bool,
}

/// (name, product, develop, test, admin, cost, profit, chargeable)
const DEFAULT_ROLES: &[(&str, bool, bool, bool, bool, bool, bool, bool)] = &[
    ("Admin", true, true, true, true, true, true, true),
    ("Product", true, false, false, false, true, true, true),
    ("Developer", false, true, true, false, false, false, false),
    ("QA", false, false, true, false, false, false, false),
];

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            canProduct INTEGER NOT NULL DEFAULT 0,
            canDevelop INTEGER NOT NULL DEFAULT 0,
            canTest INTEGER NOT NULL DEFAULT 0,
            canAdmin INTEGER NOT NULL DEFAULT 0,
            seeCost INTEGER NOT NULL DEFAULT 0,
            seeProfit INTEGER NOT NULL DEFAULT 0,
            seeChargeable INTEGER NOT NULL DEFAULT 0,
            createdAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    seed_defaults(conn).await
}

/// Inserts the default roles once (no-op after the first run).
async fn seed_defaults(conn: &Connection) -> Result<()> {
    // The COUNT read statement must be fully dropped before the INSERTs, or
    // turso 0.6 silently discards the writes (open read transaction).
    let count: i64 = {
        let mut rows = conn.query("SELECT COUNT(*) FROM roles", ()).await?;
        rows.next().await?.expect("COUNT(*) returns a row").get(0)?
    };
    if count > 0 {
        return Ok(());
    }
    for (name, p, d, t, a, cost, profit, charge) in DEFAULT_ROLES {
        conn.execute(
            "INSERT INTO roles (name, canProduct, canDevelop, canTest, canAdmin, seeCost, seeProfit, seeChargeable, createdAt)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            (
                *name, *p as i64, *d as i64, *t as i64, *a as i64,
                *cost as i64, *profit as i64, *charge as i64, now_millis(),
            ),
        )
        .await?;
    }
    Ok(())
}

pub async fn list_all(conn: &Connection) -> Result<Vec<Role>> {
    let mut rows = conn
        .query("SELECT id, name, canProduct, canDevelop, canTest, canAdmin, seeCost, seeProfit, seeChargeable FROM roles ORDER BY id", ())
        .await?;
    let mut roles = Vec::new();
    while let Some(row) = rows.next().await? {
        roles.push(row_to_role(row)?);
    }
    Ok(roles)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<Role>> {
    let mut rows = conn
        .query("SELECT id, name, canProduct, canDevelop, canTest, canAdmin, seeCost, seeProfit, seeChargeable FROM roles WHERE id = ?1", (id,))
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_role(row)?)),
        None => Ok(None),
    }
}

pub async fn find_by_name(conn: &Connection, name: &str) -> Result<Option<Role>> {
    let mut rows = conn
        .query("SELECT id, name, canProduct, canDevelop, canTest, canAdmin, seeCost, seeProfit, seeChargeable FROM roles WHERE name = ?1", (name,))
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_role(row)?)),
        None => Ok(None),
    }
}

pub async fn create(conn: &Connection, name: &str) -> Result<i64> {
    if name.trim().is_empty() {
        return Err(DbError::Validation("a role needs a name".into()));
    }
    conn.execute(
        "INSERT INTO roles (name, createdAt) VALUES (?1, ?2)",
        (name, now_millis()),
    )
    .await?;
    last_insert_id(conn).await
}

#[allow(clippy::too_many_arguments)]
pub async fn update(
    conn: &Connection,
    id: i64,
    can_product: bool,
    can_develop: bool,
    can_test: bool,
    can_admin: bool,
    see_cost: bool,
    see_profit: bool,
    see_chargeable: bool,
) -> Result<()> {
    let Some(role) = find_by_id(conn, id).await? else {
        return Err(DbError::Validation(format!("no role with id {id}")));
    };
    // The Admin role must keep full access so you can never lock yourself out.
    let (can_admin, can_product, can_develop, can_test) = if role.name == "Admin" {
        (true, true, true, true)
    } else {
        (can_admin, can_product, can_develop, can_test)
    };
    conn.execute(
        "UPDATE roles SET canProduct=?1, canDevelop=?2, canTest=?3, canAdmin=?4, seeCost=?5, seeProfit=?6, seeChargeable=?7 WHERE id=?8",
        (
            can_product as i64, can_develop as i64, can_test as i64, can_admin as i64,
            see_cost as i64, see_profit as i64, see_chargeable as i64, id,
        ),
    )
    .await?;
    Ok(())
}

/// Deletes a role; refuses if any team member still holds it, and the Admin
/// role can never be deleted.
pub async fn delete(conn: &Connection, id: i64) -> Result<()> {
    let Some(role) = find_by_id(conn, id).await? else {
        return Ok(());
    };
    if role.name == "Admin" {
        return Err(DbError::Validation("the Admin role can't be deleted".into()));
    }
    let count: i64 = {
        let mut rows = conn
            .query("SELECT COUNT(*) FROM team_members WHERE roleId = ?1", (id,))
            .await?;
        rows.next().await?.expect("count row").get(0)?
    };
    if count > 0 {
        return Err(DbError::Validation(
            "this role is assigned to team members — reassign them first".into(),
        ));
    }
    conn.execute("DELETE FROM roles WHERE id = ?1", (id,)).await?;
    Ok(())
}

fn row_to_role(row: turso::Row) -> Result<Role> {
    let b = |i: usize| -> Result<bool> { Ok(row.get::<i64>(i)? != 0) };
    Ok(Role {
        id: row.get(0)?,
        name: row.get(1)?,
        can_product: b(2)?,
        can_develop: b(3)?,
        can_test: b(4)?,
        can_admin: b(5)?,
        see_cost: b(6)?,
        see_profit: b(7)?,
        see_chargeable: b(8)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connect;

    async fn test_db() -> Connection {
        let conn = connect(":memory:").await.expect("open in-memory db");
        create_table(&conn).await.expect("create + seed");
        conn
    }

    #[tokio::test]
    async fn seeds_the_four_default_roles_with_admin_full() {
        let conn = test_db().await;
        let roles = list_all(&conn).await.expect("list");
        assert_eq!(roles.len(), 4);
        let admin = find_by_name(&conn, "Admin").await.expect("q").unwrap();
        assert!(admin.can_admin && admin.can_product && admin.see_cost);
        let dev = find_by_name(&conn, "Developer").await.expect("q").unwrap();
        assert!(dev.can_develop && !dev.can_product && !dev.see_cost);
    }

    #[tokio::test]
    async fn seeding_is_idempotent() {
        let conn = test_db().await;
        create_table(&conn).await.expect("second create");
        assert_eq!(list_all(&conn).await.expect("list").len(), 4);
    }

    #[tokio::test]
    async fn admin_role_stays_full_even_if_update_tries_to_weaken_it() {
        let conn = test_db().await;
        let admin = find_by_name(&conn, "Admin").await.expect("q").unwrap();
        update(&conn, admin.id, false, false, false, false, false, false, false)
            .await
            .expect("update");
        let reloaded = find_by_id(&conn, admin.id).await.expect("q").unwrap();
        assert!(reloaded.can_admin && reloaded.can_product && reloaded.can_test);
    }

    #[tokio::test]
    async fn admin_role_cannot_be_deleted() {
        let conn = test_db().await;
        let admin = find_by_name(&conn, "Admin").await.expect("q").unwrap();
        assert!(delete(&conn, admin.id).await.is_err());
    }

    #[tokio::test]
    async fn custom_role_can_be_created_and_updated() {
        let conn = test_db().await;
        let id = create(&conn, "Designer").await.expect("create");
        update(&conn, id, true, false, false, false, true, false, false)
            .await
            .expect("update");
        let role = find_by_id(&conn, id).await.expect("q").unwrap();
        assert!(role.can_product && role.see_cost && !role.can_develop);
    }
}
