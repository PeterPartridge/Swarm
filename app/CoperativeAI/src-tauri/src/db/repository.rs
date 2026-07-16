//! The `Repository` model — see
//! application/claude-only/CoperativeAIdb/Repository-model.md.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use std::path::Path;
use turso::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct Repository {
    pub id: i64,
    pub name: String,
    pub local_path: String,
    pub remote_url: Option<String>,
    pub default_branch: Option<String>,
    pub is_active: bool,
    pub created_at: i64,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS repositories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            localPath TEXT NOT NULL UNIQUE,
            remoteUrl TEXT,
            defaultBranch TEXT,
            isActive INTEGER NOT NULL DEFAULT 0,
            createdAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Registers a repository. The local path must already exist as a directory
/// (solution security rule: validate paths before saving).
pub async fn add(
    conn: &Connection,
    name: &str,
    local_path: &str,
    remote_url: Option<&str>,
    default_branch: Option<&str>,
) -> Result<i64> {
    if name.trim().is_empty() {
        return Err(DbError::Validation("a repository needs a name".into()));
    }
    if !Path::new(local_path).is_dir() {
        return Err(DbError::Validation(format!(
            "local path is not an existing directory: {local_path}"
        )));
    }
    conn.execute(
        "INSERT INTO repositories (name, localPath, remoteUrl, defaultBranch, createdAt)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (name, local_path, remote_url, default_branch, now_millis()),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn list_all(conn: &Connection) -> Result<Vec<Repository>> {
    let mut rows = conn
        .query(
            "SELECT id, name, localPath, remoteUrl, defaultBranch, isActive, createdAt
             FROM repositories ORDER BY id",
            (),
        )
        .await?;
    let mut repos = Vec::new();
    while let Some(row) = rows.next().await? {
        repos.push(row_to_repository(row)?);
    }
    Ok(repos)
}

/// Makes one repository the active one; every other row is deactivated
/// (invariant: at most one active repository).
pub async fn set_active(conn: &Connection, id: i64) -> Result<()> {
    let exists = find_by_id(conn, id).await?.is_some();
    if !exists {
        return Err(DbError::Validation(format!("no repository with id {id}")));
    }
    conn.execute("UPDATE repositories SET isActive = 0", ()).await?;
    conn.execute(
        "UPDATE repositories SET isActive = 1 WHERE id = ?1",
        (id,),
    )
    .await?;
    Ok(())
}

pub async fn find_active(conn: &Connection) -> Result<Option<Repository>> {
    let mut rows = conn
        .query(
            "SELECT id, name, localPath, remoteUrl, defaultBranch, isActive, createdAt
             FROM repositories WHERE isActive = 1",
            (),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_repository(row)?)),
        None => Ok(None),
    }
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<Repository>> {
    let mut rows = conn
        .query(
            "SELECT id, name, localPath, remoteUrl, defaultBranch, isActive, createdAt
             FROM repositories WHERE id = ?1",
            (id,),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_repository(row)?)),
        None => Ok(None),
    }
}

/// Removes the registration only — never touches the folder on disk.
pub async fn remove(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM repositories WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

fn row_to_repository(row: turso::Row) -> Result<Repository> {
    let is_active: i64 = row.get(5)?;
    Ok(Repository {
        id: row.get(0)?,
        name: row.get(1)?,
        local_path: row.get(2)?,
        remote_url: row.get(3)?,
        default_branch: row.get(4)?,
        is_active: is_active != 0,
        created_at: row.get(6)?,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::connect;

    /// A real directory to register in tests (path validation is enforced).
    pub(crate) fn temp_repo_dir(name: &str) -> String {
        let dir = std::env::temp_dir().join(format!("coperativeai-test-{name}"));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir.to_string_lossy().into_owned()
    }

    async fn test_db() -> Connection {
        let conn = connect(":memory:").await.expect("open in-memory db");
        create_table(&conn).await.expect("create table");
        conn
    }

    #[tokio::test]
    async fn added_repository_is_listed() {
        let conn = test_db().await;
        let path = temp_repo_dir("listed");
        add(&conn, "repo-a", &path, Some("https://example.com/a.git"), Some("main"))
            .await
            .expect("add");
        let repos = list_all(&conn).await.expect("list");
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].name, "repo-a");
        assert_eq!(repos[0].default_branch.as_deref(), Some("main"));
    }

    #[tokio::test]
    async fn nonexistent_directory_is_rejected() {
        let conn = test_db().await;
        let result = add(&conn, "ghost", "C:/definitely/not/a/real/dir-xyz", None, None).await;
        assert!(matches!(result, Err(DbError::Validation(_))));
    }

    #[tokio::test]
    async fn name_and_path_must_be_unique() {
        let conn = test_db().await;
        let path = temp_repo_dir("unique");
        add(&conn, "repo-a", &path, None, None).await.expect("add");
        assert!(add(&conn, "repo-a", &temp_repo_dir("unique2"), None, None)
            .await
            .is_err());
        assert!(add(&conn, "repo-b", &path, None, None).await.is_err());
    }

    #[tokio::test]
    async fn at_most_one_repository_is_active() {
        let conn = test_db().await;
        let a = add(&conn, "repo-a", &temp_repo_dir("active-a"), None, None)
            .await
            .expect("add a");
        let b = add(&conn, "repo-b", &temp_repo_dir("active-b"), None, None)
            .await
            .expect("add b");

        set_active(&conn, a).await.expect("activate a");
        set_active(&conn, b).await.expect("activate b");

        let active: Vec<_> = list_all(&conn)
            .await
            .expect("list")
            .into_iter()
            .filter(|r| r.is_active)
            .collect();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, b);
        assert_eq!(find_active(&conn).await.expect("find").unwrap().id, b);
    }

    #[tokio::test]
    async fn removing_a_repository_leaves_the_folder_on_disk() {
        let conn = test_db().await;
        let path = temp_repo_dir("remove");
        let id = add(&conn, "repo-a", &path, None, None).await.expect("add");
        remove(&conn, id).await.expect("remove");
        assert!(list_all(&conn).await.expect("list").is_empty());
        assert!(std::path::Path::new(&path).is_dir(), "folder must survive");
    }
}
