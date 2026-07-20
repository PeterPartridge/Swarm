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
    /// May set a Product's AI budget, thresholds, and provider chain. Separate
    /// from `see_cost`: reading what was spent and deciding what may be spent
    /// are different powers, and Product roles usually want only the first.
    pub can_manage_budget: bool,
    /// The Marketing and Design screens inside the Product workspace. Separate
    /// from `can_product` because a developer often needs Planning without
    /// needing campaign drafts, and a marketer the reverse.
    pub can_marketing: bool,
    pub can_design: bool,
}

/// (name, product, develop, test, admin, cost, profit, chargeable, budget, marketing, design)
const DEFAULT_ROLES: &[(&str, bool, bool, bool, bool, bool, bool, bool, bool, bool, bool)] = &[
    ("Admin", true, true, true, true, true, true, true, true, true, true),
    ("Product", true, false, false, false, true, true, true, true, true, true),
    ("Developer", false, true, true, false, false, false, false, false, false, false),
    ("QA", false, false, true, false, false, false, false, false, false, false),
];

pub async fn create_table(conn: &Connection) -> Result<()> {
    // Round-2 migration: add canManageBudget. Pre-release → drop & recreate,
    // which also re-seeds the defaults with the new flag set sensibly.
    let mut columns: Vec<String> = Vec::new();
    {
        let mut rows = conn
            .query("SELECT name FROM pragma_table_info('roles')", ())
            .await?;
        while let Some(row) = rows.next().await? {
            columns.push(row.get(0)?);
        }
    }
    if !columns.is_empty() && !columns.iter().any(|c| c == "canManageBudget") {
        conn.execute("DROP TABLE roles", ()).await?;
    }

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
            canManageBudget INTEGER NOT NULL DEFAULT 0,
            canMarketing INTEGER NOT NULL DEFAULT 0,
            canDesign INTEGER NOT NULL DEFAULT 0,
            createdAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;

    // canMarketing/canDesign are ADDED rather than the third drop this table
    // has taken. The first two drops predate the rule this project settled on;
    // custom roles are person-authored — exactly what the rule says to
    // preserve. New flags default to 0 (deny-by-default for custom roles), and
    // the seeded Admin/Product rows are backfilled once, in the same branch
    // that added the columns, so a user's later toggling is never re-flipped.
    let had_table = !columns.is_empty();
    let dropped = had_table && !columns.iter().any(|c| c == "canManageBudget");
    if had_table && !dropped && !columns.iter().any(|c| c == "canMarketing") {
        for ddl in [
            "ALTER TABLE roles ADD COLUMN canMarketing INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE roles ADD COLUMN canDesign INTEGER NOT NULL DEFAULT 0",
        ] {
            conn.execute(ddl, ()).await?;
        }
        conn.execute(
            "UPDATE roles SET canMarketing = 1, canDesign = 1 WHERE name IN ('Admin', 'Product')",
            (),
        )
        .await?;
    }
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
    for (name, p, d, t, a, cost, profit, charge, budget, marketing, design) in DEFAULT_ROLES {
        conn.execute(
            "INSERT INTO roles (name, canProduct, canDevelop, canTest, canAdmin, seeCost, seeProfit, seeChargeable, canManageBudget, canMarketing, canDesign, createdAt)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            (
                *name, *p as i64, *d as i64, *t as i64, *a as i64,
                *cost as i64, *profit as i64, *charge as i64, *budget as i64,
                *marketing as i64, *design as i64, now_millis(),
            ),
        )
        .await?;
    }
    Ok(())
}

const SELECT: &str = "SELECT id, name, canProduct, canDevelop, canTest, canAdmin, seeCost, seeProfit, seeChargeable, canManageBudget, canMarketing, canDesign FROM roles";

pub async fn list_all(conn: &Connection) -> Result<Vec<Role>> {
    let mut rows = conn.query(&format!("{SELECT} ORDER BY id"), ()).await?;
    let mut roles = Vec::new();
    while let Some(row) = rows.next().await? {
        roles.push(row_to_role(row)?);
    }
    Ok(roles)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<Role>> {
    let mut rows = conn.query(&format!("{SELECT} WHERE id = ?1"), (id,)).await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_role(row)?)),
        None => Ok(None),
    }
}

