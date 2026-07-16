//! The `SolutionManagement` model — see
//! application/claude-only/CoperativeAIdb/SolutionManagement-model.md.
//! Column names stay PascalCase exactly as the brief wrote them (flagged
//! there, deliberately not normalised).

use crate::db::{now_millis, DbError, Result};
use turso::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct Solution {
    pub id: i64,
    pub filename: String,
    pub filepath: String,
    pub version: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS solution_management (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            Filename TEXT NOT NULL,
            Filepath TEXT NOT NULL,
            Version TEXT NOT NULL DEFAULT '',
            CreatedAt INTEGER NOT NULL,
            UpdatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

pub async fn create(
    conn: &Connection,
    filename: &str,
    filepath: &str,
    version: &str,
) -> Result<i64> {
    if filename.trim().is_empty() || filepath.trim().is_empty() {
        return Err(DbError::Validation(
            "a solution needs a filename and a filepath".into(),
        ));
    }
    let now = now_millis();
    conn.execute(
        "INSERT INTO solution_management (Filename, Filepath, Version, CreatedAt, UpdatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (filename, filepath, version, now, now),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn list_all(conn: &Connection) -> Result<Vec<Solution>> {
    let mut rows = conn
        .query(
            "SELECT id, Filename, Filepath, Version, CreatedAt, UpdatedAt
             FROM solution_management ORDER BY id",
            (),
        )
        .await?;
    let mut solutions = Vec::new();
    while let Some(row) = rows.next().await? {
        solutions.push(Solution {
            id: row.get(0)?,
            filename: row.get(1)?,
            filepath: row.get(2)?,
            version: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        });
    }
    Ok(solutions)
}

pub async fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM solution_management WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

pub(crate) async fn last_insert_id(conn: &Connection) -> Result<i64> {
    let mut rows = conn.query("SELECT last_insert_rowid()", ()).await?;
    let row = rows
        .next()
        .await?
        .expect("last_insert_rowid always returns a row");
    Ok(row.get(0)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connect;

    async fn test_db() -> Connection {
        let conn = connect(":memory:").await.expect("open in-memory db");
        create_table(&conn).await.expect("create table");
        conn
    }

    #[tokio::test]
    async fn created_solution_appears_in_the_list() {
        let conn = test_db().await;
        let id = create(&conn, "MyApp", "C:/solutions/MyApp", "1")
            .await
            .expect("create solution");
        let all = list_all(&conn).await.expect("list");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, id);
        assert_eq!(all[0].filename, "MyApp");
    }

    #[tokio::test]
    async fn filename_and_filepath_are_required() {
        let conn = test_db().await;
        assert!(create(&conn, "", "C:/x", "1").await.is_err());
        assert!(create(&conn, "MyApp", "  ", "1").await.is_err());
    }

    #[tokio::test]
    async fn delete_removes_the_entry() {
        let conn = test_db().await;
        let id = create(&conn, "MyApp", "C:/solutions/MyApp", "1")
            .await
            .expect("create");
        delete(&conn, id).await.expect("delete");
        assert!(list_all(&conn).await.expect("list").is_empty());
    }

    #[tokio::test]
    async fn timestamps_are_set_on_create() {
        let conn = test_db().await;
        create(&conn, "MyApp", "C:/solutions/MyApp", "1")
            .await
            .expect("create");
        let s = &list_all(&conn).await.expect("list")[0];
        assert!(s.created_at > 0);
        assert_eq!(s.created_at, s.updated_at);
    }
}
