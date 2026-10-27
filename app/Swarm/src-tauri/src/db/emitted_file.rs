//! The `EmittedFile` model — what the app last wrote to disk, and what it
//! looked like at the time.
//!
//! This exists so re-emitting never destroys a hand edit. The recorded hash is
//! the content **as the app wrote it**; if the file on disk no longer matches,
//! a person has changed it and the app must report a conflict rather than
//! overwrite. It is its own table rather than a column on `solution_management`
//! because that table already tracks scaffold locations, and adding a column
//! there would mean a drop-and-recreate that discards them.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct EmittedFile {
    pub id: i64,
    pub product_id: i64,
    pub rel_path: String,
    pub content_hash: String,
    pub emitted_at: i64,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS emitted_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            productId INTEGER NOT NULL,
            relPath TEXT NOT NULL,
            contentHash TEXT NOT NULL,
            emittedAt INTEGER NOT NULL,
            UNIQUE(productId, relPath)
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Records (or updates) what we wrote. One row per (product, path).
pub async fn record(
    conn: &Connection,
    product_id: i64,
    rel_path: &str,
    content_hash: &str,
) -> Result<i64> {
    if rel_path.trim().is_empty() {
        return Err(DbError::Validation("an emitted file needs a path".into()));
    }
    conn.execute(
        "DELETE FROM emitted_files WHERE productId = ?1 AND relPath = ?2",
        (product_id, rel_path),
    )
    .await?;
    conn.execute(
        "INSERT INTO emitted_files (productId, relPath, contentHash, emittedAt)
         VALUES (?1, ?2, ?3, ?4)",
        (product_id, rel_path, content_hash, now_millis()),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn list_for_product(conn: &Connection, product_id: i64) -> Result<Vec<EmittedFile>> {
    let mut rows = conn
        .query(
            "SELECT id, productId, relPath, contentHash, emittedAt FROM emitted_files
             WHERE productId = ?1 ORDER BY relPath",
            (product_id,),
        )
        .await?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().await? {
        items.push(EmittedFile {
            id: row.get(0)?,
            product_id: row.get(1)?,
            rel_path: row.get(2)?,
            content_hash: row.get(3)?,
            emitted_at: row.get(4)?,
        });
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    #[tokio::test]
    async fn a_recorded_file_is_listed_and_re_recording_replaces_it() {
        let (conn, product_id) = db_with_product().await;
        record(&conn, product_id, "api/application-spec.json", "hash-1")
            .await
            .expect("record");
        record(&conn, product_id, "api/application-spec.json", "hash-2")
            .await
            .expect("re-record");

        let files = list_for_product(&conn, product_id).await.expect("list");
        assert_eq!(files.len(), 1, "one row per path, not one per emit");
        assert_eq!(files[0].content_hash, "hash-2");
    }

    #[tokio::test]
    async fn paths_are_tracked_per_product() {
        let (conn, product_id) = db_with_product().await;
        let other = crate::db::product::create(&conn, "Other", "{}").await.expect("product");
        record(&conn, product_id, "spec.json", "a").await.expect("record");
        record(&conn, other, "spec.json", "b").await.expect("record");

        assert_eq!(list_for_product(&conn, product_id).await.expect("list").len(), 1);
        assert_eq!(list_for_product(&conn, other).await.expect("list")[0].content_hash, "b");
    }

    #[tokio::test]
    async fn a_path_is_required() {
        let (conn, product_id) = db_with_product().await;
        assert!(record(&conn, product_id, "  ", "hash").await.is_err());
    }
}