pub async fn find_by_name(conn: &Connection, name: &str) -> Result<Option<Role>> {
    let mut rows = conn.query(&format!("{SELECT} WHERE name = ?1"), (name,)).await?;
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
    can_manage_budget: bool,
    can_marketing: bool,
    can_design: bool,
) -> Result<()> {
    let Some(role) = find_by_id(conn, id).await? else {
        return Err(DbError::Validation(format!("no role with id {id}")));
    };
    // The Admin role must keep full access so you can never lock yourself out —
    // including budget management, or nobody could raise a spent budget, and
    // the new areas, or a screen could become invisible to everyone.
    let (can_admin, can_product, can_develop, can_test, can_manage_budget, can_marketing, can_design) =
        if role.name == "Admin" {
            (true, true, true, true, true, true, true)
        } else {
            (can_admin, can_product, can_develop, can_test, can_manage_budget, can_marketing, can_design)
        };
    conn.execute(
        "UPDATE roles SET canProduct=?1, canDevelop=?2, canTest=?3, canAdmin=?4, seeCost=?5, seeProfit=?6, seeChargeable=?7, canManageBudget=?8, canMarketing=?9, canDesign=?10 WHERE id=?11",
        (
            can_product as i64, can_develop as i64, can_test as i64, can_admin as i64,
            see_cost as i64, see_profit as i64, see_chargeable as i64,
            can_manage_budget as i64, can_marketing as i64, can_design as i64, id,
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
        can_manage_budget: b(9)?,
        can_marketing: b(10)?,
        can_design: b(11)?,
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
        update(&conn, admin.id, false, false, false, false, false, false, false, false, false, false)
            .await
            .expect("update");
        let reloaded = find_by_id(&conn, admin.id).await.expect("q").unwrap();
        assert!(reloaded.can_admin && reloaded.can_product && reloaded.can_test);
        // Admin must keep budget management too, or a spent budget could never
        // be raised by anyone — and the new areas, or a screen could become
        // invisible to everyone.
        assert!(reloaded.can_manage_budget);
        assert!(reloaded.can_marketing && reloaded.can_design);
    }

    /// The first two migrations of this table dropped it; custom roles are
    /// person-authored, which is exactly what the project's rule says to
    /// preserve — so the third adds columns instead, and proves it.
    #[tokio::test]
    async fn adding_marketing_and_design_preserves_custom_roles() {
        let conn = connect(":memory:").await.expect("db");
        // A round-2 table: has canManageBudget, predates the new flags.
        conn.execute(
            "CREATE TABLE roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
                canProduct INTEGER NOT NULL DEFAULT 0, canDevelop INTEGER NOT NULL DEFAULT 0,
                canTest INTEGER NOT NULL DEFAULT 0, canAdmin INTEGER NOT NULL DEFAULT 0,
                seeCost INTEGER NOT NULL DEFAULT 0, seeProfit INTEGER NOT NULL DEFAULT 0,
                seeChargeable INTEGER NOT NULL DEFAULT 0, canManageBudget INTEGER NOT NULL DEFAULT 0,
                createdAt INTEGER NOT NULL
            )",
            (),
        )
        .await
        .expect("old table");
        conn.execute(
            "INSERT INTO roles (name, canProduct, canAdmin, createdAt) VALUES ('Admin', 1, 1, 1), ('Contractor', 1, 0, 1)",
            (),
        )
        .await
        .expect("seed old rows");

        create_table(&conn).await.expect("migrate");

        let custom = find_by_name(&conn, "Contractor").await.expect("q").expect("survives");
        assert!(custom.can_product, "the hand-made role keeps its old flags");
        assert!(!custom.can_marketing, "new flags start off for custom roles — deny by default");

        // …but the seeded roles are backfilled, or Admin would lose two screens.
        let admin = find_by_name(&conn, "Admin").await.expect("q").unwrap();
        assert!(admin.can_marketing && admin.can_design);
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
        update(&conn, id, true, false, false, false, true, false, false, false, false, true)
            .await
            .expect("update");
        let role = find_by_id(&conn, id).await.expect("q").unwrap();
        assert!(role.can_product && role.see_cost && !role.can_develop);
        assert!(!role.can_manage_budget);
        // a designer sees Design and not Marketing — the flags split
        assert!(role.can_design && !role.can_marketing);
    }

    /// Seeing what was spent and deciding what may be spent are different
    /// powers — a role can have the first without the second.
    #[tokio::test]
    async fn a_role_can_see_cost_without_being_able_to_change_the_budget() {
        let conn = test_db().await;
        let id = create(&conn, "Analyst").await.expect("create");
        update(&conn, id, true, false, false, false, true, true, true, false, false, false)
            .await
            .expect("update");
        let role = find_by_id(&conn, id).await.expect("q").unwrap();
        assert!(role.see_cost && role.see_profit);
        assert!(!role.can_manage_budget);
    }

    #[tokio::test]
    async fn the_seeded_roles_split_budget_management_sensibly() {
        let conn = test_db().await;
        let budget_holders = ["Admin", "Product"];
        for name in budget_holders {
            let role = find_by_name(&conn, name).await.expect("q").unwrap();
            assert!(role.can_manage_budget, "{name} should manage budgets");
        }
        for name in ["Developer", "QA"] {
            let role = find_by_name(&conn, name).await.expect("q").unwrap();
            assert!(!role.can_manage_budget, "{name} should not manage budgets");
        }
    }
}
