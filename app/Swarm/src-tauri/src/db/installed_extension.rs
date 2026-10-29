//! The `installed_extensions` table — which Hives and Cells this Swarm has
//! installed. See application/ai-only/Hives/extensions.md.
//!
//! **A new Swarm starts with none; an existing one keeps everything.** The
//! first time the table is made, an install that already had a database gets
//! the five extensions it was already using, so an upgrade takes nothing away.
//! A new database gets no rows, and Admin → Extensions is where they come
//! from. That runs once, the way `role_hive` copies its old columns once.

use crate::db::{now_millis, Result};
use serde::Serialize;
use turso::Connection;

/// What an install that predates extensions was already using — every Hive
/// and Cell Swarm had on 2026-10-29. Fixed history, not the current catalogue:
/// a Hive added to Swarm later is not quietly installed on an old database.
const CARRIED: &[(&str, &str)] = &[
    ("hive", "product"),
    ("hive", "develop"),
    ("hive", "test"),
    ("cell", "wsl"),
    ("cell", "docker"),
];

/// Where a carried-over row says it came from.
pub const BUILT_IN_SOURCE: &str = "built-in";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub kind: String,
    pub id: String,
    pub version: String,
    pub source: String,
    pub installed_at: i64,
}

/// Creates the table, and on a database that already existed before this
/// start, carries over what it was using. `existing_db` is read once by
/// `create_all_tables` before any table is made.
pub async fn create_table(conn: &Connection, existing_db: bool) -> Result<()> {
    let existed = !crate::db::table_columns(conn, "installed_extensions").await?.is_empty();
    conn.execute(
        "CREATE TABLE IF NOT EXISTS installed_extensions (
            kind TEXT NOT NULL,
            id TEXT NOT NULL,
            version TEXT NOT NULL,
            source TEXT NOT NULL,
            installedAt INTEGER NOT NULL,
            PRIMARY KEY (kind, id)
        )",
        (),
    )
    .await?;
    // Once, in the same branch that made the table, so an extension somebody
    // removes later is never put back by the next start.
    if !existed && existing_db {
        for (kind, id) in CARRIED {
            install(conn, kind, id, env!("CARGO_PKG_VERSION"), BUILT_IN_SOURCE).await?;
        }
    }
    Ok(())
}

/// Everything installed, Hives first, each kind in the order installed.
pub async fn list(conn: &Connection) -> Result<Vec<Installed>> {
    let mut rows = conn
        .query(
            "SELECT kind, id, version, source, installedAt FROM installed_extensions
             ORDER BY kind = 'cell', rowid",
            (),
        )
        .await?;
    let mut found = Vec::new();
    while let Some(row) = rows.next().await? {
        found.push(Installed {
            kind: row.get(0)?,
            id: row.get(1)?,
            version: row.get(2)?,
            source: row.get(3)?,
            installed_at: row.get(4)?,
        });
    }
    Ok(found)
}

/// The installed ids of one kind, in the order installed.
pub async fn ids_of(conn: &Connection, kind: &str) -> Result<Vec<String>> {
    let mut rows = conn
        .query(
            "SELECT id FROM installed_extensions WHERE kind = ?1 ORDER BY rowid",
            (kind,),
        )
        .await?;
    let mut ids = Vec::new();
    while let Some(row) = rows.next().await? {
        ids.push(row.get(0)?);
    }
    Ok(ids)
}

/// Records an install. Installing again updates the version and source and is
/// still one install — and keeps its place in the order.
pub async fn install(conn: &Connection, kind: &str, id: &str, version: &str, source: &str) -> Result<()> {
    let updated = conn
        .execute(
            "UPDATE installed_extensions SET version = ?3, source = ?4 WHERE kind = ?1 AND id = ?2",
            (kind, id, version, source),
        )
        .await?;
    if updated == 0 {
        conn.execute(
            "INSERT INTO installed_extensions (kind, id, version, source, installedAt)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            (kind, id, version, source, now_millis()),
        )
        .await?;
    }
    Ok(())
}

