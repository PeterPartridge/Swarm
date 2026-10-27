//! The `role_hives` table — which Hives each role may open. One row is one
//! grant, keyed by the Hive's id: the Hives are whatever the frontend registry
//! (`app/Hives/registry.ts`) lists, so a new one needs a row, never a column.
//!
//! **Deny by default.** No row, no Hive — a Hive added to the registry later is
//! hidden from every role until somebody grants it. Admin is the exception and
//! is never read from here: it sees every Hive, so nobody can be locked out of
//! a screen by a Hive that did not exist when the roles were set.
//!
//! Replaces the `canProduct` / `canDevelop` / `canTest` columns on `roles`.
//! They are copied in once, the first time this table is made, and then left
//! in place unread — the roles they sit on are person-authored, and this
//! project adds to such tables rather than rebuilding them.

use crate::db::{role, DbError, Result};
use turso::Connection;

/// The Hives the old role columns stood for, and the column each one was.
const FROM_ROLE_COLUMNS: &[(&str, &str)] = &[
    ("product", "canProduct"),
    ("develop", "canDevelop"),
    ("test", "canTest"),
];

/// Creates the table and, the first time only, copies the old role columns in.
/// After `role::create_table`: the copy reads `roles`.
pub async fn create_table(conn: &Connection) -> Result<()> {
    let existed = !crate::db::table_columns(conn, "role_hives").await?.is_empty();
    conn.execute(
        "CREATE TABLE IF NOT EXISTS role_hives (
            roleId INTEGER NOT NULL,
            hiveId TEXT NOT NULL,
            PRIMARY KEY (roleId, hiveId)
        )",
        (),
    )
    .await?;
    // Once, in the same branch that made the table, so a Hive somebody
    // revokes later is never re-granted from the column it came from.
    if !existed {
        for (hive, column) in FROM_ROLE_COLUMNS {
            conn.execute(
                &format!("INSERT INTO role_hives (roleId, hiveId) SELECT id, ?1 FROM roles WHERE {column} = 1"),
                (*hive,),
            )
            .await?;
        }
    }
    Ok(())
}

/// The Hives a role has been granted, in id order.
pub async fn hives_for(conn: &Connection, role_id: i64) -> Result<Vec<String>> {
    let mut rows = conn
        .query(
            "SELECT hiveId FROM role_hives WHERE roleId = ?1 ORDER BY hiveId",
            (role_id,),
        )
        .await?;
    let mut hives = Vec::new();
    while let Some(row) = rows.next().await? {
        hives.push(row.get(0)?);
    }
    Ok(hives)
}

/// A Hive id as the registry writes them: lower-case letters, digits and
/// hyphens. Anything else cannot be a Hive, so it is refused rather than
/// stored as a grant that can never match.
fn is_hive_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Grants or revokes one Hive for one role. Granting twice is one grant.
pub async fn set(conn: &Connection, role_id: i64, hive_id: &str, allowed: bool) -> Result<()> {
    if !is_hive_id(hive_id) {
        return Err(DbError::Validation(format!("{hive_id:?} is not a Hive id")));
    }
    let Some(found) = role::find_by_id(conn, role_id).await? else {
        return Err(DbError::Validation(format!("no role with id {role_id}")));
    };
    if found.name == "Admin" {
        return Err(DbError::Validation(
            "the Admin role sees every Hive — there is nothing to grant".into(),
        ));
    }
    conn.execute(
        "DELETE FROM role_hives WHERE roleId = ?1 AND hiveId = ?2",
        (role_id, hive_id),
    )
    .await?;
    if allowed {
        conn.execute(
            "INSERT INTO role_hives (roleId, hiveId) VALUES (?1, ?2)",
            (role_id, hive_id),
        )
        .await?;
    }
    Ok(())
}

