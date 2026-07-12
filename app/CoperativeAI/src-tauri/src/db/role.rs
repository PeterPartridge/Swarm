//! The `Role` model — see application/claude-only/CoperativeAIdb/Role-model.md
//! for the approved spec this implements.

use turso::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct Role {
    pub id: i64,
    pub role_name: String,
    pub permissions: Vec<String>,
    pub description: Option<String>,
}

/// The five roles every project seeds automatically on first run, before any
/// user exists. Super Admin is the only role with manage:users / manage:roles.
const DEFAULT_ROLES: &[(&str, &[&str])] = &[
    ("Product Edit", &["view:product", "edit:product"]),
    ("Product View", &["view:product"]),
    ("Code View", &["view:code"]),
    ("Code Edit", &["view:code", "edit:code"]),
    (
        "Super Admin",
        &[
            "manage:users",
            "manage:roles",
            "view:product",
            "edit:product",
            "view:code",
            "edit:code",
        ],
    ),
];

pub async fn create_table(conn: &Connection) -> turso::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role_name TEXT NOT NULL UNIQUE,
            permissions TEXT NOT NULL DEFAULT '[]',
            description TEXT
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Inserts the five default roles if (and only if) the table is currently
/// empty. Safe to call on every app startup — it's a no-op after the first run.
pub async fn seed_defaults(conn: &Connection) -> turso::Result<()> {
    let mut rows = conn.query("SELECT COUNT(*) FROM roles", ()).await?;
    let row = rows.next().await?.expect("COUNT(*) always returns a row");
    let count: i64 = row.get(0)?;
    if count > 0 {
        return Ok(());
    }

    for (name, permissions) in DEFAULT_ROLES {
        let permissions_json = serde_json::to_string(permissions).expect("permissions serialize");
        conn.execute(
            "INSERT INTO roles (role_name, permissions) VALUES (?1, ?2)",
            (*name, permissions_json),
        )
        .await?;
    }
    Ok(())
}

pub async fn find_by_name(conn: &Connection, role_name: &str) -> turso::Result<Option<Role>> {
    let mut rows = conn
        .query(
            "SELECT id, role_name, permissions, description FROM roles WHERE role_name = ?1",
            (role_name,),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_role(row)?)),
        None => Ok(None),
    }
}

pub async fn list_all(conn: &Connection) -> turso::Result<Vec<Role>> {
    let mut rows = conn
        .query(
            "SELECT id, role_name, permissions, description FROM roles ORDER BY id",
            (),
        )
        .await?;
    let mut roles = Vec::new();
    while let Some(row) = rows.next().await? {
        roles.push(row_to_role(row)?);
    }
    Ok(roles)
}

fn row_to_role(row: turso::Row) -> turso::Result<Role> {
    let id: i64 = row.get(0)?;
    let role_name: String = row.get(1)?;
    let permissions_json: String = row.get(2)?;
    let description: Option<String> = row.get(3)?;
    let permissions: Vec<String> =
        serde_json::from_str(&permissions_json).unwrap_or_default();
    Ok(Role {
        id,
        role_name,
        permissions,
        description,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connect;

    async fn seeded_db() -> Connection {
        let conn = connect(":memory:").await.expect("open in-memory db");
        create_table(&conn).await.expect("create roles table");
        seed_defaults(&conn).await.expect("seed default roles");
        conn
    }

    #[tokio::test]
    async fn seeding_creates_all_five_default_roles() {
        let conn = seeded_db().await;
        let roles = list_all(&conn).await.expect("list roles");
        assert_eq!(roles.len(), 5);

        let names: Vec<&str> = roles.iter().map(|r| r.role_name.as_str()).collect();
        assert!(names.contains(&"Product Edit"));
        assert!(names.contains(&"Product View"));
        assert!(names.contains(&"Code View"));
        assert!(names.contains(&"Code Edit"));
        assert!(names.contains(&"Super Admin"));
    }

    #[tokio::test]
    async fn super_admin_has_manage_users_and_manage_roles_permissions() {
        let conn = seeded_db().await;
        let super_admin = find_by_name(&conn, "Super Admin")
            .await
            .expect("query super admin")
            .expect("super admin exists after seeding");

        assert!(super_admin.permissions.contains(&"manage:users".to_string()));
        assert!(super_admin.permissions.contains(&"manage:roles".to_string()));
    }

    #[tokio::test]
    async fn seeding_twice_does_not_duplicate_roles() {
        let conn = seeded_db().await;
        // Simulates a second app launch calling seed_defaults again.
        seed_defaults(&conn).await.expect("second seed call");

        let roles = list_all(&conn).await.expect("list roles");
        assert_eq!(roles.len(), 5, "seeding must be idempotent");
    }

    #[tokio::test]
    async fn role_name_must_be_unique() {
        let conn = seeded_db().await;
        let result = conn
            .execute(
                "INSERT INTO roles (role_name, permissions) VALUES (?1, ?2)",
                ("Super Admin", "[]"),
            )
            .await;

        assert!(
            result.is_err(),
            "inserting a duplicate role_name must fail the unique constraint"
        );
    }

    #[tokio::test]
    async fn find_by_name_returns_none_for_unknown_role() {
        let conn = seeded_db().await;
        let result = find_by_name(&conn, "Does Not Exist").await.expect("query");
        assert!(result.is_none());
    }
}