/// Removes an install. A Hive's role grants go with it, so installing it again
/// grants it to nobody — deny by default. Its data is the project's, and stays.
///
/// **Grants first.** If the second statement fails, the Hive is still
/// installed and granted to nobody, which is deny by default. The other order
/// could leave grants behind for a Hive that is gone, to return on reinstall.
pub async fn remove(conn: &Connection, kind: &str, id: &str) -> Result<()> {
    if kind == "hive" {
        conn.execute("DELETE FROM role_hives WHERE hiveId = ?1", (id,))
            .await?;
    }
    conn.execute(
        "DELETE FROM installed_extensions WHERE kind = ?1 AND id = ?2",
        (kind, id),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{connect, role, role_hive};

    async fn test_db(existing_db: bool) -> Connection {
        let conn = connect(":memory:").await.expect("open in-memory db");
        role::create_table(&conn).await.expect("roles");
        role_hive::create_table(&conn).await.expect("role_hives");
        create_table(&conn, existing_db).await.expect("installed_extensions");
        conn
    }

    fn pairs(rows: &[Installed]) -> Vec<(&str, &str)> {
        rows.iter().map(|r| (r.kind.as_str(), r.id.as_str())).collect()
    }

    async fn id_of(conn: &Connection, name: &str) -> i64 {
        role::find_by_name(conn, name).await.expect("q").expect("seeded").id
    }

    #[tokio::test]
    async fn a_new_database_starts_with_nothing_installed() {
        let conn = test_db(false).await;
        assert!(list(&conn).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn an_existing_database_keeps_all_five() {
        let conn = test_db(true).await;
        let rows = list(&conn).await.unwrap();
        assert_eq!(pairs(&rows), CARRIED);
        assert!(rows.iter().all(|r| r.source == BUILT_IN_SOURCE));
        assert_eq!(ids_of(&conn, "cell").await.unwrap(), ["wsl", "docker"]);
    }

    /// Once: a Hive somebody removed must stay removed on the next start.
    #[tokio::test]
    async fn the_carry_over_runs_once() {
        let conn = test_db(true).await;
        remove(&conn, "hive", "test").await.expect("remove");
        create_table(&conn, true).await.expect("second start");
        assert_eq!(ids_of(&conn, "hive").await.unwrap(), ["product", "develop"]);
    }

    #[tokio::test]
    async fn installing_twice_is_one_install() {
        let conn = test_db(false).await;
        install(&conn, "hive", "product", "0.1.0", "https://a").await.expect("install");
        install(&conn, "hive", "product", "0.2.0", "https://b").await.expect("again");
        let rows = list(&conn).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!((rows[0].version.as_str(), rows[0].source.as_str()), ("0.2.0", "https://b"));
    }

    #[tokio::test]
    async fn hives_are_listed_before_cells() {
        let conn = test_db(false).await;
        install(&conn, "cell", "docker", "0.1.0", "u").await.unwrap();
        install(&conn, "hive", "test", "0.1.0", "u").await.unwrap();
        install(&conn, "hive", "product", "0.1.0", "u").await.unwrap();
        assert_eq!(
            pairs(&list(&conn).await.unwrap()),
            [("hive", "test"), ("hive", "product"), ("cell", "docker")]
        );
    }

    /// Removing a Hive takes its grants and leaves another Hive's alone.
    #[tokio::test]
    async fn removing_a_hive_drops_only_its_grants() {
        let conn = test_db(true).await;
        let developer = id_of(&conn, "Developer").await;
        assert_eq!(role_hive::hives_for(&conn, developer).await.unwrap(), ["develop", "test"]);

        remove(&conn, "hive", "test").await.expect("remove");

        assert_eq!(role_hive::hives_for(&conn, developer).await.unwrap(), ["develop"]);
        assert_eq!(ids_of(&conn, "hive").await.unwrap(), ["product", "develop"]);
    }

    /// Deny by default: back again, and granted to nobody.
    #[tokio::test]
    async fn a_hive_installed_again_has_no_grants() {
        let conn = test_db(true).await;
        let qa = id_of(&conn, "QA").await;
        remove(&conn, "hive", "test").await.expect("remove");
        install(&conn, "hive", "test", "0.1.0", "u").await.expect("reinstall");
        assert!(role_hive::hives_for(&conn, qa).await.unwrap().is_empty());
    }

    /// A cell has no grants, and a Hive's are keyed by id alone — so removing
    /// a cell must not touch a Hive that happens to share its id.
    #[tokio::test]
    async fn removing_a_cell_leaves_every_grant() {
        let conn = test_db(true).await;
        let qa = id_of(&conn, "QA").await;
        remove(&conn, "cell", "test").await.expect("remove a cell named test");
        assert_eq!(role_hive::hives_for(&conn, qa).await.unwrap(), ["test"]);
        remove(&conn, "cell", "docker").await.expect("remove");
        assert_eq!(ids_of(&conn, "cell").await.unwrap(), ["wsl"]);
    }

    /// Install, then remove with its grant deletion, and both must still be
    /// true after the file is opened again — `:memory:` cannot show a write
    /// turso dropped at exit.
    #[tokio::test]
    async fn installs_and_removals_survive_a_restart() {
        let dir = std::env::temp_dir().join(format!(
            "swarm-installed-ext-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("Swarm.db");
        let path = path.to_str().expect("utf-8 path").to_string();

        let developer = {
            let conn = connect(&path).await.expect("open");
            role::create_table(&conn).await.expect("roles");
            role_hive::create_table(&conn).await.expect("role_hives");
            create_table(&conn, true).await.expect("installed");
            remove(&conn, "hive", "test").await.expect("remove");
            install(&conn, "hive", "design-studio", "0.1.0", "https://x").await.expect("install");
            id_of(&conn, "Developer").await
        };

        let conn = connect(&path).await.expect("reopen");
        assert_eq!(
            ids_of(&conn, "hive").await.unwrap(),
            ["product", "develop", "design-studio"]
        );
        assert_eq!(role_hive::hives_for(&conn, developer).await.unwrap(), ["develop"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