/// Drops every grant a deleted role held.
pub async fn clear_role(conn: &Connection, role_id: i64) -> Result<()> {
    conn.execute("DELETE FROM role_hives WHERE roleId = ?1", (role_id,))
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connect;

    async fn test_db() -> Connection {
        let conn = connect(":memory:").await.expect("open in-memory db");
        role::create_table(&conn).await.expect("roles");
        create_table(&conn).await.expect("role_hives");
        conn
    }

    async fn id_of(conn: &Connection, name: &str) -> i64 {
        role::find_by_name(conn, name).await.expect("q").expect("seeded").id
    }

    /// A fresh install's roles see what they saw before Hives existed: the
    /// seeded flags are what the grants are copied from.
    #[tokio::test]
    async fn the_seeded_roles_keep_the_areas_they_had() {
        let conn = test_db().await;
        let product = id_of(&conn, "Product").await;
        let developer = id_of(&conn, "Developer").await;
        let qa = id_of(&conn, "QA").await;
        assert_eq!(hives_for(&conn, product).await.unwrap(), ["product"]);
        assert_eq!(hives_for(&conn, developer).await.unwrap(), ["develop", "test"]);
        assert_eq!(hives_for(&conn, qa).await.unwrap(), ["test"]);
    }

    /// An existing install's hand-made role keeps its areas too — it is the
    /// row this migration exists to carry across.
    #[tokio::test]
    async fn an_existing_custom_role_is_carried_across() {
        let conn = connect(":memory:").await.expect("db");
        role::create_table(&conn).await.expect("roles");
        let id = role::create(&conn, "Contractor").await.expect("role");
        role::update(&conn, id, true, false, true, false, false, false, false, false, false, false)
            .await
            .expect("flags");

        create_table(&conn).await.expect("migrate");

        assert_eq!(hives_for(&conn, id).await.unwrap(), ["product", "test"]);
    }

    /// The copy happens once. A Hive somebody revoked afterwards must stay
    /// revoked on the next start, or the old column would quietly win.
    #[tokio::test]
    async fn the_copy_runs_once() {
        let conn = test_db().await;
        let developer = id_of(&conn, "Developer").await;
        set(&conn, developer, "test", false).await.expect("revoke");

        create_table(&conn).await.expect("second start");

        assert_eq!(hives_for(&conn, developer).await.unwrap(), ["develop"]);
    }

    #[tokio::test]
    async fn a_new_role_sees_no_hive() {
        let conn = test_db().await;
        let id = role::create(&conn, "Designer").await.expect("role");
        assert!(hives_for(&conn, id).await.unwrap().is_empty());
    }

    /// Granting twice is one grant; revoking what was never granted is fine.
    #[tokio::test]
    async fn grants_and_revokes() {
        let conn = test_db().await;
        let id = role::create(&conn, "Designer").await.expect("role");
        set(&conn, id, "design-studio", true).await.expect("grant");
        set(&conn, id, "design-studio", true).await.expect("grant again");
        assert_eq!(hives_for(&conn, id).await.unwrap(), ["design-studio"]);

        set(&conn, id, "design-studio", false).await.expect("revoke");
        set(&conn, id, "design-studio", false).await.expect("revoke again");
        assert!(hives_for(&conn, id).await.unwrap().is_empty());
    }

    /// Admin sees every Hive whatever this table says, so a grant against it
    /// would be a row that means nothing — refused rather than stored.
    #[tokio::test]
    async fn refuses_admin_an_unknown_role_and_a_malformed_id() {
        let conn = test_db().await;
        let admin = id_of(&conn, "Admin").await;
        assert!(set(&conn, admin, "product", false).await.is_err());
        assert!(set(&conn, 9999, "product", true).await.is_err());
        let qa = id_of(&conn, "QA").await;
        for bad in ["", "Product", "two words", "../etc"] {
            assert!(set(&conn, qa, bad, true).await.is_err(), "{bad:?} should be refused");
        }
    }

    /// `set` reads the role before it writes, which is the shape that once had
    /// turso discard every later write at exit. `:memory:` cannot see that, so
    /// this one goes to a file and opens it again.
    #[tokio::test]
    async fn a_grant_survives_a_restart() {
        let dir = std::env::temp_dir().join(format!(
            "swarm-role-hives-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("Swarm.db");
        let path = path.to_str().expect("utf-8 path").to_string();

        let id = {
            let conn = connect(&path).await.expect("open");
            role::create_table(&conn).await.expect("roles");
            create_table(&conn).await.expect("role_hives");
            let id = role::create(&conn, "Designer").await.expect("role");
            set(&conn, id, "design-studio", true).await.expect("grant");
            id
        };

        let conn = connect(&path).await.expect("reopen");
        assert_eq!(hives_for(&conn, id).await.unwrap(), ["design-studio"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn clearing_a_role_drops_its_grants() {
        let conn = test_db().await;
        let developer = id_of(&conn, "Developer").await;
        clear_role(&conn, developer).await.expect("clear");
        assert!(hives_for(&conn, developer).await.unwrap().is_empty());
    }
}
